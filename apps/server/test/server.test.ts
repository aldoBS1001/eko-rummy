import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, Client, guest, playToEnd, sleep } from './helpers.ts';
import { checkIntegrity, TILES } from '../../../packages/engine/src/index.ts';
import { Store } from '../src/store.ts';
import { moderate } from '../src/chat.ts';
import { verifyStripeSignature, handleStripeEvent } from '../src/payments/stripe.ts';
import { isTronAddress, base58ToHex, formatUnits, EKOKIIN_VERIFIED } from '../src/web3/tron.ts';
import { bettingStatus, assertBettingAllowed, REQUIRED_APPROVALS } from '../src/betting/gate.ts';
import { EscrowSimulator } from '../src/betting/escrowSim.ts';
import { loadConfig } from '../src/config.ts';

describe('16. Autenticación y control de accesos', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  test('registro, login, invitado y perfil', async () => {
    const r = await s.api('POST', '/api/auth/register', { username: 'jugador_uno', password: 'contraseña-segura' });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    assert.equal((await s.api('POST', '/api/auth/register', { username: 'jugador_uno', password: 'otra-clave-123' })).status, 409);
    assert.equal((await s.api('POST', '/api/auth/register', { username: 'x', password: '123' })).status, 400);
    assert.equal((await s.api('POST', '/api/auth/login', { username: 'jugador_uno', password: 'mal' })).status, 401);
    const l = await s.api('POST', '/api/auth/login', { username: 'jugador_uno', password: 'contraseña-segura' });
    assert.equal(l.status, 200);
    const me = await s.api('GET', '/api/me', undefined, l.body.token);
    assert.equal(me.body.user.name, 'jugador_uno');
    assert.ok(!JSON.stringify(me.body).includes('pass_hash'));
    const g = await s.api('POST', '/api/auth/guest', { name: 'Visitante' });
    assert.equal(g.body.user.role, 'guest');
  });

  test('tokens falsificados o alterados se rechazan', async () => {
    const g = await guest(s.api, 'A');
    const [body, sig] = g.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'x', name: 'x', role: 'admin', exp: 9e9, jti: 'x' })).toString('base64url') + '.' + sig;
    assert.equal((await s.api('GET', '/api/admin/overview', undefined, forged)).status, 401);
    assert.equal((await s.api('GET', '/api/me', undefined, body + '.AAAA')).status, 401);
  });

  test('panel admin: 403 para jugadores, datos reales para admin', async () => {
    const p = await s.api('POST', '/api/auth/register', { username: 'normal', password: 'clave-normal-1' });
    assert.equal((await s.api('GET', '/api/admin/overview', undefined, p.body.token)).status, 403);
    const a = await s.api('POST', '/api/auth/register', { username: 'admin_eko', password: 'clave-admin-123' });
    assert.equal(a.body.user.role, 'admin');
    const o = await s.api('GET', '/api/admin/overview', undefined, a.body.token);
    assert.equal(o.status, 200);
    assert.ok(o.body.metrics.usersRegistered >= 3);
    assert.equal(o.body.betting.enabled, false);
    assert.equal(o.body.audit.ok, true);
    // el módulo económico no se puede activar como bandera
    assert.equal((await s.api('POST', '/api/admin/flags', { key: 'betting_enabled', value: 'true' }, a.body.token)).status, 400);
    assert.equal((await s.api('POST', '/api/admin/flags', { key: 'announcement', value: 'Hola' }, a.body.token)).status, 200);
    // bloqueo de usuario
    const victim = await s.api('POST', '/api/auth/register', { username: 'infractor', password: 'clave-infractor' });
    await s.api('POST', `/api/admin/users/${victim.body.user.id}/ban`, { banned: true }, a.body.token);
    assert.equal((await s.api('GET', '/api/me', undefined, victim.body.token)).status, 403);
    assert.equal((await s.api('POST', '/api/auth/login', { username: 'infractor', password: 'clave-infractor' })).status, 403);
  });

  test('rate limiting de intentos de acceso', async () => {
    let limited = false;
    for (let i = 0; i < 15; i++) {
      const r = await s.api('POST', '/api/auth/login', { username: 'nadie', password: 'xxxxxxxxx' });
      if (r.status === 429) { limited = true; break; }
    }
    assert.ok(limited);
  });

  test('cuerpo excesivo y JSON inválido', async () => {
    const g = await s.api('POST', '/api/auth/guest', '{malo');
    assert.equal(g.status, 400);
  });
});

