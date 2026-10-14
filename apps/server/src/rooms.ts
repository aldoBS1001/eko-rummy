// Salas, emparejamiento, turnos y bots. El servidor es la única autoridad:
// el cliente envía la mesa propuesta y el servidor la valida con el motor; nunca se confía en el cliente.

import { randomUUID, randomInt, createHash } from 'node:crypto';
import {
  createGame, applyMove, applyTimeout, dealRound, viewFor, chooseMove, replaceWithBot, matchWinner, checkIntegrity, teamScores,
  type GameState, type AiLevel, type Move,
} from '../../../packages/engine/src/index.ts';
import type { TokenPayload } from './auth.ts';
import { RateLimiter } from './auth.ts';
import { moderate, EMOTES } from './chat.ts';
import type { Store } from './store.ts';
import type { Config } from './config.ts';

export interface Conn {
  id: string;
  user: TokenPayload;
  ip: string;
  send: (msg: unknown) => void;
  close: () => void;
  roomCode?: string;
  limiter: RateLimiter;
  chatLimiter: RateLimiter;
  alive: boolean;
}

interface Seat {
  userId: string | null;
  name: string;
  avatar?: string;
  conn: Conn | null;
  isBot: boolean;
  botLevel?: AiLevel;
  disconnectedAt: number | null;
  timeouts: number;
  ip?: string;
  registered: boolean;
}

export type RoomMode = 'private' | 'quick' | 'teams' | 'tournament';

const AI_LEVELS: AiLevel[] = ['principiante', 'intermedio', 'avanzado', 'experto'];
const BOT_NAMES = ['Kiin', 'Ek', "Ixchel", 'Balam', 'Itzá', 'Nikté', 'Chaac', 'Kukul'];

export class Room {
  code: string;
  matchId = randomUUID();
  seats: Seat[] = [];
  game: GameState | null = null;
  deadline: number | null = null;
  private turnTimer: NodeJS.Timeout | null = null;
  private botTimer: NodeJS.Timeout | null = null;
  private nextRoundTimer: NodeJS.Timeout | null = null;
  private graceTimers = new Map<number, NodeJS.Timeout>();
  private nonces = new Set<string>();
  chat: { name: string; text: string; at: number }[] = [];
  createdAt = Date.now();
  hostUserId: string | null = null;
  onFinish?: (room: Room, winnerSeat: number) => void;

  mgr: RoomManager;
  mode: RoomMode;
  size: number;
  teams: boolean;
  turnSeconds: number;
  rounds: number;
  tournamentId: string | null;

  constructor(mgr: RoomManager, mode: RoomMode, size: number, teams: boolean, turnSeconds: number, rounds = 1, tournamentId: string | null = null) {
    this.mgr = mgr; this.mode = mode; this.size = size; this.teams = teams; this.turnSeconds = turnSeconds; this.rounds = rounds; this.tournamentId = tournamentId;
    this.code = mgr.newCode();
  }

  get started() { return this.game !== null; }
  get humans() { return this.seats.filter(s => !s.isBot && s.userId); }

  seatOf(userId: string) { return this.seats.findIndex(s => s.userId === userId && !s.isBot); }

  addHuman(conn: Conn): number | string {
    const existing = this.seatOf(conn.user.sub);
    if (existing >= 0) { this.attach(existing, conn); return existing; }
    if (this.started) return 'La partida ya comenzó';
    if (this.seats.length >= this.size) return 'La sala está llena';
    this.seats.push({ userId: conn.user.sub, name: conn.user.name, conn, isBot: false, disconnectedAt: null, timeouts: 0, ip: conn.ip, registered: conn.user.role !== 'guest' });
    if (!this.hostUserId) this.hostUserId = conn.user.sub;
    conn.roomCode = this.code;
    this.broadcastLobby();
    return this.seats.length - 1;
  }

  /** Reserva un asiento para un usuario (torneos) aunque aún no esté conectado. */
  reserve(userId: string, name: string, registered: boolean) {
    this.seats.push({ userId, name, conn: null, isBot: false, disconnectedAt: Date.now(), timeouts: 0, registered });
  }

