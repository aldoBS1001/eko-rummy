// Persistencia. Implementación SQLite (node:sqlite, sin dependencias) para desarrollo y servidores
// de un nodo. El esquema es SQL estándar y se replica para PostgreSQL en db/migrations/001_init.pg.sql.
// Incluye un registro de auditoría encadenado por hash: cada evento crítico guarda el hash del anterior,
// así cualquier alteración posterior es detectable (verifyAudit).

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface UserRow { id: string; username: string; pass_hash: string; role: string; banned: number; rating: number; created_at: number; cosmetics: string; wallet: string | null; terms_version: string | null; adult_declared: number | null; terms_at: number | null; kyc_status: string; kyc_applicant: string | null; kyc_updated: number | null; kyc_labels: string | null }

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'player', banned INTEGER NOT NULL DEFAULT 0,
     rating INTEGER NOT NULL DEFAULT 1200, created_at INTEGER NOT NULL,
     cosmetics TEXT NOT NULL DEFAULT '[]', wallet TEXT)`,
  `CREATE TABLE IF NOT EXISTS logins (user_id TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS matches (
     id TEXT PRIMARY KEY, mode TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
     players TEXT NOT NULL, result TEXT, tournament_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS match_players (match_id TEXT NOT NULL, user_id TEXT NOT NULL, score INTEGER NOT NULL, won INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS friends (user_id TEXT NOT NULL, friend_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, friend_id))`,
  `CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reporter TEXT, target TEXT, match_id TEXT, reason TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open')`,
  `CREATE TABLE IF NOT EXISTS purchases (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, product TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL,
     stripe_session TEXT UNIQUE, stripe_event TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, refunded_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS errors (at INTEGER NOT NULL, source TEXT NOT NULL, message TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS flags (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS active_games (code TEXT PRIMARY KEY, snapshot TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_mp_user ON match_players(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_logins ON logins(user_id, at)`,
];

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    for (const m of MIGRATIONS) this.db.exec(m);
    // columnas agregadas después de la versión inicial
    const cols = new Set((this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name));
    if (!cols.has('terms_version')) this.db.exec('ALTER TABLE users ADD COLUMN terms_version TEXT');
    if (!cols.has('adult_declared')) this.db.exec('ALTER TABLE users ADD COLUMN adult_declared INTEGER');
    if (!cols.has('terms_at')) this.db.exec('ALTER TABLE users ADD COLUMN terms_at INTEGER');
    if (!cols.has('kyc_status')) this.db.exec("ALTER TABLE users ADD COLUMN kyc_status TEXT NOT NULL DEFAULT 'none'");
    if (!cols.has('kyc_applicant')) this.db.exec('ALTER TABLE users ADD COLUMN kyc_applicant TEXT');
    if (!cols.has('kyc_updated')) this.db.exec('ALTER TABLE users ADD COLUMN kyc_updated INTEGER');
    if (!cols.has('kyc_labels')) this.db.exec('ALTER TABLE users ADD COLUMN kyc_labels TEXT');
  }

  /** Actualiza el estado KYC. Un resultado final no se pisa con eventos atrasados de "pendiente". */
  setKyc(userId: string, status: string, applicantId?: string, labels?: string[], force = false): boolean {
    const u = this.userById(userId);
    if (!u) return false;
    const final = ['approved', 'rejected'];
    if (!force && final.includes(u.kyc_status) && !final.includes(status) && status !== 'retry') return false;
    this.db.prepare('UPDATE users SET kyc_status = ?, kyc_applicant = COALESCE(?, kyc_applicant), kyc_updated = ?, kyc_labels = ? WHERE id = ?')
      .run(status, applicantId ?? null, Date.now(), labels?.length ? JSON.stringify(labels) : null, userId);
    return true;
  }

  /** ¿Puede participar en funciones con valor económico? (mayoría de edad declarada + KYC aprobado) */
  economicEligibility(userId: string): { ok: boolean; reason?: string } {
    const u = this.userById(userId);
    if (!u) return { ok: false, reason: 'Cuenta inexistente' };
    if (u.banned) return { ok: false, reason: 'Cuenta bloqueada' };
    if (u.adult_declared !== 1) return { ok: false, reason: 'Falta declarar mayoría de edad' };
    if (u.kyc_status !== 'approved') return { ok: false, reason: 'Falta verificar identidad (KYC)' };
    return { ok: true };
  }

  /** Registra la aceptación de términos y la declaración de edad (autodeclaración, no verificación KYC). */
  acceptTerms(userId: string, version: string, adult: boolean) {
    this.db.prepare('UPDATE users SET terms_version = ?, adult_declared = ?, terms_at = ? WHERE id = ?').run(version, adult ? 1 : 0, Date.now(), userId);
  }

  // ---- usuarios
  createUser(username: string, passHash: string, role = 'player'): UserRow {
    const id = randomUUID();
    this.db.prepare('INSERT INTO users (id, username, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, username, passHash, role, Date.now());
    return this.userById(id)!;
  }
  userByName(username: string) { return this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as unknown as UserRow | undefined; }
  userById(id: string) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined; }
  setBanned(id: string, banned: boolean) { this.db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, id); }
  setRole(id: string, role: string) { this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id); }
  setWallet(id: string, wallet: string | null) { this.db.prepare('UPDATE users SET wallet = ? WHERE id = ?').run(wallet, id); }
  addCosmetic(id: string, item: string) {
    const u = this.userById(id); if (!u) return;
    const list = new Set<string>(JSON.parse(u.cosmetics)); list.add(item);
    this.db.prepare('UPDATE users SET cosmetics = ? WHERE id = ?').run(JSON.stringify([...list]), id);
  }
  removeCosmetic(id: string, item: string) {
    const u = this.userById(id); if (!u) return;
    const list = (JSON.parse(u.cosmetics) as string[]).filter(x => x !== item);
    this.db.prepare('UPDATE users SET cosmetics = ? WHERE id = ?').run(JSON.stringify(list), id);
  }
  recordLogin(userId: string) { this.db.prepare('INSERT INTO logins VALUES (?, ?)').run(userId, Date.now()); }
  listUsers(limit = 100, offset = 0) {
    return this.db.prepare('SELECT id, username, role, banned, rating, created_at, wallet, adult_declared, kyc_status FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  }

  // ---- partidas y clasificación
  startMatch(id: string, mode: string, players: unknown, tournamentId: string | null = null) {
    this.db.prepare('INSERT INTO matches (id, mode, started_at, players, tournament_id) VALUES (?, ?, ?, ?, ?)').run(id, mode, Date.now(), JSON.stringify(players), tournamentId);
  }
  finishMatch(id: string, result: unknown, players: { userId: string | null; score: number; won: boolean }[]) {
    this.db.prepare('UPDATE matches SET ended_at = ?, result = ? WHERE id = ?').run(Date.now(), JSON.stringify(result), id);
    const ins = this.db.prepare('INSERT INTO match_players VALUES (?, ?, ?, ?)');
    for (const p of players) if (p.userId) ins.run(id, p.userId, p.score, p.won ? 1 : 0);
  }
  /** Elo multijugador por pares. */
  updateRatings(results: { userId: string; place: number }[]) {
    const K = 24;
    const rows = results.map(r => ({ ...r, rating: this.userById(r.userId)?.rating ?? 1200 }));
    const delta = rows.map(() => 0);
    for (let i = 0; i < rows.length; i++) for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      const exp = 1 / (1 + 10 ** ((rows[j].rating - rows[i].rating) / 400));
      const s = rows[i].place < rows[j].place ? 1 : rows[i].place === rows[j].place ? 0.5 : 0;
      delta[i] += (K / Math.max(1, rows.length - 1)) * (s - exp);
    }
    const up = this.db.prepare('UPDATE users SET rating = ? WHERE id = ?');
    rows.forEach((r, i) => up.run(Math.round(r.rating + delta[i]), r.userId));
  }
  leaderboard(limit = 50) {
    return this.db.prepare(`SELECT u.username, u.rating,
        COUNT(mp.match_id) AS played, COALESCE(SUM(mp.won), 0) AS wins
      FROM users u LEFT JOIN match_players mp ON mp.user_id = u.id
      WHERE u.banned = 0 GROUP BY u.id ORDER BY u.rating DESC, wins DESC LIMIT ?`).all(limit);
  }
  userStats(userId: string) {
    return this.db.prepare(`SELECT COUNT(*) AS played, COALESCE(SUM(won),0) AS wins, COALESCE(SUM(score),0) AS points, COALESCE(MAX(score),0) AS best FROM match_players WHERE user_id = ?`).get(userId);
  }
  history(userId: string, limit = 20) {
    return this.db.prepare(`SELECT m.id, m.mode, m.started_at, m.ended_at, mp.score, mp.won FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = ? ORDER BY m.ended_at DESC LIMIT ?`).all(userId, limit);
  }

  // ---- amigos
  addFriend(a: string, b: string) {
    const st = this.db.prepare('INSERT OR IGNORE INTO friends VALUES (?, ?, ?)');
    st.run(a, b, Date.now()); st.run(b, a, Date.now());
  }
  removeFriend(a: string, b: string) { this.db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(a, b, b, a); }
  friends(userId: string) {
    return this.db.prepare('SELECT u.id, u.username, u.rating FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.username').all(userId) as { id: string; username: string; rating: number }[];
  }

  // ---- reportes, errores, flags
  addReport(reporter: string | null, target: string | null, matchId: string | null, reason: string) {
    this.db.prepare('INSERT INTO reports (id, reporter, target, match_id, reason, at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), reporter, target, matchId, reason.slice(0, 500), Date.now());
  }
  reports(status = 'open') { return this.db.prepare('SELECT * FROM reports WHERE status = ? ORDER BY at DESC LIMIT 200').all(status); }
  setReportStatus(id: string, status: string) { this.db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, id); }
  logError(source: string, message: string) {
    this.db.prepare('INSERT INTO errors VALUES (?, ?, ?)').run(Date.now(), source, String(message).slice(0, 2000));
  }
  errors(limit = 100) { return this.db.prepare('SELECT * FROM errors ORDER BY at DESC LIMIT ?').all(limit); }
  getFlag(key: string): string | undefined { return (this.db.prepare('SELECT value FROM flags WHERE key = ?').get(key) as { value: string } | undefined)?.value; }
  setFlag(key: string, value: string) { this.db.prepare('INSERT INTO flags VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value); }
  flags() { return Object.fromEntries((this.db.prepare('SELECT key, value FROM flags').all() as { key: string; value: string }[]).map(r => [r.key, r.value])); }

  // ---- compras (Stripe)
  createPurchase(userId: string, product: string, amount: number, currency: string, session: string) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO purchases (id, user_id, product, amount, currency, stripe_session, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, userId, product, amount, currency, session, 'pending', Date.now());
    return id;
  }
  purchaseBySession(session: string) { return this.db.prepare('SELECT * FROM purchases WHERE stripe_session = ?').get(session) as any; }
  setPurchaseStatus(session: string, status: string, eventId: string) {
    this.db.prepare(`UPDATE purchases SET status = ?, stripe_event = ?, refunded_at = CASE WHEN ? = 'refunded' THEN ? ELSE refunded_at END WHERE stripe_session = ?`).run(status, eventId, status, Date.now(), session);
  }
  purchases(userId?: string) {
    return userId
      ? this.db.prepare('SELECT id, product, amount, currency, status, created_at FROM purchases WHERE user_id = ? ORDER BY created_at DESC').all(userId)
      : this.db.prepare('SELECT p.*, u.username FROM purchases p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 200').all();
  }
  /** true si el evento ya se había procesado (idempotencia de webhooks). */
  markStripeEvent(id: string, type: string): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO stripe_events VALUES (?, ?, ?)').run(id, type, Date.now());
    return r.changes === 0;
  }

  // ---- partidas activas (recuperación ante caídas del servidor)
  saveActive(code: string, snapshot: unknown) {
    this.db.prepare('INSERT INTO active_games VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at').run(code, JSON.stringify(snapshot), Date.now());
  }
  deleteActive(code: string) { this.db.prepare('DELETE FROM active_games WHERE code = ?').run(code); }
  loadActive(): { code: string; snapshot: any }[] {
    return (this.db.prepare('SELECT code, snapshot FROM active_games WHERE updated_at > ?').all(Date.now() - 6 * 3600000) as any[]).map(r => ({ code: r.code, snapshot: JSON.parse(r.snapshot) }));
  }

  // ---- auditoría encadenada
  audit(type: string, payload: unknown) {
    const last = this.db.prepare('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1').get() as { hash: string } | undefined;
    const prev = last?.hash ?? 'GENESIS';
    const at = Date.now();
    const body = JSON.stringify(payload);
    const hash = createHash('sha256').update(`${prev}|${at}|${type}|${body}`).digest('hex');
    this.db.prepare('INSERT INTO audit (at, type, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?)').run(at, type, body, prev, hash);
    return hash;
  }
  verifyAudit(): { ok: boolean; brokenAt?: number; count: number } {
    const rows = this.db.prepare('SELECT * FROM audit ORDER BY seq').all() as any[];
    let prev = 'GENESIS';
    for (const r of rows) {
      const h = createHash('sha256').update(`${prev}|${r.at}|${r.type}|${r.payload}`).digest('hex');
      if (r.prev_hash !== prev || r.hash !== h) return { ok: false, brokenAt: r.seq, count: rows.length };
      prev = r.hash;
    }
    return { ok: true, count: rows.length };
  }

  // ---- métricas
  metrics() {
    const one = (sql: string, ...a: any[]) => Object.values(this.db.prepare(sql).get(...a) as object)[0] as number;
    const day = 86400000, now = Date.now();
    const cohort = (d: number) => {
      // retención: usuarios creados hace ≥d días que volvieron a entrar después del día d
      const base = one('SELECT COUNT(*) FROM users WHERE created_at <= ?', now - d * day);
      const ret = one(`SELECT COUNT(DISTINCT u.id) FROM users u JOIN logins l ON l.user_id = u.id WHERE u.created_at <= ? AND l.at >= u.created_at + ?`, now - d * day, d * day);
      return base ? Math.round((ret / base) * 1000) / 10 : null;
    };
    return {
      usersRegistered: one('SELECT COUNT(*) FROM users'),
      usersBanned: one('SELECT COUNT(*) FROM users WHERE banned = 1'),
      matchesFinished: one('SELECT COUNT(*) FROM matches WHERE ended_at IS NOT NULL'),
      matchesUnfinished: one('SELECT COUNT(*) FROM matches WHERE ended_at IS NULL'),
      matchesLast24h: one('SELECT COUNT(*) FROM matches WHERE started_at >= ?', now - day),
      activeUsers24h: one('SELECT COUNT(DISTINCT user_id) FROM logins WHERE at >= ?', now - day),
      retentionD1: cohort(1),
      retentionD7: cohort(7),
      openReports: one(`SELECT COUNT(*) FROM reports WHERE status = 'open'`),
      termsAccepted: one('SELECT COUNT(*) FROM users WHERE terms_version IS NOT NULL'),
      adultsDeclared: one('SELECT COUNT(*) FROM users WHERE adult_declared = 1'),
      kycApproved: one(`SELECT COUNT(*) FROM users WHERE kyc_status = 'approved'`),
      kycPending: one(`SELECT COUNT(*) FROM users WHERE kyc_status IN ('started','pending','on_hold','retry')`),
      kycRejected: one(`SELECT COUNT(*) FROM users WHERE kyc_status = 'rejected'`),
      purchasesPaid: one(`SELECT COUNT(*) FROM purchases WHERE status = 'paid'`),
      revenueCents: one(`SELECT COALESCE(SUM(amount),0) FROM purchases WHERE status = 'paid'`),
      errors24h: one('SELECT COUNT(*) FROM errors WHERE at >= ?', now - day),
    };
  }
  recentMatches(limit = 50) { return this.db.prepare('SELECT id, mode, started_at, ended_at, players, result FROM matches ORDER BY started_at DESC LIMIT ?').all(limit); }
}