describe('Multijugador en tiempo real', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  before(async () => { s = await startServer(); });
  after(() => s.close());

  test('4 jugadores en dispositivos distintos completan una partida real', async () => {
    const tokens = await Promise.all(['Ana', 'Beto', 'Caro', 'Dani'].map(n => guest(s.api, n)));
    const cs = await Promise.all(tokens.map(t => new Client(s.port, t).connect()));
    cs[0].send({ t: 'create', size: 4 });
    const lobby = await cs[0].wait(m => m.t === 'lobby');
    for (const c of cs.slice(1)) c.send({ t: 'join', code: lobby.code });
    await cs[0].wait(m => m.t === 'lobby' && m.seats.length === 4);
    cs[1].send({ t: 'start' });
    assert.match((await cs[1].wait(m => m.t === 'error')).message, /anfitrión/);
    cs[0].send({ t: 'start' });
    await Promise.all(cs.map(c => c.wait(m => m.t === 'state')));
    // Seguridad: cada cliente solo recibe su atril
    const room = s.app.rooms.rooms.get(lobby.code)!;
    cs.forEach((c, i) => {
      assert.deepEqual(c.state.view.rack, room.game!.players[i].rack);
      const raw = JSON.stringify(c.state);
      assert.ok(!raw.includes('"pool"'));
      for (let j = 0; j < 4; j++) if (j !== i) assert.ok(!raw.includes(JSON.stringify(room.game!.players[j].rack)));
    });
    const overs = await playToEnd(cs);
    assert.equal(overs.length, 4);
    assert.equal(overs[0].scores.length, 4);
    const lb = await s.api('GET', '/api/admin/matches', undefined, (await s.api('POST', '/api/auth/register', { username: 'admin_eko', password: 'clave-admin-123' })).body.token);
    assert.ok(lb.body.recent.some((m: any) => m.ended_at));
    cs.forEach(c => c.close());
  });

  test('modo equipos 2 vs 2', async () => {
    const tokens = await Promise.all(['E1', 'E2', 'E3', 'E4'].map(n => guest(s.api, n)));
    const cs = await Promise.all(tokens.map(t => new Client(s.port, t).connect()));
    cs[0].send({ t: 'create', teams: true });
    const lobby = await cs[0].wait(m => m.t === 'lobby');
    assert.equal(lobby.teams, true);
    for (const c of cs.slice(1)) c.send({ t: 'join', code: lobby.code });
    await cs[0].wait(m => m.t === 'lobby' && m.seats.length === 4);
    cs[0].send({ t: 'start' });
    await Promise.all(cs.map(c => c.wait(m => m.t === 'state')));
    assert.deepEqual(cs[0].state.view.players.map((p: any) => p.team), [0, 1, 0, 1]);
    const [over] = await playToEnd(cs);
    assert.ok(over.winnerTeam === 0 || over.winnerTeam === 1);
    assert.equal(over.teams.length, 2);
    cs.forEach(c => c.close());
  });

  test('jugadas inválidas, duplicadas y fuera de turno se rechazan y restauran', async () => {
    const t = await Promise.all(['P1', 'P2'].map(n => guest(s.api, n)));
    const [a, b] = await Promise.all(t.map(x => new Client(s.port, x).connect()));
    a.send({ t: 'create', size: 2, turnSeconds: 0 });
    const lobby = await a.wait(m => m.t === 'lobby');
    b.send({ t: 'join', code: lobby.code });
    await a.wait(m => m.t === 'lobby' && m.seats.length === 2);
    a.send({ t: 'start' });
    await a.wait(m => m.t === 'state'); await b.wait(m => m.t === 'state');
    const [mover, other] = a.state.view.turn === a.state.view.seat ? [a, b] : [b, a];
    const v = mover.state.view;
    // fuera de turno
    other.send({ t: 'draw', turn: v.turnNumber, nonce: other.nonce() });
    assert.equal((await other.wait(m => m.t === 'move_rejected')).code, 'NOT_YOUR_TURN');
    // combinación inválida
    mover.send({ t: 'play', table: [v.rack.slice(0, 3)], turn: v.turnNumber, nonce: mover.nonce() });
    const rej = await mover.wait(m => m.t === 'move_rejected');
    assert.ok(['INVALID_SET', 'OPENING_TOO_LOW'].includes(rej.code));
    assert.deepEqual(rej.state.view.rack, v.rack, 'el atril se restaura');
    // fichas de otro jugador
    const foreign = TILES.map(x => x.id).filter(id => !v.rack.includes(id)).slice(0, 3);
    mover.send({ t: 'play', table: [foreign], turn: v.turnNumber, nonce: mover.nonce() });
    assert.equal((await mover.wait(m => m.t === 'move_rejected')).code, 'NOT_IN_RACK');
    // movimiento duplicado
    const nonce = mover.nonce();
    mover.send({ t: 'draw', turn: v.turnNumber, nonce });
    mover.send({ t: 'draw', turn: v.turnNumber, nonce });
    assert.equal((await mover.wait(m => m.t === 'error')).code, 'DUPLICATE_MOVE');
    // turno viejo
    mover.send({ t: 'draw', turn: v.turnNumber, nonce: mover.nonce() });
    assert.equal((await mover.wait(m => m.t === 'move_rejected')).code, 'STALE_TURN');
    const room = s.app.rooms.rooms.get(lobby.code)!;
    assert.equal(checkIntegrity(room.game!), null);
    a.close(); b.close();
  });

  test('11. desconexión y reconexión conservan el asiento y el atril', async () => {
    const t = await Promise.all(['R1', 'R2'].map(n => guest(s.api, n)));
    const [a, b] = await Promise.all(t.map(x => new Client(s.port, x).connect()));
    a.send({ t: 'create', size: 2 });
    const lobby = await a.wait(m => m.t === 'lobby');
    b.send({ t: 'join', code: lobby.code });
    await a.wait(m => m.t === 'lobby' && m.seats.length === 2);
    a.send({ t: 'start' });
    await b.wait(m => m.t === 'state');
    const rack = b.state.view.rack;
    b.close();
    await a.wait(m => m.t === 'presence' && m.presence.some((p: any) => !p.connected));
    const b2 = await new Client(s.port, t[1]).connect();
    const st = await b2.wait(m => m.t === 'state');
    assert.deepEqual(st.view.rack.slice().sort(), rack.slice().sort());
    assert.equal(st.view.seat, 1);
    a.close(); b2.close();
  });

  test('si no regresa a tiempo, la IA lo reemplaza y la partida termina', async () => {
    const t = await Promise.all(['G1', 'G2'].map(n => guest(s.api, n)));
    const [a, b] = await Promise.all(t.map(x => new Client(s.port, x).connect()));
    a.send({ t: 'create', size: 2 });
    const lobby = await a.wait(m => m.t === 'lobby');
    b.send({ t: 'join', code: lobby.code });
    await a.wait(m => m.t === 'lobby' && m.seats.length === 2);
    a.send({ t: 'start' });
    await a.wait(m => m.t === 'state');
    b.close();
    await a.wait(m => m.t === 'chat' && /reemplazado por la IA/.test(m.text), 5000);
    const [over] = await playToEnd([a]);
    assert.ok(over.scores);
    a.close();
  });

  test('12. partidas simultáneas (8 salas en paralelo)', async () => {
    const rooms = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const c = await new Client(s.port, await guest(s.api, `S${i}`)).connect();
      c.send({ t: 'create', size: 4 });
      await c.wait(m => m.t === 'lobby');
      for (const lvl of ['principiante', 'intermedio', 'avanzado']) c.send({ t: 'add_bot', level: lvl });
      await c.wait(m => m.t === 'lobby' && m.seats.length === 4);
      c.send({ t: 'start' });
      await c.wait(m => m.t === 'state');
      return c;
    }));
    const results = await Promise.all(rooms.map(c => playToEnd([c], 90000)));
    assert.equal(results.length, 8);
    for (const r of s.app.rooms.rooms.values()) if (r.game) assert.equal(checkIntegrity(r.game), null);
    rooms.forEach(c => c.close());
  });

  test('emparejamiento automático y relleno con IA', async () => {
    const [a, b] = await Promise.all(['Q1', 'Q2'].map(async n => new Client(s.port, await guest(s.api, n)).connect()));
    a.send({ t: 'quick', size: 2 }); b.send({ t: 'quick', size: 2 });
    const [sa, sb] = await Promise.all([a.wait(m => m.t === 'state'), b.wait(m => m.t === 'state')]);
    assert.equal(sa.code, sb.code);
    const solo = await new Client(s.port, await guest(s.api, 'Q3')).connect();
    solo.send({ t: 'quick', size: 3 });
    const st = await solo.wait(m => m.t === 'state', 6000);
    assert.equal(st.view.players.filter((p: any) => p.isBot).length, 2);
    [a, b, solo].forEach(c => c.close());
  });

  test('chat moderado y emoticones', async () => {
    const [a, b] = await Promise.all(['C1', 'C2'].map(async n => new Client(s.port, await guest(s.api, n)).connect()));
    a.send({ t: 'create', size: 2 });
    const lobby = await a.wait(m => m.t === 'lobby');
    b.send({ t: 'join', code: lobby.code });
    await a.wait(m => m.t === 'lobby' && m.seats.length === 2);
    a.send({ t: 'chat', text: '<script>alert(1)</script> hola' });
    const c1 = await b.wait(m => m.t === 'chat' && m.name === 'C1');
    assert.equal(c1.text, '<script>alert(1)</script> hola', 'se transmite como texto; el cliente nunca lo interpreta como HTML');
    a.send({ t: 'chat', text: 'visita https://estafa.com' });
    assert.equal((await a.wait(m => m.t === 'error')).code, 'CHAT_BLOCKED');
    a.send({ t: 'emote', e: '🐸' });
    assert.equal((await b.wait(m => m.t === 'emote')).e, '🐸');
    for (let i = 0; i < 8; i++) a.send({ t: 'chat', text: `msg ${i}` });
    assert.equal((await a.wait(m => m.code === 'CHAT_RATE')).code, 'CHAT_RATE');
    [a, b].forEach(c => c.close());
  });
});