  addBot(level: AiLevel) {
    if (this.started || this.seats.length >= this.size) return false;
    const used = new Set(this.seats.map(s => s.name));
    const name = BOT_NAMES.find(n => !used.has(`${n} (IA)`)) ?? 'Bot';
    this.seats.push({ userId: null, name: `${name} (IA)`, conn: null, isBot: true, botLevel: level, disconnectedAt: null, timeouts: 0, registered: false });
    this.broadcastLobby();
    return true;
  }

  attach(seat: number, conn: Conn) {
    const s = this.seats[seat];
    if (s.conn && s.conn !== conn) { s.conn.send({ t: 'error', code: 'SESSION_REPLACED', message: 'Sesión abierta en otro dispositivo' }); s.conn.roomCode = undefined; }
    s.conn = conn;
    s.disconnectedAt = null;
    s.ip = conn.ip;
    conn.roomCode = this.code;
    const g = this.graceTimers.get(seat);
    if (g) { clearTimeout(g); this.graceTimers.delete(seat); }
    if (this.started) { this.sendState(seat); this.broadcastPresence(); }
    else this.broadcastLobby();
  }

  detach(conn: Conn) {
    const seat = this.seats.findIndex(s => s.conn === conn);
    if (seat < 0) return;
    const s = this.seats[seat];
    s.conn = null;
    s.disconnectedAt = Date.now();
    if (!this.started) {
      // en lobby, salir libera el asiento
      this.seats.splice(seat, 1);
      if (this.hostUserId === s.userId) this.hostUserId = this.humans[0]?.userId ?? null;
      this.broadcastLobby();
      if (!this.humans.length) this.mgr.dispose(this);
      return;
    }
    this.broadcastPresence();
    // Gracia para reconectar; después un bot toma el asiento para no bloquear la partida.
    const t = setTimeout(() => {
      this.graceTimers.delete(seat);
      if (this.seats[seat].conn || !this.game || this.game.status === 'finished') return;
      this.botTakeover(seat, 'desconexión');
    }, this.mgr.cfg.reconnectGraceSeconds * 1000);
    this.graceTimers.set(seat, t);
  }

  leave(conn: Conn) {
    const seat = this.seats.findIndex(s => s.conn === conn);
    if (seat < 0) return;
    if (this.started && this.game && this.game.status !== 'finished') {
      this.seats[seat].conn = null;
      conn.roomCode = undefined;
      this.botTakeover(seat, 'abandono');
      this.mgr.store.audit('player_abandon', { room: this.code, match: this.matchId, seat, user: this.seats[seat].userId });
    } else {
      conn.roomCode = undefined;
      this.detach(conn);
    }
  }

  botTakeover(seat: number, reason: string) {
    if (!this.game) return;
    const s = this.seats[seat];
    s.isBot = true;
    s.botLevel = 'intermedio';
    this.game = replaceWithBot(this.game, seat, 'intermedio');
    this.systemChat(`${s.name} fue reemplazado por la IA (${reason}).`);
    this.broadcastState();
    this.scheduleBot();
  }

  start(byUserId: string | null): string | null {
    if (this.started) return 'La partida ya comenzó';
    if (byUserId && byUserId !== this.hostUserId) return 'Solo el anfitrión puede iniciar';
    if (this.teams && this.seats.length !== 4) return 'El modo equipos requiere 4 jugadores';
    if (this.seats.length < 2) return 'Se necesitan al menos 2 jugadores';
    this.game = createGame(this.matchId, this.seats.map((s, i) => ({ id: s.userId ?? `bot${i}`, name: s.name, isBot: s.isBot, botLevel: s.botLevel })), {
      teams: this.teams, turnSeconds: this.turnSeconds, rounds: this.rounds,
    });
    this.mgr.store.startMatch(this.matchId, this.mode, this.seats.map(s => ({ userId: s.userId, name: s.name, bot: s.isBot })), this.tournamentId);
    this.mgr.store.audit('match_start', { match: this.matchId, room: this.code, mode: this.mode, seats: this.seats.map(s => s.userId ?? s.name), poolCommit: this.poolCommitment() });
    this.collusionCheck();
    this.onTurnStart();
    return null;
  }

  /** Compromiso criptográfico del orden del pozo: se publica el hash al iniciar y el orden al terminar. */
  private poolCommitment() {
    return createHash('sha256').update(JSON.stringify(this.game!.pool)).digest('hex');
  }

