// Controladores de partida: local (contra la IA, todo en el dispositivo, sin conexión)
// y en línea (servidor autoritativo por WebSocket). La interfaz de juego usa la misma API para ambos.

import {
  createGame, applyMove, applyTimeout, dealRound, viewFor, chooseMove, seededRng, secureRng,
  type GameState, type PlayerView, type AiLevel, type RoundResult, type GameConfig,
} from '../../../packages/engine/src/index.ts';

export interface GameOver { scores: number[]; teams: [number, number] | null; winnerSeat: number; winnerTeam: number | null; history: RoundResult[] }
export interface Presence { connected: boolean; isBot: boolean }
export interface ChatMsg { name: string; text: string; at: number; system?: boolean }

export interface Controller {
  kind: 'local' | 'online' | 'tutorial';
  view: PlayerView | null;
  deadline: number | null;
  presence: Presence[];
  code?: string;
  chat: ChatMsg[];
  avatars: number[];
  onChange: (() => void) | null;
  onEvent: ((e: { type: string; seat?: number; name?: string; tilesPlaced?: number; drawn?: number[]; message?: string; emote?: string; chat?: ChatMsg }) => void) | null;
  onGameOver: ((g: GameOver) => void) | null;
  onRoundOver: ((r: RoundResult) => void) | null;
  play(table: number[][]): Promise<{ ok: boolean; message?: string }>;
  draw(): Promise<{ ok: boolean; message?: string }>;
  nextRound?(): void;
  sendChat?(text: string): void;
  sendEmote?(e: string): void;
  leave(): void;
}

// ---------------- Local contra IA ----------------
export class LocalController implements Controller {
  kind: 'local' | 'tutorial' = 'local';
  view: PlayerView | null = null;
  deadline: number | null = null;
  presence: Presence[] = [];
  chat: ChatMsg[] = [];
  avatars: number[];
  onChange: Controller['onChange'] = null;
  onEvent: Controller['onEvent'] = null;
  onGameOver: Controller['onGameOver'] = null;
  onRoundOver: Controller['onRoundOver'] = null;
  state: GameState;
  levels: AiLevel[];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  botDelay: [number, number] = [650, 1300];

  constructor(opts: { name: string; avatar: number; levels: AiLevel[]; teams?: boolean; turnSeconds: number; rounds?: number; state?: GameState; seed?: number }) {
    this.levels = ['principiante', ...opts.levels];
    const names = ['Kiin', 'Ek', 'Ixchel', 'Balam'];
    const seats = [{ id: 'me', name: opts.name || 'Tú' }, ...opts.levels.map((l, i) => ({ id: `ia${i}`, name: `${names[i]}`, isBot: true, botLevel: l }))];
    this.state = opts.state ?? createGame('local', seats, { teams: !!opts.teams, turnSeconds: opts.turnSeconds, rounds: opts.rounds ?? 1 }, opts.seed != null ? seededRng(opts.seed) : undefined);
    this.avatars = [opts.avatar, ...opts.levels.map((_, i) => (opts.avatar + 2 + i * 2) % 8)];
    this.presence = seats.map((_, i) => ({ connected: true, isBot: i > 0 }));
    setTimeout(() => this.tick(), 0);
  }

  get config(): GameConfig { return this.state.config; }

  private publish() { this.view = viewFor(this.state, 0); this.onChange?.(); }