describe('20. Recuperación ante fallos del servidor', () => {
  test('una partida en curso sobrevive a un reinicio del servidor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eko-'));
    const dbPath = join(dir, 'db.sqlite');
    const s1 = await startServer({ dbPath, reconnectGraceSeconds: 30 }, new Store(dbPath));
    const tok = await Promise.all(['X1', 'X2'].map(n => guest(s1.api, n)));
    const [a, b] = await Promise.all(tok.map(x => new Client(s1.port, x).connect()));
    a.send({ t: 'create', size: 2 });
    const lobby = await a.wait(m => m.t === 'lobby');
    b.send({ t: 'join', code: lobby.code });
    await a.wait(m => m.t === 'lobby' && m.seats.length === 2);
    a.send({ t: 'start' });
    await a.wait(m => m.t === 'state'); await b.wait(m => m.t === 'state');
    const rackA = a.state.view.rack;
    a.close(); b.close();
    await sleep(50);
    await s1.close(); // simula la caída: el proceso se detiene con la partida a medias
    s1.app.store.db.close();
    // nuevo proceso, misma base, mismo secreto
    const s2 = await startServer({ dbPath, reconnectGraceSeconds: 30 }, new Store(dbPath));
    assert.equal(s2.app.restored, 1);
    const a2 = await new Client(s2.port, tok[0]).connect();
    const st = await a2.wait(m => m.t === 'state');
    assert.equal(st.code, lobby.code);
    assert.deepEqual([...st.view.rack].sort(), [...rackA].sort());
    const b2 = await new Client(s2.port, tok[1]).connect();
    await b2.wait(m => m.t === 'state');
    await playToEnd([a2, b2]);
    assert.equal(s2.app.store.loadActive().length, 0, 'al terminar se borra el respaldo');
    a2.close(); b2.close();
    await s2.close();
  });
});

