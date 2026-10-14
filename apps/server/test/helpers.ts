import { loadConfig, type Config } from '../src/config.ts';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { chooseMove, type AiLevel } from '../../../packages/engine/src/index.ts';

export async function startServer(over: Partial<Config> = {}, store?: Store) {
  const cfg = loadConfig({
    env: 'test', port: 0, host: '127.0.0.1', dbPath: ':memory:', authSecret: 'test-secret-'.padEnd(40, 'x'),
    turnSeconds: 60, reconnectGraceSeconds: 1, quickMatchBotFillSeconds: 1, adminUsers: ['admin_eko'],
    complianceFile: '/nonexistent/approvals.json', staticDir: '/tmp', ...over,
  });
  const app = createApp(cfg, store ?? new Store(cfg.dbPath));
  app.rooms.setBotDelay(60, 70); // un humano nunca supera el límite de 10 mensajes/s
  app.rooms.nextRoundDelayMs = 30;
  const port = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const api = async (method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  return { app, cfg, port, base, api, close: () => app.close() };
}

export class Client {
  ws!: WebSocket;
  msgs: any[] = [];
  private waiters: { pred: (m: any) => boolean; res: (m: any) => void; rej: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  state: any = null;
  rackSeen: number[][] = [];
  private n = 0;
  url: string;
  token: string;

  constructor(port: number, token: string) { this.url = `ws://127.0.0.1:${port}/ws`; this.token = token; }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise<void>((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('ws error')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(String(ev.data));
      if (m.t === 'state') { this.state = m; this.rackSeen.push(m.view.rack); }
      if (m.t === 'move_rejected' && m.state) this.state = m.state;
      this.msgs.push(m);
      for (const w of [...this.waiters]) if (w.pred(m)) { clearTimeout(w.timer); this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
    };
    this.send({ t: 'hello', token: this.token });
    await this.wait(m => m.t === 'welcome');
    return this;
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  wait(pred: (m: any) => boolean, ms = 8000): Promise<any> {
    const found = this.msgs.find(pred);
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`timeout esperando mensaje; últimos: ${JSON.stringify(this.msgs.slice(-3).map(x => x.t))}`)), ms);
      this.waiters.push({ pred: m => { if (pred(m)) { this.msgs.splice(this.msgs.indexOf(m), 1); return true; } return false; }, res, rej, timer });
    });
  }
  nonce() { return `n${Date.now()}${this.n++}${Math.random().toString(36).slice(2, 8)}`; }
  myTurn() { return this.state && this.state.view.status === 'playing' && this.state.view.turn === this.state.view.seat; }
  /** Juega su turno con la IA local, como lo haría un jugador humano desde el cliente. */
  autoPlay(level: AiLevel = 'intermedio') {
    const v = this.state.view;
    const m = chooseMove(v, level);
    if (m.type === 'play') this.send({ t: 'play', table: m.table, turn: v.turnNumber, nonce: this.nonce() });
    else this.send({ t: 'draw', turn: v.turnNumber, nonce: this.nonce() });
  }
  close() { try { this.ws.close(); } catch {} }
}

export async function guest(api: any, name: string) { return (await api('POST', '/api/auth/guest', { name })).body.token as string; }

/** Lleva una partida a su fin: cada cliente juega cuando le toca. */
export async function playToEnd(clients: Client[], timeoutMs = 60000) {
  const t0 = Date.now();
  const done = clients.map(c => c.wait(m => m.t === 'game_over', timeoutMs));
  let over = false;
  done[0].then(() => { over = true; }, () => {});
  const lastPlayed = new Map<Client, number>();
  const lastSent = new Map<Client, number>();
  while (!over && Date.now() - t0 < timeoutMs) {
    for (const c of clients) {
      // ritmo humano: como máximo ~8 jugadas por segundo por dispositivo
      if (c.myTurn() && lastPlayed.get(c) !== c.state.view.turnNumber && Date.now() - (lastSent.get(c) ?? 0) > 120) {
        lastPlayed.set(c, c.state.view.turnNumber);
        lastSent.set(c, Date.now());
        c.autoPlay();
      }
    }
    await new Promise(r => setTimeout(r, 3));
  }
  return Promise.all(done);
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