  private tick() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.publish();
    const s = this.state;
    if (s.status === 'round_over') return this.onRoundOver?.(s.history[s.history.length - 1]);
    if (s.status === 'finished') return this.finish();
    if (s.turn === 0) {
      const secs = s.config.turnSeconds;
      this.deadline = secs > 0 ? Date.now() + secs * 1000 : null;
      if (secs > 0) this.timer = setTimeout(() => {
        const r = applyTimeout(this.state);
        if (r.ok) { this.state = r.state; this.onEvent?.({ type: 'timeout', seat: 0, drawn: r.drawn }); this.tick(); }
      }, secs * 1000);
      this.publish();
      return;
    }
    this.deadline = null;
    const seat = s.turn;
    const [a, b] = this.botDelay;
    this.botTimer = setTimeout(() => {
      if (this.stopped || this.state.turn !== seat) return;
      const move = chooseMove(viewFor(this.state, seat), this.levels[seat] ?? 'intermedio', secureRng);
      let r = applyMove(this.state, seat, move);
      if (!r.ok) r = applyMove(this.state, seat, { type: 'draw' });
      if (!r.ok) return;
      const placed = move.type === 'play' && r.state.events[r.state.events.length - 1]?.type === 'play' ? r.state.events[r.state.events.length - 1].tilesPlaced : 0;
      this.state = r.state;
      this.onEvent?.({ type: placed ? 'play' : 'draw', seat, name: this.state.players[seat].name, tilesPlaced: placed });
      this.tick();
    }, a + Math.random() * (b - a));
  }

  private finish() {
    const s = this.state;
    let winnerSeat = 0;
    s.scores.forEach((v, i) => { if (v > s.scores[winnerSeat]) winnerSeat = i; });
    const teams: [number, number] | null = s.config.teams ? [s.scores[0] + s.scores[2], s.scores[1] + s.scores[3]] : null;
    const winnerTeam = teams ? (teams[0] >= teams[1] ? 0 : 1) : null;
    this.onGameOver?.({ scores: s.scores, teams, winnerSeat, winnerTeam, history: s.history });
  }

  async play(table: number[][]) {
    const r = applyMove(this.state, 0, { type: 'play', table });
    if (!r.ok) return { ok: false, message: r.message };
    this.state = r.state;
    this.tick();
    return { ok: true };
  }
  async draw() {
    const r = applyMove(this.state, 0, { type: 'draw' });
    if (!r.ok) return { ok: false, message: r.message };
    this.state = r.state;
    this.onEvent?.({ type: 'drawn', seat: 0, drawn: r.drawn });
    this.tick();
    return { ok: true };
  }
  nextRound() { this.state = dealRound(this.state); this.tick(); }
  leave() { this.stopped = true; if (this.timer) clearTimeout(this.timer); if (this.botTimer) clearTimeout(this.botTimer); }
}

// ---------------- En línea ----------------
type Listener = (m: any) => void;

export class Connection {
  ws: WebSocket | null = null;
  url: string;
  token: string;
  listeners = new Set<Listener>();
  status: 'connecting' | 'open' | 'closed' = 'closed';
  private retry = 0;
  private closedByUser = false;
  onStatus: ((s: Connection['status']) => void) | null = null;

  constructor(url: string, token: string) { this.url = url; this.token = token; }