describe('Chat, auditoría y clasificación', () => {
  test('moderación', () => {
    assert.equal((moderate('eres un p3nd3jo') as any).censored, true);
    assert.equal(moderate('www.sitio.com').ok, false);
    assert.equal(moderate('a'.repeat(201)).ok, false);
    assert.equal((moderate('¡Buena jugada!') as any).text, '¡Buena jugada!');
  });
  test('registro de auditoría encadenado detecta alteraciones', () => {
    const st = new Store(':memory:');
    st.audit('a', { x: 1 }); st.audit('b', { x: 2 }); st.audit('c', { x: 3 });
    assert.deepEqual(st.verifyAudit(), { ok: true, count: 3 });
    st.db.prepare(`UPDATE audit SET payload = '{"x":99}' WHERE seq = 2`).run();
    assert.equal(st.verifyAudit().ok, false);
    assert.equal(st.verifyAudit().brokenAt, 2);
  });
  test('Elo: el ganador sube y el perdedor baja', () => {
    const st = new Store(':memory:');
    const a = st.createUser('a_user', 'x'), b = st.createUser('b_user', 'x');
    st.updateRatings([{ userId: a.id, place: 0 }, { userId: b.id, place: 1 }]);
    assert.ok(st.userById(a.id)!.rating > 1200 && st.userById(b.id)!.rating < 1200);
  });
});