  private collusionCheck() {
    if (this.mode === 'private') return;
    const ips = this.humans.map(s => s.ip).filter(Boolean);
    if (new Set(ips).size < ips.length) {
      this.mgr.store.addReport(null, null, this.matchId, 'Automático: varios jugadores desde la misma IP en partida pública (posible colusión)');
    }
  }

  handleMove(conn: Conn, msg: { t: 'play' | 'draw'; table?: unknown; turn?: unknown; nonce?: unknown }) {
    if (!this.game) return conn.send({ t: 'error', code: 'NOT_STARTED', message: 'La partida no ha comenzado' });
    const seat = this.seats.findIndex(s => s.conn === conn);
    if (seat < 0) return conn.send({ t: 'error', code: 'NOT_SEATED', message: 'No estás en esta partida' });
    if (typeof msg.nonce !== 'string' || msg.nonce.length < 8 || msg.nonce.length > 64)
      return conn.send({ t: 'error', code: 'BAD_NONCE', message: 'Movimiento sin identificador' });
    const nonceKey = `${seat}:${msg.nonce}`;
    if (this.nonces.has(nonceKey)) return conn.send({ t: 'error', code: 'DUPLICATE_MOVE', message: 'Movimiento duplicado ignorado' });
    if (msg.turn !== this.game.turnNumber) return conn.send({ t: 'move_rejected', code: 'STALE_TURN', message: 'El turno ya cambió', state: this.viewMsg(seat) });
    this.nonces.add(nonceKey);
    if (this.nonces.size > 5000) this.nonces.clear();
    const move: Move = msg.t === 'play' ? { type: 'play', table: msg.table as number[][] } : { type: 'draw' };
    const r = applyMove(this.game, seat, move);
    if (!r.ok) {
      // El estado no cambia: el cliente restaura la mesa del inicio del turno.
      return conn.send({ t: 'move_rejected', code: r.code, message: r.message, state: this.viewMsg(seat) });
    }
    this.seats[seat].timeouts = 0;
    this.commit(r.state, r.drawn, seat);
  }

  private commit(next: GameState, drawn: number[] | undefined, seat: number) {
    const integrity = checkIntegrity(next);
    if (integrity) {
      this.mgr.store.logError('integrity', `${this.matchId}: ${integrity}`);
      this.mgr.store.audit('integrity_violation', { match: this.matchId, error: integrity });
      return; // nunca se aplica un estado corrupto
    }
    const last = next.events[next.events.length - 1];
    this.game = next;
    if (last) this.broadcast({ t: 'event', event: last, name: this.seats[seat]?.name });
    if (drawn?.length && this.seats[seat].conn) this.seats[seat].conn!.send({ t: 'drawn', tiles: drawn });
    if (next.status === 'playing') this.onTurnStart();
    else this.onRoundEnd();
  }

  snapshot() {
    return {
      code: this.code, matchId: this.matchId, mode: this.mode, size: this.size, teams: this.teams, turnSeconds: this.turnSeconds, rounds: this.rounds,
      tournamentId: this.tournamentId, hostUserId: this.hostUserId, game: this.game, chat: this.chat.slice(-30),
      seats: this.seats.map(s => ({ userId: s.userId, name: s.name, isBot: s.isBot, botLevel: s.botLevel, registered: s.registered, timeouts: s.timeouts })),
    };
  }

  persist() {
    if (!this.game) return;
    if (this.game.status === 'finished') this.mgr.store.deleteActive(this.code);
    else this.mgr.store.saveActive(this.code, this.snapshot());
  }

  /** Tras reiniciar el servidor: todos los humanos quedan desconectados con su período de gracia. */
  resumeAfterRestart() {
    this.seats.forEach((s, i) => {
      if (s.isBot || s.conn) return;
      s.disconnectedAt = Date.now();
      const t = setTimeout(() => {
        this.graceTimers.delete(i);
        if (!this.seats[i].conn && this.game && this.game.status !== 'finished') this.botTakeover(i, 'no regresó tras el reinicio');
      }, this.mgr.cfg.reconnectGraceSeconds * 1000);
      this.graceTimers.set(i, t);
    });
    if (this.game?.status === 'round_over') this.onRoundEnd();
    else this.onTurnStart();
  }