  connect(): Promise<void> {
    this.closedByUser = false;
    return new Promise((resolve, reject) => {
      this.status = 'connecting'; this.onStatus?.(this.status);
      let ws: WebSocket;
      try { ws = new WebSocket(this.url); } catch (e) { return reject(e); }
      this.ws = ws;
      const fail = setTimeout(() => { ws.close(); reject(new Error('No se pudo conectar con el servidor')); }, 8000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: this.token }));
      ws.onmessage = ev => {
        let m: any; try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.t === 'welcome') { clearTimeout(fail); this.retry = 0; this.status = 'open'; this.onStatus?.(this.status); resolve(); }
        this.listeners.forEach(l => l(m));
      };
      ws.onclose = () => {
        clearTimeout(fail);
        this.status = 'closed'; this.onStatus?.(this.status);
        if (this.closedByUser) return;
        // reconexión automática con espera creciente (redes móviles, cambio de Wi-Fi a datos)
        const wait = Math.min(15000, 600 * 2 ** this.retry++);
        setTimeout(() => this.connect().catch(() => {}), wait);
      };
      ws.onerror = () => {};
    });
  }
  send(m: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  on(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  close() { this.closedByUser = true; this.ws?.close(); }
}

let nonceN = 0;
const nonce = () => `${Date.now().toString(36)}${(nonceN++).toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export class OnlineController implements Controller {
  kind = 'online' as const;
  view: PlayerView | null = null;
  deadline: number | null = null;
  presence: Presence[] = [];
  chat: ChatMsg[] = [];
  avatars: number[] = [0, 2, 4, 6];
  code?: string;
  onChange: Controller['onChange'] = null;
  onEvent: Controller['onEvent'] = null;
  onGameOver: Controller['onGameOver'] = null;
  onRoundOver: Controller['onRoundOver'] = null;
  private off: () => void;
  private pending: ((r: { ok: boolean; message?: string }) => void) | null = null;
  private skew = 0;
  private lastRound = 0;
  conn: Connection;

  constructor(conn: Connection, first?: any) {
    this.conn = conn;
    this.off = conn.on(m => this.handle(m));
    if (first) this.handle(first);
  }

  private handle(m: any) {
    switch (m.t) {
      case 'state': {
        this.skew = Date.now() - m.serverNow;
        const prevTurn = this.view?.turnNumber;
        this.view = m.view; this.code = m.code; this.presence = m.presence;
        this.deadline = m.deadline ? m.deadline + this.skew : null;
        if (m.chat && !this.chat.length) this.chat = m.chat;
        if (this.pending && prevTurn !== m.view.turnNumber) { this.pending({ ok: true }); this.pending = null; }
        this.onChange?.();
        const v = m.view as PlayerView;
        if (v.status === 'round_over' && v.round !== this.lastRound) { this.lastRound = v.round; this.onRoundOver?.(v.history[v.history.length - 1]); }
        break;
      }
      case 'move_rejected':
        if (m.state) { this.view = m.state.view; this.onChange?.(); }
        this.pending?.({ ok: false, message: m.message }); this.pending = null;
        break;
      case 'event': this.onEvent?.({ type: m.event.type, seat: m.event.seat, name: m.name, tilesPlaced: m.event.tilesPlaced }); break;
      case 'drawn': this.onEvent?.({ type: 'drawn', drawn: m.tiles }); break;
      case 'presence': this.presence = m.presence; this.onChange?.(); break;
      case 'chat': { const c = { name: m.name, text: m.text, at: m.at, system: m.system }; this.chat.push(c); this.onEvent?.({ type: 'chat', chat: c }); break; }
      case 'emote': this.onEvent?.({ type: 'emote', seat: m.seat, emote: m.e }); break;
      case 'game_over': this.onGameOver?.(m); break;
      case 'error':
        if (m.code === 'RATE') this.conn.send({ t: 'sync' });
        if (this.pending && ['DUPLICATE_MOVE', 'RATE'].includes(m.code)) { this.pending({ ok: false, message: m.message }); this.pending = null; }
        this.onEvent?.({ type: 'error', message: m.message });
        break;
    }
  }

  private send(type: 'play' | 'draw', table?: number[][]) {
    return new Promise<{ ok: boolean; message?: string }>(res => {
      if (!this.view) return res({ ok: false, message: 'Sin partida' });
      this.pending = res;
      this.conn.send({ t: type, table, turn: this.view.turnNumber, nonce: nonce() });
      setTimeout(() => { if (this.pending === res) { this.pending = null; this.conn.send({ t: 'sync' }); res({ ok: false, message: 'Sin respuesta del servidor; reintentando sincronizar' }); } }, 8000);
    });
  }
  play(table: number[][]) { return this.send('play', table); }
  draw() { return this.send('draw'); }
  sendChat(text: string) { this.conn.send({ t: 'chat', text }); }
  sendEmote(e: string) { this.conn.send({ t: 'emote', e }); }
  leave() { this.conn.send({ t: 'leave' }); this.off(); }
}