describe('15. Stripe (modo prueba, firmas e idempotencia)', () => {
  const secret = 'whsec_test_123';
  const sign = (payload: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

  test('verificación de firma', () => {
    const p = '{"id":"evt_1"}';
    assert.ok(verifyStripeSignature(p, sign(p), secret));
    assert.ok(!verifyStripeSignature(p + ' ', sign(p), secret));
    assert.ok(!verifyStripeSignature(p, sign(p, Math.floor(Date.now() / 1000) - 3600), secret), 'evento viejo (replay)');
    assert.ok(!verifyStripeSignature(p, undefined, secret));
  });

  test('webhook concede el cosmético una sola vez y el reembolso lo retira', async () => {
    const s = await startServer({ stripeWebhookSecret: secret, stripeSecretKey: 'sk_test_dummy' });
    const r = await s.api('POST', '/api/auth/register', { username: 'comprador', password: 'clave-compra-1' });
    s.app.store.createPurchase(r.body.user.id, 'theme_selva', 4900, 'mxn', 'cs_test_1');
    const evt = JSON.stringify({ id: 'evt_pay_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 4900, mode: 'payment' } } });
    const bad = await s.api('POST', '/api/stripe/webhook', evt, undefined, { 'Stripe-Signature': 't=1,v1=00' });
    assert.equal(bad.status, 400);
    const ok = await s.api('POST', '/api/stripe/webhook', evt, undefined, { 'Stripe-Signature': sign(evt) });
    assert.equal(ok.body.status, 'processed');
    const dup = await s.api('POST', '/api/stripe/webhook', evt, undefined, { 'Stripe-Signature': sign(evt) });
    assert.equal(dup.body.status, 'ignored_duplicate');
    const me = await s.api('GET', '/api/me', undefined, r.body.token);
    assert.deepEqual(me.body.user.cosmetics, ['theme_selva']);
    const refund = JSON.stringify({ id: 'evt_ref_1', type: 'charge.refunded', data: { object: { metadata: { checkout_session: 'cs_test_1' } } } });
    await s.api('POST', '/api/stripe/webhook', refund, undefined, { 'Stripe-Signature': sign(refund) });
    assert.deepEqual((await s.api('GET', '/api/me', undefined, r.body.token)).body.user.cosmetics, []);
    assert.equal((await s.api('GET', '/api/purchases', undefined, r.body.token)).body.purchases[0].status, 'refunded');
    await s.close();
  });

  test('monto alterado no concede el producto', () => {
    const st = new Store(':memory:');
    const u = st.createUser('u_monto', 'x');
    st.createPurchase(u.id, 'tiles_jade', 3900, 'mxn', 'cs_x');
    const r = handleStripeEvent(st, { id: 'e1', type: 'checkout.session.completed', data: { object: { id: 'cs_x', payment_status: 'paid', amount_total: 1 } } });
    assert.equal(r.detail, 'monto no coincide');
  });

  test('claves live bloqueadas sin aprobación; sin clave no hay checkout', async () => {
    const s = await startServer({ stripeSecretKey: 'sk_live_abc' });
    const r = await s.api('POST', '/api/auth/register', { username: 'comprador2', password: 'clave-compra-2' });
    const res = await s.api('POST', '/api/shop/checkout', { product: 'theme_selva' }, r.body.token);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /no aprobado/);
    assert.equal((await s.api('GET', '/api/shop')).body.mode, 'blocked_live');
    const g = await guest(s.api, 'inv');
    assert.equal((await s.api('POST', '/api/shop/checkout', { product: 'theme_selva' }, g)).status, 403, 'invitados no compran');
    await s.close();
  });
});

describe('14. Web3 EKOKIIN', () => {
  test('dirección del contrato válida (Base58Check)', () => {
    assert.ok(isTronAddress('TMNKYEbXGJGFPaZXs8tBER6gMiRvjKtUiU'));
    assert.equal(base58ToHex('TMNKYEbXGJGFPaZXs8tBER6gMiRvjKtUiU')!.slice(0, 2), '41');
    assert.ok(!isTronAddress('TMNKYEbXGJGFPaZXs8tBER6gMiRvjKtUiV'), 'checksum alterado');
    assert.ok(!isTronAddress('0x1234'));
  });
  test('conversión de unidades con 18 decimales', () => {
    assert.equal(formatUnits(100000000000000000000000000n, 18), '100000000');
    assert.equal(formatUnits(1500000000000000000n, 18), '1.5');
    assert.equal(formatUnits(1n, 18), '0.000000000000000001');
    assert.equal(EKOKIIN_VERIFIED.decimals, 18);
  });
  test('API de token responde con datos verificados aunque la red no esté disponible', async () => {
    const s = await startServer();
    const r = await s.api('GET', '/api/web3/token');
    assert.equal(r.status, 200);
    assert.equal(r.body.verified.symbol, 'EKOKIIN');
    assert.equal((await s.api('GET', '/api/web3/balance/xyz')).status, 400);
    await s.close();
  });
});

describe('8/19. Módulo económico bloqueado y simulador en testnet', () => {
  test('bloqueado por defecto', () => {
    const cfg = loadConfig({ complianceFile: '/nope.json' });
    assert.equal(bettingStatus(cfg).enabled, false);
    assert.throws(() => assertBettingAllowed(cfg), /bloqueado/);
  });
  test('la variable de entorno sola no basta; aprobaciones incompletas tampoco', () => {
    const dir = mkdtempSync(join(tmpdir(), 'comp-'));
    const f = join(dir, 'a.json');
    const partial = Object.fromEntries(REQUIRED_APPROVALS.slice(0, 5).map(a => [a.key, { approved: true, approver: 'Legal', date: '2026-10-14', reference: 'DOC-1' }]));
    writeFileSync(f, JSON.stringify(partial));
    assert.equal(bettingStatus(loadConfig({ bettingEnabled: true, complianceFile: f })).enabled, false);
    const full = Object.fromEntries(REQUIRED_APPROVALS.map(a => [a.key, { approved: true, approver: 'Legal', date: '2026-10-14', reference: 'DOC-1' }]));
    writeFileSync(f, JSON.stringify(full));
    assert.equal(bettingStatus(loadConfig({ bettingEnabled: false, complianceFile: f })).enabled, false);
    const both = bettingStatus(loadConfig({ bettingEnabled: true, complianceFile: f }));
    assert.equal(both.enabled, true);
    assert.equal(both.mainnetAllowed, false, 'Mainnet requiere además aprobación de despliegue');
  });
  test('simulador de custodia: depósitos, liquidación, comisión e invariante contable', () => {
    const sim = new EscrowSimulator({ feeBps: 500, minStake: 10n, maxStake: 1000n, dailyLimit: 2000n });
    const ok = { ageVerified: true, kycPassed: true, jurisdictionAllowed: true };
    for (const id of ['a', 'b', 'c', 'd']) sim.registerPlayer({ id, ...ok }, 5000n);
    const supply = sim.totalSupply();
    sim.createMatch('m1', 100n, ['a', 'b']);
    assert.throws(() => sim.deposit('m1', 'a'), /condiciones/);
    sim.acceptTerms('m1', 'a'); sim.acceptTerms('m1', 'b');
    sim.deposit('m1', 'a');
    assert.throws(() => sim.deposit('m1', 'a'), /duplicado/);
    sim.deposit('m1', 'b');
    const r = sim.settle('m1', ['a']);
    assert.equal(r.fee, 10n);
    assert.equal(sim.balances.get('a'), 5090n);
    assert.equal(sim.totalSupply(), supply, 'no se crea ni destruye valor');
    // equipos y reembolso
    sim.createMatch('m2', 50n, ['a', 'b', 'c', 'd'], true);
    for (const p of ['a', 'b', 'c', 'd']) { sim.acceptTerms('m2', p); sim.deposit('m2', p); }
    sim.settle('m2', ['a', 'c']);
    sim.createMatch('m3', 100n, ['b', 'c']);
    sim.acceptTerms('m3', 'b'); sim.deposit('m3', 'b');
    sim.refund('m3');
    assert.equal(sim.totalSupply(), supply);
    assert.throws(() => sim.settle('m3', ['b']));
  });
  test('simulador: límites, autoexclusión y elegibilidad', () => {
    const sim = new EscrowSimulator({ feeBps: 0, minStake: 10n, maxStake: 100n, dailyLimit: 150n });
    sim.registerPlayer({ id: 'menor', ageVerified: false, kycPassed: true, jurisdictionAllowed: true }, 1000n);
    sim.registerPlayer({ id: 'p', ageVerified: true, kycPassed: true, jurisdictionAllowed: true }, 1000n);
    sim.registerPlayer({ id: 'q', ageVerified: true, kycPassed: true, jurisdictionAllowed: true }, 1000n);
    assert.throws(() => sim.createMatch('x', 500n, ['p', 'q']), /límites/);
    sim.createMatch('m', 100n, ['menor', 'p']);
    sim.acceptTerms('m', 'menor');
    assert.throws(() => sim.deposit('m', 'menor'), /Edad/);
    sim.createMatch('m2', 100n, ['p', 'q']); sim.acceptTerms('m2', 'p'); sim.deposit('m2', 'p');
    sim.createMatch('m3', 100n, ['p', 'q']); sim.acceptTerms('m3', 'p');
    assert.throws(() => sim.deposit('m3', 'p'), /Límite diario/);
    sim.selfExclude('q', 30);
    sim.acceptTerms('m2', 'q');
    assert.throws(() => sim.deposit('m2', 'q'), /autoexcluido/);
  });
  test('API pública informa bloqueo', async () => {
    const s = await startServer();
    const r = await s.api('GET', '/api/betting/status');
    assert.equal(r.body.enabled, false);
    assert.equal(r.body.pending.length, REQUIRED_APPROVALS.length);
    await s.close();
  });
});

describe('Torneos, amigos y clasificación', () => {
  test('torneo de 4 se completa (ausentes reemplazados por IA)', async () => {
    const s = await startServer({ reconnectGraceSeconds: 1 });
    const users = await Promise.all(['t_uno', 't_dos', 't_tres', 't_cuatro'].map(u => s.api('POST', '/api/auth/register', { username: u, password: 'clave-torneo-1' })));
    const created = await s.api('POST', '/api/tournaments', { name: 'Copa Jade', size: 4 }, users[0].body.token);
    for (const u of users.slice(1)) assert.equal((await s.api('POST', `/api/tournaments/${created.body.id}/join`, {}, u.body.token)).status, 200);
    let t: any;
    for (let i = 0; i < 240; i++) {
      t = (await s.api('GET', '/api/tournaments')).body.tournaments.find((x: any) => x.id === created.body.id);
      if (t.status === 'finished') break;
      await sleep(250);
    }
    assert.equal(t.status, 'finished');
    assert.ok(t.champion);
    assert.equal(t.matches.length, 3);
    await s.close();
  });

  test('amigos e invitaciones', async () => {
    const s = await startServer();
    const a = await s.api('POST', '/api/auth/register', { username: 'amiga_a', password: 'clave-amiga-1' });
    const b = await s.api('POST', '/api/auth/register', { username: 'amigo_b', password: 'clave-amigo-1' });
    assert.equal((await s.api('POST', '/api/friends', { username: 'amigo_b' }, a.body.token)).status, 200);
    const fb = (await s.api('GET', '/api/friends', undefined, b.body.token)).body.friends;
    assert.equal(fb[0].username, 'amiga_a');
    const cb = await new Client(s.port, b.body.token).connect();
    const ca = await new Client(s.port, a.body.token).connect();
    ca.send({ t: 'create', size: 2 });
    const lobby = await ca.wait(m => m.t === 'lobby');
    await s.api('POST', '/api/friends/invite', { friendId: b.body.user.id, code: lobby.code }, a.body.token);
    const inv = await cb.wait(m => m.t === 'invite');
    assert.equal(inv.code, lobby.code);
    ca.close(); cb.close();
    await s.close();
  });

  test('clasificación mundial e historial tras una partida pública', async () => {
    const s = await startServer();
    const us = await Promise.all(['rank_a', 'rank_b'].map(u => s.api('POST', '/api/auth/register', { username: u, password: 'clave-rank-12' })));
    const cs = await Promise.all(us.map(u => new Client(s.port, u.body.token).connect()));
    cs.forEach(c => c.send({ t: 'quick', size: 2 }));
    await Promise.all(cs.map(c => c.wait(m => m.t === 'state')));
    await playToEnd(cs);
    await sleep(50);
    const lb = (await s.api('GET', '/api/leaderboard')).body.leaderboard;
    assert.equal(lb.length, 2);
    assert.notEqual(lb[0].rating, lb[1].rating);
    assert.equal((await s.api('GET', '/api/history', undefined, us[0].body.token)).body.history.length, 1);
    cs.forEach(c => c.close());
    await s.close();
  });
});

describe('CORS para apps instaladas', () => {
  test('la API acepta solicitudes desde otro origen (app de Windows) y responde preflight', async () => {
    const s = await startServer();
    const pre = await fetch(`${s.base}/api/auth/guest`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:47831', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    const r = await fetch(`${s.base}/api/health`, { headers: { Origin: 'http://127.0.0.1:47831' } });
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    await s.close();
  });
});

describe('Edad y términos', () => {
  test('la aceptación se guarda en la cuenta, se audita y aparece en métricas', async () => {
    const s = await startServer();
    const u = await s.api('POST', '/api/auth/register', { username: 'mayor_edad', password: 'clave-mayor-1' });
    assert.equal((await s.api('POST', '/api/legal/accept', { version: '2026-10-14', adult: 'si' }, u.body.token)).status, 400);
    assert.equal((await s.api('POST', '/api/legal/accept', { version: '2026-10-14', adult: true }, u.body.token)).status, 200);
    const me = await s.api('GET', '/api/me', undefined, u.body.token);
    assert.equal(me.body.legal.version, '2026-10-14');
    assert.equal(me.body.legal.adult, true);
    const g = await guest(s.api, 'menor');
    assert.equal((await s.api('POST', '/api/legal/accept', { version: '2026-10-14', adult: false }, g)).status, 200);
    const a = await s.api('POST', '/api/auth/register', { username: 'admin_eko', password: 'clave-admin-123' });
    const o = await s.api('GET', '/api/admin/overview', undefined, a.body.token);
    assert.equal(o.body.metrics.termsAccepted, 1);
    assert.equal(o.body.metrics.adultsDeclared, 1);
    assert.equal(s.app.store.verifyAudit().ok, true);
    await s.close();
  });
});

import { startSumsubMock } from './sumsub-mock.ts';
import { signSumsub, mapReview } from '../src/kyc/sumsub.ts';

describe('KYC con Sumsub', () => {
  const APP = 'sbx:app-token', SECRET = 'sumsub-secret', WH = 'webhook-secret';
  const hook = (s: any, evt: object, secret = WH) => {
    const raw = JSON.stringify(evt);
    return s.api('POST', '/api/kyc/webhook', raw, undefined, { 'X-Payload-Digest': createHmac('sha256', secret).update(raw).digest('hex'), 'X-Payload-Digest-Alg': 'HMAC_SHA256_HEX' });
  };

  test('firma de solicitudes según la especificación de Sumsub', () => {
    const sig = signSumsub('secret', 1700000000, 'post', '/resources/accessTokens?userId=a&levelName=b', '');
    assert.equal(sig, createHmac('sha256', 'secret').update('1700000000POST/resources/accessTokens?userId=a&levelName=b').digest('hex'));
    assert.equal(mapReview('completed', 'GREEN', undefined), 'approved');
    assert.equal(mapReview('completed', 'RED', 'RETRY'), 'retry');
    assert.equal(mapReview('completed', 'RED', 'FINAL'), 'rejected');
    assert.equal(mapReview('onHold', undefined, undefined), 'on_hold');
  });

  test('sin claves de Sumsub la verificación aparece como no disponible', async () => {
    const s = await startServer();
    const u = await s.api('POST', '/api/auth/register', { username: 'sin_kyc', password: 'clave-sin-kyc' });
    await s.api('POST', '/api/legal/accept', { version: 'v', adult: true }, u.body.token);
    assert.equal((await s.api('GET', '/api/kyc/status', undefined, u.body.token)).body.enabled, false);
    assert.equal((await s.api('POST', '/api/kyc/start', {}, u.body.token)).status, 503);
    await s.close();
  });

  test('flujo completo: inicio, token de un solo uso, webhook aprobado y elegibilidad', async () => {
    const mock = await startSumsubMock(APP, SECRET);
    const s = await startServer({ sumsubAppToken: APP, sumsubSecretKey: SECRET, sumsubWebhookSecret: WH, sumsubBaseUrl: mock.url, sumsubLevelName: 'eko-kyc', publicUrl: 'https://juego.ekokiin.com' });
    const g = await guest(s.api, 'invitado');
    assert.equal((await s.api('POST', '/api/kyc/start', {}, g)).status, 403, 'invitados no');
    const u = await s.api('POST', '/api/auth/register', { username: 'verificable', password: 'clave-verif-1' });
    const tok = u.body.token, uid = u.body.user.id;
    assert.equal((await s.api('POST', '/api/kyc/start', {}, tok)).status, 403, 'sin declarar mayoría de edad');
    await s.api('POST', '/api/legal/accept', { version: 'v', adult: true }, tok);
    const st = await s.api('POST', '/api/kyc/start', {}, tok);
    assert.equal(st.status, 200);
    assert.match(st.body.url, /^https:\/\/juego\.ekokiin\.com\/kyc\.html#c=[\w-]{20,}$/);
    const code = st.body.url.split('#c=')[1];
    const t1 = await s.api('POST', '/api/kyc/token', { code });
    assert.equal(t1.status, 200);
    assert.equal(t1.body.token, `_act-${uid}-eko-kyc`, 'token pedido con nuestro id y el nivel configurado');
    assert.ok(mock.calls.every(c => c.sigOk), 'todas las firmas válidas para Sumsub');
    assert.equal((await s.api('POST', '/api/kyc/token', { code })).status, 410, 'el código es de un solo uso');
    assert.equal((await s.api('POST', '/api/kyc/token/refresh', { refreshKey: t1.body.refreshKey })).status, 200);
    assert.equal((await s.api('GET', '/api/kyc/status', undefined, tok)).body.status, 'started');
    // webhook con firma falsa
    assert.equal((await hook(s, { type: 'applicantReviewed', externalUserId: uid }, 'otra')).status, 401);
    await hook(s, { type: 'applicantPending', externalUserId: uid, applicantId: 'ap1' });
    assert.equal((await s.api('GET', '/api/kyc/status', undefined, tok)).body.status, 'pending');
    let el = await s.api('GET', '/api/betting/status', undefined, tok);
    assert.equal(el.body.eligibility.ok, false);
    await hook(s, { type: 'applicantReviewed', externalUserId: uid, applicantId: 'ap1', reviewResult: { reviewAnswer: 'GREEN' } });
    const after = await s.api('GET', '/api/kyc/status', undefined, tok);
    assert.equal(after.body.status, 'approved');
    assert.equal(after.body.eligibility.ok, true);
    // un "pendiente" atrasado no deshace la aprobación
    await hook(s, { type: 'applicantPending', externalUserId: uid, applicantId: 'ap1' });
    assert.equal((await s.api('GET', '/api/kyc/status', undefined, tok)).body.status, 'approved');
    assert.equal((await s.api('POST', '/api/kyc/start', {}, tok)).status, 409, 'ya verificada');
    el = await s.api('GET', '/api/betting/status', undefined, tok);
    assert.equal(el.body.eligibility.ok, true);
    assert.equal(el.body.enabled, false, 'el módulo económico sigue bloqueado aunque el usuario sea elegible');
    // métricas y auditoría
    const a = await s.api('POST', '/api/auth/register', { username: 'admin_eko', password: 'clave-admin-123' });
    const o = await s.api('GET', '/api/admin/overview', undefined, a.body.token);
    assert.equal(o.body.metrics.kycApproved, 1);
    assert.equal(o.body.kyc.enabled, true);
    assert.equal(s.app.store.verifyAudit().ok, true);
    await s.close(); await mock.close();
  });

  test('rechazo con corrección, consulta directa y rechazo final', async () => {
    const mock = await startSumsubMock(APP, SECRET);
    const s = await startServer({ sumsubAppToken: APP, sumsubSecretKey: SECRET, sumsubWebhookSecret: WH, sumsubBaseUrl: mock.url });
    const u = await s.api('POST', '/api/auth/register', { username: 'corrige', password: 'clave-corrige-1' });
    const tok = u.body.token, uid = u.body.user.id;
    await s.api('POST', '/api/legal/accept', { version: 'v', adult: true }, tok);
    await hook(s, { type: 'applicantReviewed', externalUserId: uid, applicantId: 'ap2', reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'RETRY', rejectLabels: ['BAD_PROOF_OF_IDENTITY'] } });
    const r = await s.api('GET', '/api/kyc/status', undefined, tok);
    assert.equal(r.body.status, 'retry');
    assert.deepEqual(r.body.labels, ['BAD_PROOF_OF_IDENTITY']);
    assert.equal((await s.api('POST', '/api/kyc/start', {}, tok)).status, 200, 'puede reintentar');
    // respaldo sin webhook: consulta directa a Sumsub
    mock.applicants.set(uid, { id: 'ap2', review: { reviewStatus: 'completed', reviewResult: { reviewAnswer: 'GREEN' } } });
    assert.equal((await s.api('POST', '/api/kyc/refresh', {}, tok)).body.status, 'approved');
    // rechazo final de otro usuario
    const v = await s.api('POST', '/api/auth/register', { username: 'rechazado', password: 'clave-rechazo-1' });
    await s.api('POST', '/api/legal/accept', { version: 'v', adult: true }, v.body.token);
    await hook(s, { type: 'applicantReviewed', externalUserId: v.body.user.id, reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' } });
    assert.equal((await s.api('GET', '/api/kyc/status', undefined, v.body.token)).body.status, 'rejected');
    assert.equal((await s.api('POST', '/api/kyc/start', {}, v.body.token)).status, 409);
    await s.close(); await mock.close();
  });

  test('la página de verificación permite el SDK de Sumsub en su política de seguridad', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-'));
    writeFileSync(join(dir, 'kyc.html'), '<!doctype html><title>kyc</title>');
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>');
    const s = await startServer({ staticDir: dir });
    const k = await fetch(`${s.base}/kyc.html`);
    assert.match(k.headers.get('content-security-policy') ?? '', /static\.sumsub\.com/);
    assert.match(k.headers.get('content-security-policy') ?? '', /frame-src https:\/\/\*\.sumsub\.com/);
    assert.equal(k.headers.get('permissions-policy'), null, 'cámara permitida para la selfie');
    const i = await fetch(`${s.base}/`);
    assert.doesNotMatch(i.headers.get('content-security-policy') ?? '', /sumsub/);
    assert.match(i.headers.get('permissions-policy') ?? '', /camera=\(\)/);
    await s.close();
  });
});