  private onTurnStart() {
    if (!this.game) return;
    this.persist();
    this.clearTimers();
    const secs = this.game.config.turnSeconds;
    this.deadline = secs > 0 ? Date.now() + secs * 1000 : null;
    if (this.deadline) this.turnTimer = setTimeout(() => this.onTimeout(), secs * 1000 + 300);
    this.broadcastState();
    this.scheduleBot();
  }

  private onTimeout() {
    if (!this.game || this.game.status !== 'playing') return;
    const seat = this.game.turn;
    const r = applyTimeout(this.game);
    if (!r.ok) return;
    const s = this.seats[seat];
    s.timeouts++;
    this.systemChat(`Se agotó el tiempo de ${s.name}.`);
    if (s.timeouts >= 3 && !s.isBot) {
      // Inactividad: tres turnos seguidos sin actuar.
      this.commit(r.state, r.drawn, seat);
      return this.botTakeover(seat, 'inactividad');
    }
    this.commit(r.state, r.drawn, seat);
  }

  private scheduleBot() {
    if (!this.game || this.game.status !== 'playing') return;
    const seat = this.game.turn;
    const s = this.seats[seat];
    if (!s.isBot) return;
    if (this.botTimer) clearTimeout(this.botTimer);
    const delay = this.mgr.botDelayMs();
    this.botTimer = setTimeout(() => {
      if (!this.game || this.game.turn !== seat || this.game.status !== 'playing') return;
      let move: Move;
      try { move = chooseMove(viewFor(this.game, seat), s.botLevel ?? 'intermedio'); }
      catch (e) { this.mgr.store.logError('ai', String(e)); move = { type: 'draw' }; }
      let r = applyMove(this.game, seat, move);
      if (!r.ok) { this.mgr.store.logError('ai', `jugada IA rechazada: ${r.message}`); r = applyMove(this.game, seat, { type: 'draw' }); }
      if (r.ok) this.commit(r.state, r.drawn, seat);
    }, delay);
  }

  private onRoundEnd() {
    if (!this.game) return;
    this.clearTimers();
    this.deadline = null;
    const g = this.game;
    this.persist();
    this.broadcastState();
    this.mgr.store.audit('round_end', { match: this.matchId, round: g.round, result: g.history[g.history.length - 1] });
    if (g.status === 'round_over') {
      this.nextRoundTimer = setTimeout(() => {
        if (!this.game) return;
        this.game = dealRound(this.game);
        this.onTurnStart();
      }, this.mgr.nextRoundDelayMs);
      return;
    }
    // Partida terminada: persistir, clasificar, revelar el orden del pozo (auditoría de aleatoriedad).
    const w = matchWinner(g);
    const ts = teamScores(g);
    const won = (i: number) => (ts ? i % 2 === w.team : i === w.seat);
    this.mgr.store.finishMatch(this.matchId, { scores: g.scores, teams: ts, winnerSeat: w.seat, winnerTeam: w.team, history: g.history },
      this.seats.map((s, i) => ({ userId: s.registered && !s.isBot ? s.userId : null, score: g.scores[i], won: won(i) })));
    const rated = this.seats.map((s, i) => ({ s, i })).filter(x => x.s.registered && x.s.userId && (!x.s.isBot || x.s.disconnectedAt));
    if (this.mode !== 'private' && rated.length >= 2) {
      const order = [...rated].sort((a, b) => (won(b.i) ? 1 : 0) - (won(a.i) ? 1 : 0) || g.scores[b.i] - g.scores[a.i]);
      this.mgr.store.updateRatings(order.map((x, place) => ({ userId: x.s.userId!, place: won(x.i) ? 0 : place })));
    }
    this.mgr.store.audit('match_end', { match: this.matchId, scores: g.scores, winner: w });
    this.broadcast({ t: 'game_over', scores: g.scores, teams: ts, winnerSeat: w.seat, winnerTeam: w.team, history: g.history });
    this.onFinish?.(this, w.seat);
    setTimeout(() => this.mgr.dispose(this), 5 * 60 * 1000).unref?.();
  }

