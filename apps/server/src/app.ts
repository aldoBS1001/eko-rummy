// Servidor HTTP + WebSocket de EKO RUMMY (Node.js, sin frameworks).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Config } from './config.ts';
import { Store } from './store.ts';
import { hashPassword, verifyPassword, signToken, verifyToken, validateCredentials, RateLimiter, type TokenPayload } from './auth.ts';
import { RoomManager, AI_LEVELS, type Conn } from './rooms.ts';
import { TournamentManager } from './tournaments.ts';
import { PRODUCTS, stripeMode, createCheckout, verifyStripeSignature, handleStripeEvent } from './payments/stripe.ts';
import { EKOKIIN_VERIFIED, tokenInfo, balanceOf, transfers, isTronAddress } from './web3/tron.ts';
import { bettingStatus } from './betting/gate.ts';
import { kycEnabled, createLaunchCode, redeemLaunchCode, userForRefreshKey, createAccessToken, fetchApplicantStatus, verifyWebhook, parseWebhook } from './kyc/sumsub.ts';
import { moderate } from './chat.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};

const SAFE_FLAGS = new Set(['maintenance', 'chat_enabled', 'tournaments_enabled', 'registration_enabled', 'announcement']);

class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

export function createApp(cfg: Config, store = new Store(cfg.dbPath)) {
  const rooms = new RoomManager(store, cfg);
  const conns = new Map<string, Conn>();
  const byUser = new Map<string, Set<Conn>>();
  const notify = (userId: string, msg: unknown) => byUser.get(userId)?.forEach(c => c.send(msg));
  const tournaments = new TournamentManager(rooms, notify);
  const restored = rooms.restoreActive();
  if (restored) store.audit('server_restore', { rooms: restored });
  const httpLimiter = new RateLimiter(300, 10); // por IP (varios jugadores pueden compartir IP en una misma red)
  const authLimiter = new RateLimiter(10, 0.1); // intentos de login/registro por IP
  const flag = (k: string, d = '') => store.getFlag(k) ?? d;

  const ipOf = (req: http.IncomingMessage) =>
    (cfg.env === 'production' ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';

  function auth(req: http.IncomingMessage, required = true): TokenPayload | null {
    const h = req.headers.authorization;
    const p = h?.startsWith('Bearer ') ? verifyToken(h.slice(7), cfg.authSecret) : null;
    if (p && p.role !== 'guest') {
      const u = store.userById(p.sub);
      if (!u || u.banned) { if (required) throw new HttpError(403, 'Cuenta bloqueada'); return null; }
      p.role = u.role === 'admin' ? 'admin' : 'player'; // el rol se revalida contra la base en cada solicitud
    }
    if (!p && required) throw new HttpError(401, 'Inicia sesión');
    return p;
  }
  const registered = (req: http.IncomingMessage) => { const p = auth(req)!; if (p.role === 'guest') throw new HttpError(403, 'Requiere cuenta registrada'); return p; };
  const admin = (req: http.IncomingMessage) => { const p = auth(req)!; if (p.role !== 'admin') throw new HttpError(403, 'Solo administradores'); return p; };

  async function body(req: http.IncomingMessage, limit = 64 * 1024): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > limit) throw new HttpError(413, 'Solicitud demasiado grande'); chunks.push(c as Buffer); }
    return Buffer.concat(chunks).toString('utf8');
  }
  async function json(req: http.IncomingMessage): Promise<any> {
    const b = await body(req);
    if (!b) return {};
    try { return JSON.parse(b); } catch { throw new HttpError(400, 'JSON inválido'); }
  }

  function issue(u: { id: string; username: string; role: string }) {
    const role = u.role === 'admin' || cfg.adminUsers.includes(u.username.toLowerCase()) ? 'admin' : 'player';
    if (role === 'admin' && u.role !== 'admin') store.setRole(u.id, 'admin');
    store.recordLogin(u.id);
    return { token: signToken({ sub: u.id, name: u.username, role }, cfg.authSecret), user: { id: u.id, name: u.username, role } };
  }

  type Handler = (req: http.IncomingMessage, params: string[], url: URL) => Promise<unknown>;
  const routes: [string, RegExp, Handler][] = [];
  const route = (method: string, path: string, h: Handler) => routes.push([method, new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}$`), h]);

  route('GET', '/api/health', async () => ({ ok: true, time: Date.now(), rooms: rooms.stats() }));

  route('POST', '/api/auth/register', async req => {
    if (!authLimiter.take(ipOf(req))) throw new HttpError(429, 'Demasiados intentos, espera un momento');
    if (flag('registration_enabled', 'true') !== 'true') throw new HttpError(403, 'Registro temporalmente cerrado');
    const { username, password } = await json(req);
    const err = validateCredentials(username, password);
    if (err) throw new HttpError(400, err);
    if (store.userByName(username)) throw new HttpError(409, 'Ese usuario ya existe');
    const u = store.createUser(username, hashPassword(password));
    store.audit('user_register', { user: u.id });
    return issue(u);
  });

  route('POST', '/api/auth/login', async req => {
    if (!authLimiter.take(ipOf(req))) throw new HttpError(429, 'Demasiados intentos, espera un momento');
    const { username, password } = await json(req);
    const u = typeof username === 'string' ? store.userByName(username) : undefined;
    const ok = u && typeof password === 'string' && verifyPassword(password, u.pass_hash);
    if (!ok) throw new HttpError(401, 'Usuario o contraseña incorrectos');
    if (u!.banned) throw new HttpError(403, 'Cuenta bloqueada');
    return issue(u!);
  });

  route('POST', '/api/auth/guest', async req => {
    const { name } = await json(req);
    const clean = typeof name === 'string' ? moderate(name) : null;
    const nm = clean && clean.ok && !clean.censored ? clean.text.slice(0, 16) : `Invitado${Math.floor(1000 + Math.random() * 9000)}`;
    const id = `guest:${randomUUID()}`;
    return { token: signToken({ sub: id, name: nm, role: 'guest' }, cfg.authSecret, 60 * 60 * 24 * 30), user: { id, name: nm, role: 'guest' } };
  });

  route('GET', '/api/me', async req => {
    const p = auth(req)!;
    if (p.role === 'guest') return { user: { id: p.sub, name: p.name, role: 'guest' } };
    const u = store.userById(p.sub)!;
    return { user: { id: u.id, name: u.username, role: u.role, rating: u.rating, cosmetics: JSON.parse(u.cosmetics), wallet: u.wallet }, stats: store.userStats(u.id),
      legal: u.terms_version ? { version: u.terms_version, adult: u.adult_declared === 1, at: u.terms_at } : null,
      kyc: { status: u.kyc_status, enabled: kycEnabled(cfg) } };
  });

  route('POST', '/api/legal/accept', async req => {
    const p = auth(req, false);
    const { version, adult } = await json(req);
    if (typeof version !== 'string' || version.length > 20 || typeof adult !== 'boolean') throw new HttpError(400, 'Datos inválidos');
    if (p && p.role !== 'guest') store.acceptTerms(p.sub, version, adult);
    store.audit('terms_accept', { user: p?.sub ?? null, version, adult, ip: ipOf(req) });
    return { ok: true };
  });
  // ---- KYC (Sumsub)
  route('GET', '/api/kyc/status', async req => {
    const p = auth(req)!;
    if (p.role === 'guest') return { enabled: kycEnabled(cfg), status: 'none', needsAccount: true };
    const u = store.userById(p.sub)!;
    return { enabled: kycEnabled(cfg), status: u.kyc_status, updatedAt: u.kyc_updated, labels: u.kyc_labels ? JSON.parse(u.kyc_labels) : [], eligibility: store.economicEligibility(u.id) };
  });
  route('POST', '/api/kyc/start', async req => {
    const p = registered(req);
    if (!kycEnabled(cfg)) throw new HttpError(503, 'La verificación de identidad aún no está disponible');
    const u = store.userById(p.sub)!;
    if (u.adult_declared !== 1) throw new HttpError(403, 'La verificación es solo para mayores de edad. Declara tu edad en Configuración.');
    if (u.kyc_status === 'approved') throw new HttpError(409, 'Tu identidad ya está verificada');
    if (u.kyc_status === 'rejected') throw new HttpError(409, 'Tu verificación fue rechazada. Escribe a soporte para revisarla.');
    const code = createLaunchCode(u.id);
    store.audit('kyc_start', { user: u.id });
    return { url: `${cfg.publicUrl.replace(/\/$/, '')}/kyc.html#c=${code}` };
  });
  route('POST', '/api/kyc/token', async req => {
    if (!kycEnabled(cfg)) throw new HttpError(503, 'La verificación de identidad aún no está disponible');
    const { code } = await json(req);
    const r = redeemLaunchCode(code);
    if (!r) throw new HttpError(410, 'El enlace de verificación ya se usó o caducó. Vuelve a iniciarla desde el juego.');
    const token = await createAccessToken(cfg, r.userId).catch(e => { store.logError('kyc', String(e)); throw new HttpError(502, 'No se pudo conectar con el servicio de verificación'); });
    const u = store.userById(r.userId)!;
    if (u.kyc_status === 'none') store.setKyc(u.id, 'started');
    return { token, refreshKey: r.refreshKey, sdkUrl: cfg.sumsubWebsdkUrl, user: u.username };
  });
  route('POST', '/api/kyc/token/refresh', async req => {
    const { refreshKey } = await json(req);
    const userId = userForRefreshKey(refreshKey);
    if (!userId) throw new HttpError(410, 'La sesión de verificación caducó');
    return { token: await createAccessToken(cfg, userId) };
  });
  route('POST', '/api/kyc/refresh', async req => {
    const p = registered(req);
    if (!kycEnabled(cfg)) throw new HttpError(503, 'La verificación de identidad aún no está disponible');
    const s = await fetchApplicantStatus(cfg, p.sub).catch(e => { store.logError('kyc', String(e)); throw new HttpError(502, 'No se pudo consultar el estado'); });
    if (s) { store.setKyc(p.sub, s.status, s.applicantId, s.labels); store.audit('kyc_refresh', { user: p.sub, status: s.status }); }
    return { status: store.userById(p.sub)!.kyc_status };
  });
  route('POST', '/api/kyc/webhook', async req => {
    if (!cfg.sumsubWebhookSecret) throw new HttpError(503, 'Webhook no configurado');
    const raw = await body(req, 256 * 1024);
    if (!verifyWebhook(raw, req.headers['x-payload-digest'] as string | undefined, req.headers['x-payload-digest-alg'] as string | undefined, cfg.sumsubWebhookSecret)) throw new HttpError(401, 'Firma inválida');
    let evt: any;
    try { evt = JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido'); }
    const r = parseWebhook(evt);
    if (!r) return { ok: true, ignored: evt?.type ?? null };
    const changed = store.setKyc(r.userId, r.status, r.applicantId, r.labels, evt.type === 'applicantReset');
    store.audit('kyc_webhook', { user: r.userId, type: r.type, status: r.status, applied: changed });
    notify(r.userId, { t: 'kyc', status: store.userById(r.userId)?.kyc_status });
    return { ok: true, applied: changed };
  });
  route('GET', '/api/leaderboard', async () => ({ leaderboard: store.leaderboard(100) }));
  route('GET', '/api/history', async req => ({ history: store.history(registered(req).sub) }));

  route('GET', '/api/friends', async req => {
    const p = registered(req);
    const list = store.friends(p.sub).map(f => ({ ...f, online: byUser.has(f.id) }));
    return { friends: list };
  });
  route('POST', '/api/friends', async req => {
    const p = registered(req);
    const { username } = await json(req);
    const f = typeof username === 'string' ? store.userByName(username) : undefined;
    if (!f || f.id === p.sub) throw new HttpError(404, 'Usuario no encontrado');
    store.addFriend(p.sub, f.id);
    return { ok: true };
  });
  route('DELETE', '/api/friends/:id', async (req, [id]) => { store.removeFriend(registered(req).sub, decodeURIComponent(id)); return { ok: true }; });
  route('POST', '/api/friends/invite', async req => {
    const p = registered(req);
    const { friendId, code } = await json(req);
    if (!store.friends(p.sub).some(f => f.id === friendId)) throw new HttpError(403, 'No es tu amigo');
    if (typeof code !== 'string' || !rooms.rooms.has(code)) throw new HttpError(404, 'Sala no encontrada');
    notify(friendId, { t: 'invite', from: p.name, code });
    return { ok: true };
  });

  route('POST', '/api/report', async req => {
    const p = auth(req)!;
    const { target, matchId, reason } = await json(req);
    if (typeof reason !== 'string' || reason.length < 3) throw new HttpError(400, 'Describe el motivo');
    store.addReport(p.sub, typeof target === 'string' ? target.slice(0, 64) : null, typeof matchId === 'string' ? matchId.slice(0, 64) : null, reason);
    return { ok: true };
  });

  route('GET', '/api/tournaments', async () => ({ tournaments: tournaments.summary(), enabled: flag('tournaments_enabled', 'true') === 'true' }));
  route('POST', '/api/tournaments', async req => {
    const p = registered(req);
    if (flag('tournaments_enabled', 'true') !== 'true') throw new HttpError(403, 'Torneos desactivados');
    const { name, size } = await json(req);
    const t = tournaments.create(name, size);
    tournaments.join(t.id, { userId: p.sub, name: p.name, registered: true });
    return { id: t.id };
  });
  route('POST', '/api/tournaments/:id/join', async (req, [id]) => {
    const p = auth(req)!;
    const err = tournaments.join(id, { userId: p.sub, name: p.name, registered: p.role !== 'guest' });
    if (err) throw new HttpError(400, err);
    return { ok: true };
  });

  // ---- tienda (Stripe)
  route('GET', '/api/shop', async () => ({ mode: stripeMode(cfg), products: Object.entries(PRODUCTS).map(([id, p]) => ({ id, ...p })) }));
  route('POST', '/api/shop/checkout', async req => {
    const p = registered(req);
    const { product, requestId } = await json(req);
    try { return await createCheckout(cfg, store, p.sub, product, typeof requestId === 'string' ? requestId.slice(0, 40) : randomUUID()); }
    catch (e) { throw new HttpError(400, (e as Error).message); }
  });
  route('GET', '/api/purchases', async req => ({ purchases: store.purchases(registered(req).sub) }));
  route('POST', '/api/stripe/webhook', async req => {
    if (!cfg.stripeWebhookSecret) throw new HttpError(503, 'Webhook no configurado');
    const raw = await body(req, 512 * 1024);
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined, cfg.stripeWebhookSecret)) throw new HttpError(400, 'Firma inválida');
    return handleStripeEvent(store, JSON.parse(raw));
  });

  // ---- Web3 (solo lectura)
  route('GET', '/api/web3/token', async () => {
    let onChain: unknown = null, error: string | null = null;
    try { onChain = await tokenInfo(cfg); } catch (e) { error = (e as Error).message; }
    return { verified: EKOKIIN_VERIFIED, onChain, error, explorer: `https://tronscan.org/#/token20/${cfg.ekokiinContract}`, swap: 'https://sun.io/' };
  });
  route('GET', '/api/web3/balance/:addr', async (_r, [addr]) => {
    if (!isTronAddress(addr)) throw new HttpError(400, 'Dirección TRON inválida');
    try { return { address: addr, balance: await balanceOf(cfg, addr), symbol: 'EKOKIIN' }; } catch (e) { throw new HttpError(502, (e as Error).message); }
  });
  route('GET', '/api/web3/transfers/:addr', async (_r, [addr]) => {
    if (!isTronAddress(addr)) throw new HttpError(400, 'Dirección TRON inválida');
    try { return { transfers: await transfers(cfg, addr) }; } catch (e) { throw new HttpError(502, (e as Error).message); }
  });
  route('POST', '/api/web3/link', async req => {
    const p = registered(req);
    const { address } = await json(req);
    if (address !== null && !isTronAddress(address)) throw new HttpError(400, 'Dirección TRON inválida');
    store.setWallet(p.sub, address); // solo la dirección pública
    return { ok: true };
  });
  route('GET', '/api/betting/status', async req => {
    const s = bettingStatus(cfg);
    const p = auth(req, false);
    const eligibility = p && p.role !== 'guest' ? store.economicEligibility(p.sub) : { ok: false, reason: 'Requiere cuenta registrada' };
    return { enabled: s.enabled, pending: s.approvals.filter(a => !a.ok).map(a => a.label), eligibility };
  });

  // ---- administración
  route('GET', '/api/admin/overview', async req => {
    admin(req);
    return {
      metrics: store.metrics(), live: { ...rooms.stats(), sockets: conns.size, usersOnline: byUser.size }, flags: store.flags(),
      kyc: { enabled: kycEnabled(cfg), level: cfg.sumsubLevelName },
      stripe: stripeMode(cfg), web3: { network: cfg.tronNetwork, contract: cfg.ekokiinContract, apiKey: !!cfg.tronApiKey },
      betting: bettingStatus(cfg), audit: store.verifyAudit(), memoryMB: Math.round(process.memoryUsage().rss / 1048576), uptimeSec: Math.round(process.uptime()),
    };
  });
  route('GET', '/api/admin/users', async req => { admin(req); return { users: store.listUsers(200) }; });
  route('POST', '/api/admin/users/:id/ban', async (req, [id]) => {
    const a = admin(req);
    const { banned } = await json(req);
    store.setBanned(decodeURIComponent(id), !!banned);
    store.audit('admin_ban', { admin: a.sub, user: id, banned: !!banned });
    for (const c of byUser.get(decodeURIComponent(id)) ?? []) if (banned) c.close();
    return { ok: true };
  });
  route('GET', '/api/admin/matches', async req => { admin(req); return { active: rooms.activeList(), recent: store.recentMatches(100) }; });
  route('GET', '/api/admin/reports', async req => { admin(req); return { reports: store.reports('open') }; });
  route('POST', '/api/admin/reports/:id', async (req, [id]) => { admin(req); const { status } = await json(req); store.setReportStatus(id, status === 'resolved' ? 'resolved' : 'dismissed'); return { ok: true }; });
  route('GET', '/api/admin/errors', async req => { admin(req); return { errors: store.errors() }; });
  route('GET', '/api/admin/purchases', async req => { admin(req); return { purchases: store.purchases() }; });
  route('GET', '/api/admin/tournaments', async req => { admin(req); return { tournaments: tournaments.summary() }; });
  route('POST', '/api/admin/flags', async req => {
    const a = admin(req);
    const { key, value } = await json(req);
    // El módulo económico NO es una bandera: solo se habilita por infraestructura + aprobaciones.
    if (typeof key !== 'string' || !SAFE_FLAGS.has(key)) throw new HttpError(400, 'Bandera no permitida');
    store.setFlag(key, String(value).slice(0, 300));
    store.audit('admin_flag', { admin: a.sub, key, value });
    return { ok: true, flags: store.flags() };
  });

  // ---- estáticos
  async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || !extname(p)) p = p.startsWith('/admin') ? '/admin.html' : '/index.html';
    const file = normalize(join(cfg.staticDir, p));
    if (!file.startsWith(normalize(cfg.staticDir))) { res.writeHead(403).end(); return; }
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error();
      const data = await readFile(file);
      const ext = extname(file);
      if (p === '/kyc.html') {
        // la página de verificación carga el SDK de Sumsub y su iframe, y necesita la cámara
        const sdk = new URL(cfg.sumsubWebsdkUrl).origin;
        res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline' ${sdk}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.sumsub.com ${sdk}; frame-src https://*.sumsub.com ${sdk}; frame-ancestors 'none'`);
        res.removeHeader('Permissions-Policy');
      }
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': ext === '.html' || p.endsWith('sw.js') ? 'no-cache' : 'public, max-age=86400',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado'); }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss: https://api.trongrid.io https://nile.trongrid.io; frame-ancestors 'none'");
    if (cfg.env === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    // CORS: las apps instaladas (Windows, tiendas) usan este servidor desde otro origen.
    // Es seguro porque la sesión viaja en el encabezado Authorization, nunca en cookies.
    if (url.pathname !== '/api/stripe/webhook') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    }
    if (!httpLimiter.take(ipOf(req))) { res.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Demasiadas solicitudes' })); return; }
    for (const [m, re, h] of routes) {
      const match = req.method === m && re.exec(url.pathname);
      if (!match) continue;
      try {
        const out = await h(req, match.slice(1), url);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(out));
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) store.logError('http', `${req.method} ${url.pathname}: ${(e as Error).stack ?? e}`);
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: status === 500 ? 'Error interno' : (e as Error).message }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Ruta no encontrada' }));
  });

  // ---- WebSocket de juego
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => onSocket(ws, ipOf(req)));
  });

  function onSocket(ws: WebSocket, ip: string) {
    let conn: Conn | null = null;
    const helloTimer = setTimeout(() => ws.close(4001, 'hello requerido'), 10000);
    const send = (m: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };

    ws.on('message', raw => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return send({ t: 'error', code: 'BAD_JSON', message: 'Mensaje inválido' }); }
      if (!msg || typeof msg.t !== 'string') return;
      if (!conn) {
        if (msg.t !== 'hello') return;
        const user = verifyToken(msg.token, cfg.authSecret);
        if (!user) { send({ t: 'error', code: 'AUTH', message: 'Sesión inválida' }); return ws.close(4003, 'auth'); }
        if (user.role !== 'guest') { const u = store.userById(user.sub); if (!u || u.banned) { send({ t: 'error', code: 'BANNED', message: 'Cuenta bloqueada' }); return ws.close(4003, 'banned'); } }
        clearTimeout(helloTimer);
        conn = { id: randomUUID(), user, ip, send, close: () => ws.close(4004, 'cerrada'), limiter: new RateLimiter(30, 10), chatLimiter: new RateLimiter(5, 0.5), alive: true };
        conns.set(conn.id, conn);
        if (!byUser.has(user.sub)) byUser.set(user.sub, new Set());
        byUser.get(user.sub)!.add(conn);
        send({ t: 'welcome', user: { id: user.sub, name: user.name, role: user.role }, levels: AI_LEVELS, announcement: flag('announcement') || null });
        // Reconexión automática: si tenía asiento en una partida en curso, se le devuelve.
        const r = rooms.findSeatFor(user.sub);
        if (r) r.attach(r.seatOf(user.sub), conn);
        return;
      }
      if (!conn.limiter.take(conn.id)) return send({ t: 'error', code: 'RATE', message: 'Demasiados mensajes' });
      try { onMessage(conn, msg); } catch (e) { store.logError('ws', String((e as Error).stack ?? e)); send({ t: 'error', code: 'INTERNAL', message: 'Error interno' }); }
    });

    ws.on('pong', () => { if (conn) conn.alive = true; });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (!conn) return;
      conns.delete(conn.id);
      byUser.get(conn.user.sub)?.delete(conn);
      if (!byUser.get(conn.user.sub)?.size) byUser.delete(conn.user.sub);
      rooms.dequeue(conn);
      if (conn.roomCode) rooms.rooms.get(conn.roomCode)?.detach(conn);
    });
  }

  // latido para detectar conexiones muertas (red móvil, suspensión)
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { const w = ws as WebSocket & { _alive?: boolean }; if (w._alive === false) { w.terminate(); continue; } w._alive = false; w.ping(); }
  }, 25000);
  wss.on('connection', ws => { (ws as any)._alive = true; ws.on('pong', () => ((ws as any)._alive = true)); });
  heartbeat.unref?.();

  function onMessage(conn: Conn, msg: any) {
    const room = conn.roomCode ? rooms.rooms.get(conn.roomCode) : undefined;
    const err = (message: string, code = 'ERROR') => conn.send({ t: 'error', code, message });
    const maintenance = flag('maintenance') === 'true';
    switch (msg.t) {
      case 'ping': return conn.send({ t: 'pong', now: Date.now() });
      case 'create': {
        if (maintenance) return err('Servidor en mantenimiento');
        if (room) room.leave(conn);
        const teams = !!msg.teams;
        const r = rooms.create('private', teams ? 4 : Number(msg.size) || 4, teams, Number(msg.turnSeconds), Number(msg.rounds) || 1);
        r.addHuman(conn);
        return;
      }
      case 'join': {
        if (typeof msg.code !== 'string') return err('Código inválido');
        const r = rooms.rooms.get(msg.code.toUpperCase().trim());
        if (!r) return err('No existe una sala con ese código', 'NO_ROOM');
        if (room && room !== r) room.leave(conn);
        const res = r.addHuman(conn);
        if (typeof res === 'string') err(res);
        return;
      }
      case 'quick': {
        if (maintenance) return err('Servidor en mantenimiento');
        if (room) room.leave(conn);
        return rooms.enqueue(conn, Number(msg.size) || 2, !!msg.teams);
      }
      case 'cancel_quick': rooms.dequeue(conn); return conn.send({ t: 'dequeued' });
      case 'add_bot': {
        if (!room || room.hostUserId !== conn.user.sub) return err('Solo el anfitrión puede agregar IA');
        if (!AI_LEVELS.includes(msg.level)) return err('Nivel inválido');
        if (!room.addBot(msg.level)) err('No hay lugar');
        return;
      }
      case 'start': {
        if (!room) return err('No estás en una sala');
        const e = room.start(conn.user.sub);
        if (e) err(e);
        return;
      }
      case 'play': case 'draw': return room ? room.handleMove(conn, msg) : err('No estás en una partida');
      case 'chat': if (flag('chat_enabled', 'true') !== 'true') return err('Chat desactivado'); return room?.handleChat(conn, msg.text);
      case 'emote': return room?.handleEmote(conn, msg.e);
      case 'leave': room?.leave(conn); rooms.dequeue(conn); return conn.send({ t: 'left' });
      case 'sync': return room?.started ? room.sendState(room.seats.findIndex(s => s.conn === conn)) : room?.broadcastLobby();
      default: return err('Mensaje desconocido');
    }
  }

  return {
    server, store, rooms, tournaments, restored,
    listen: (port = cfg.port, host = cfg.host) => new Promise<number>(res => server.listen(port, host, () => res((server.address() as any).port))),
    close: async () => {
      clearInterval(heartbeat);
      rooms.shutdown();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}