  handleChat(conn: Conn, text: unknown) {
    if (!conn.chatLimiter.take(conn.id)) return conn.send({ t: 'error', code: 'CHAT_RATE', message: 'Estás enviando mensajes muy rápido' });
    const m = moderate(text);
    if (!m.ok) return conn.send({ t: 'error', code: 'CHAT_BLOCKED', message: m.reason });
    const entry = { name: conn.user.name, text: m.text, at: Date.now() };
    this.chat.push(entry);
    if (this.chat.length > 100) this.chat.shift();
    this.broadcast({ t: 'chat', ...entry });
  }

  handleEmote(conn: Conn, e: unknown) {
    if (typeof e !== 'string' || !EMOTES.includes(e)) return;
    if (!conn.chatLimiter.take(conn.id)) return;
    const seat = this.seats.findIndex(s => s.conn === conn);
    this.broadcast({ t: 'emote', seat, e });
  }

  systemChat(text: string) {
    const entry = { name: 'EKO', text, at: Date.now() };
    this.chat.push(entry);
    this.broadcast({ t: 'chat', ...entry, system: true });
  }

  private clearTimers() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.nextRoundTimer) clearTimeout(this.nextRoundTimer);
    this.turnTimer = this.botTimer = this.nextRoundTimer = null;
  }

  dispose(keepSnapshot = false) {
    this.clearTimers();
    if (!keepSnapshot) this.mgr.store.deleteActive(this.code);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    for (const s of this.seats) if (s.conn?.roomCode === this.code) s.conn.roomCode = undefined;
  }

  // ---- difusión
  lobbyMsg() {
    return { t: 'lobby', code: this.code, mode: this.mode, size: this.size, teams: this.teams, turnSeconds: this.turnSeconds, host: this.hostUserId,
      seats: this.seats.map(s => ({ name: s.name, isBot: s.isBot, botLevel: s.botLevel, connected: !!s.conn || s.isBot, you: false })) };
  }
  broadcastLobby() {
    for (const s of this.seats) if (s.conn) {
      const m = this.lobbyMsg();
      m.seats = m.seats.map((x, i) => ({ ...x, you: this.seats[i] === s }));
      s.conn.send({ ...m, isHost: s.userId === this.hostUserId });
    }
  }
  viewMsg(seat: number) {
    return {
      t: 'state', code: this.code, mode: this.mode, view: viewFor(this.game!, seat), deadline: this.deadline, serverNow: Date.now(),
      presence: this.seats.map(s => ({ connected: s.isBot || !!s.conn, isBot: s.isBot })), chat: this.chat.slice(-30),
    };
  }
  sendState(seat: number) { const c = this.seats[seat].conn; if (c && this.game) c.send(this.viewMsg(seat)); }
  broadcastState() { this.seats.forEach((_, i) => this.sendState(i)); }
  broadcastPresence() { this.broadcast({ t: 'presence', presence: this.seats.map(s => ({ connected: s.isBot || !!s.conn, isBot: s.isBot })) }); }
  broadcast(msg: unknown) { for (const s of this.seats) s.conn?.send(msg); }
}

export class RoomManager {
  rooms = new Map<string, Room>();
  queues = new Map<string, { conn: Conn; since: number }[]>();
  nextRoundDelayMs = 8000;
  private botDelay: [number, number] = [700, 1600];
  private queueTimer: NodeJS.Timeout;

  store: Store;
  cfg: Config;
  constructor(store: Store, cfg: Config) {
    this.store = store; this.cfg = cfg;
    this.queueTimer = setInterval(() => this.fillQueuesWithBots(), 2000);
    this.queueTimer.unref?.();
  }

  setBotDelay(min: number, max: number) { this.botDelay = [min, max]; }
  botDelayMs() { return this.botDelay[0] + Math.floor(Math.random() * (this.botDelay[1] - this.botDelay[0] + 1)); }

  newCode(): string {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) {
      let c = '';
      for (let i = 0; i < 6; i++) c += A[randomInt(A.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  create(mode: RoomMode, size: number, teams: boolean, turnSeconds?: number, rounds = 1, tournamentId: string | null = null) {
    const r = new Room(this, mode, teams ? 4 : Math.min(4, Math.max(2, size | 0)), teams, clampTurn(turnSeconds ?? this.cfg.turnSeconds), Math.min(5, Math.max(1, rounds | 0)), tournamentId);
    this.rooms.set(r.code, r);
    return r;
  }

  dispose(r: Room) { r.dispose(); this.rooms.delete(r.code); }

  /** Reconstruye las salas en curso guardadas antes de una caída o reinicio. */
  restoreActive(): number {
    let n = 0;
    for (const { snapshot: s } of this.store.loadActive()) {
      try {
        const r = new Room(this, s.mode, s.size, s.teams, s.turnSeconds, s.rounds, s.tournamentId);
        r.code = s.code; r.matchId = s.matchId; r.hostUserId = s.hostUserId; r.chat = s.chat ?? []; r.game = s.game;
        r.seats = s.seats.map((x: any) => ({ ...x, conn: null, disconnectedAt: Date.now() }));
        this.rooms.set(r.code, r);
        r.systemChat('El servidor se reinició; la partida continúa donde se quedó.');
        r.resumeAfterRestart();
        n++;
      } catch (e) { this.store.logError('restore', String(e)); this.store.deleteActive(s.code); }
    }
    return n;
  }

  findSeatFor(userId: string): Room | undefined {
    for (const r of this.rooms.values()) if (r.started && r.game?.status !== 'finished' && r.seatOf(userId) >= 0) return r;
    return undefined;
  }

  // ---- emparejamiento automático
  queueKey(size: number, teams: boolean) { return teams ? 'teams' : `ffa${size}`; }

  enqueue(conn: Conn, size: number, teams: boolean) {
    this.dequeue(conn);
    const key = this.queueKey(teams ? 4 : Math.min(4, Math.max(2, size | 0)), teams);
    const q = this.queues.get(key) ?? [];
    q.push({ conn, since: Date.now() });
    this.queues.set(key, q);
    conn.send({ t: 'queued', key, position: q.length });
    this.tryMatch(key);
  }

  dequeue(conn: Conn) {
    for (const [k, q] of this.queues) this.queues.set(k, q.filter(e => e.conn !== conn));
  }

  private tryMatch(key: string) {
    const q = this.queues.get(key) ?? [];
    const teams = key === 'teams';
    const need = teams ? 4 : Number(key.slice(3));
    while (q.length >= need) {
      const group = q.splice(0, need);
      const room = this.create(teams ? 'teams' : 'quick', need, teams);
      for (const e of group) room.addHuman(e.conn);
      room.start(null);
    }
  }

  /** Si nadie más llega a tiempo, la partida rápida se completa con IA. */
  fillQueuesWithBots() {
    const waitMs = this.cfg.quickMatchBotFillSeconds * 1000;
    for (const [key, q] of this.queues) {
      if (!q.length || Date.now() - q[0].since < waitMs) continue;
      const teams = key === 'teams';
      const need = teams ? 4 : Number(key.slice(3));
      const group = q.splice(0, Math.min(q.length, need));
      const room = this.create(teams ? 'teams' : 'quick', need, teams);
      for (const e of group) room.addHuman(e.conn);
      while (room.seats.length < need) room.addBot(AI_LEVELS[1 + (room.seats.length % 3)]);
      room.start(null);
    }
  }

  stats() {
    let active = 0, lobby = 0, players = 0;
    for (const r of this.rooms.values()) {
      if (r.started && r.game?.status !== 'finished') active++; else if (!r.started) lobby++;
      players += r.seats.filter(s => s.conn).length;
    }
    return { roomsActive: active, roomsLobby: lobby, seatedPlayers: players, queued: [...this.queues.values()].reduce((a, q) => a + q.length, 0) };
  }

  activeList() {
    return [...this.rooms.values()].map(r => ({
      code: r.code, mode: r.mode, started: r.started, status: r.game?.status ?? 'lobby', round: r.game?.round ?? 0, turnNumber: r.game?.turnNumber ?? 0,
      players: r.seats.map(s => ({ name: s.name, bot: s.isBot, connected: !!s.conn })), createdAt: r.createdAt,
    }));
  }

  /** Apagado: se conservan los respaldos de partidas activas para reanudarlas al volver. */
  shutdown() { clearInterval(this.queueTimer); for (const r of this.rooms.values()) r.dispose(true); this.rooms.clear(); }
}

function clampTurn(s: number) {
  if (!Number.isFinite(s)) return 90;
  if (s === 0) return 0;
  return Math.min(300, Math.max(20, Math.round(s)));
}

export { AI_LEVELS };
