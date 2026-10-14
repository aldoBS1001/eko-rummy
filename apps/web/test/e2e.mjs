// Pruebas de extremo a extremo en navegador: iPhone, Android y Windows (Playwright + Chromium/WebKit si existe).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE ?? '/opt/npm-tools/node_modules/playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const shots = join(root, 'build/screens');
const PORT = 8790;
const results = [];
async function acceptLegal(page, adult = true) {
  await page.waitForSelector('.legal-gate', { timeout: 8000 });
  await page.getByRole('button', { name: adult ? 'Soy mayor de 18 años' : 'Soy menor de 18 años' }).click();
  await page.locator('#acepto-terminos').check();
  await page.locator('.legal-gate').getByRole('button', { name: 'Continuar' }).click();
  await page.waitForSelector('.legal-gate', { state: 'detached' });
}
const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); console.log(`${cond ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };

const { startSumsubMock } = await import('../../server/test/sumsub-mock.ts');
const sumsub = await startSumsubMock('e2e-app', 'e2e-secret');
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], {
  cwd: root, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: ':memory:', AUTH_SECRET: 'e2e-secret-'.padEnd(40, 'z'), NODE_ENV: 'test', QUICK_MATCH_BOT_FILL_SECONDS: '2', ADMIN_USERS: 'admin_e2e',
    PUBLIC_URL: `http://127.0.0.1:${PORT}`, SUMSUB_APP_TOKEN: 'e2e-app', SUMSUB_SECRET_KEY: 'e2e-secret', SUMSUB_WEBHOOK_SECRET: 'e2e-wh', SUMSUB_BASE_URL: sumsub.url, SUMSUB_WEBSDK_URL: `${sumsub.url}/sdk.js` }, stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', d => process.stderr.write(d));
await new Promise(r => server.stdout.once('data', r));
const base = `http://127.0.0.1:${PORT}/`;
const browser = await chromium.launch();

const profiles = [
  ['iPhone 13', devices['iPhone 13']],
  ['Pixel 7 (Android)', devices['Pixel 7']],
  ['Windows (Edge, 1366×768)', { viewport: { width: 1366, height: 768 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0' }],
];

for (const [label, dev] of profiles) {
  const ctx = await browser.newContext({ ...dev, locale: 'es-MX' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // las fuentes de Google pueden estar bloqueadas por la red del entorno de pruebas: no cuentan como error de la app
  page.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)\.com/.test(r.url())) errors.push(`request failed ${r.url()}`); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const slug = label.split(' ')[0].toLowerCase();
  await page.goto(base);
  await page.waitForSelector('.bb-stage .t3');
  const gateBtn = await page.locator('.legal-gate button.btn.primary').isDisabled();
  ok(`${label}: pide edad y aceptación de términos (Continuar bloqueado hasta aceptar)`, gateBtn);
  await acceptLegal(page);
  // la primera visita ofrece el tutorial
  await page.getByRole('button', { name: 'Ya sé jugar' }).click({ timeout: 4000 });
  ok(`${label}: ofrece tutorial en la primera visita`, true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, `${slug}-inicio.png`) });
  const menu = ['Jugar gratis', 'Multijugador', 'Equipos', 'Torneos', 'Web3', 'Perfil', 'Configuración'];
  const seen = await Promise.all(menu.map(t => page.getByRole('button', { name: new RegExp(`^${t}`) }).first().isVisible()));
  ok(`${label}: menú inicial completo`, seen.every(Boolean));
  const manifest = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href'));
  ok(`${label}: manifiesto PWA enlazado`, manifest === 'manifest.webmanifest');

  // partida contra la IA
  await page.getByRole('button', { name: /^Jugar gratis/ }).click();
  await page.getByRole('button', { name: 'Empezar partida' }).click();
  await page.waitForSelector('.rack .tile');
  const rackCount = await page.locator('.rack .tile').count();
  ok(`${label}: reparto de 14 fichas`, rackCount === 14, `${rackCount}`);
  await page.screenshot({ path: join(shots, `${slug}-partida.png`) });
  // seleccionar dos fichas tocándolas y crear combinación inválida → indicador rojo → deshacer
  await page.locator('.rack .tile').nth(0).click();
  await page.locator('.rack .tile').nth(1).click();
  await page.getByRole('button', { name: 'Crear combinación aquí' }).click();
  const invalid = await page.locator('.set.invalid').count();
  ok(`${label}: combinación inválida marcada en rojo`, invalid === 1);
  const endDisabled = await page.getByRole('button', { name: 'Terminar turno' }).isDisabled();
  ok(`${label}: no permite terminar con jugada inválida`, endDisabled);
  await page.getByRole('button', { name: 'Deshacer' }).click();
  ok(`${label}: deshacer devuelve las fichas al atril`, (await page.locator('.rack .tile').count()) === 14);
  // arrastrar con el dedo / mouse una ficha a la mesa
  const t0 = page.locator('.rack .tile').first();
  const zone = page.locator('.newset[data-new]');
  const a = await t0.boundingBox(), b = await zone.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y - 40, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  ok(`${label}: arrastrar y soltar coloca la ficha en la mesa`, (await page.locator('.table .set .tile').count()) === 1);
  await page.getByRole('button', { name: 'Deshacer' }).click();
  // jugar varios turnos completos usando la pista (o robando)
  let turns = 0;
  for (let i = 0; i < 6; i++) {
    await page.waitForSelector('.btn.primary:not([disabled])', { timeout: 20000 });
    const hint = page.getByRole('button', { name: 'Sugerencia' });
    if (await hint.isEnabled()) {
      await hint.click(); await page.waitForTimeout(80);
      if ((await page.locator('.tile.hint').count()) > 0) await hint.click();
    }
    const primary = page.locator('.actions .btn.primary');
    await primary.click();
    turns++;
    await page.waitForTimeout(150);
    if (await page.locator('.overlay').isVisible().catch(() => false)) break;
  }
  ok(`${label}: completa turnos contra la IA`, turns >= 3, `${turns} turnos`);
  await page.screenshot({ path: join(shots, `${slug}-juego-avanzado.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`${label}: sin desbordamiento horizontal`, overflow <= 1, `${overflow}px`);
  ok(`${label}: sin errores de JavaScript`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// tutorial en iPhone
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-MX' });
  const page = await ctx.newPage();
  await page.goto(base + '#/tutorial');
  await acceptLegal(page);
  await page.waitForSelector('.coach');
  await page.screenshot({ path: join(shots, 'iphone-tutorial.png') });
  await page.getByRole('button', { name: 'Siguiente' }).click();
  for (const id of [9, 10, 11]) await page.locator(`.rack [data-id="${id}"]`).click();
  await page.getByRole('button', { name: 'Crear combinación aquí' }).click();
  for (const id of [19, 32, 45]) await page.locator(`.rack [data-id="${id}"]`).click();
  await page.getByRole('button', { name: 'Crear combinación aquí' }).click();
  await page.getByRole('button', { name: 'Terminar turno' }).click();
  await page.waitForSelector('text=¡A jugar!', { timeout: 5000 });
  ok('Tutorial guiado: escalera, grupo y apertura de 54 puntos', true);
  await page.screenshot({ path: join(shots, 'iphone-tutorial-fin.png') });
  await ctx.close();
}

// multijugador: Android vs Windows en la misma sala
{
  const c1 = await browser.newContext({ ...devices['Pixel 7'], locale: 'es-MX' });
  const c2 = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-MX' });
  const p1 = await c1.newPage(), p2 = await c2.newPage();
  for (const p of [p1, p2]) { await p.goto(base); await acceptLegal(p); await p.getByRole('button', { name: 'Ya sé jugar' }).click({ timeout: 4000 }); }
  await p1.goto(base + '#/multijugador');
  await p1.getByRole('button', { name: 'Crear sala' }).click();
  await p1.waitForSelector('.code');
  const code = (await p1.locator('.code').textContent()).trim();
  ok('Multijugador: sala privada creada con código', /^[A-Z0-9]{6}$/.test(code), code);
  await p2.goto(base + '#/sala/' + code);
  await p1.waitForSelector('text=Jugadores 2/4');
  await p1.screenshot({ path: join(shots, 'android-sala.png') });
  await p1.getByRole('button', { name: 'Principiante' }).click();
  await p1.getByRole('button', { name: 'Intermedio' }).click();
  await p1.waitForSelector('text=Jugadores 4/4');
  await p1.getByRole('button', { name: 'Iniciar partida' }).click();
  await p1.waitForSelector('.rack .tile'); await p2.waitForSelector('.rack .tile');
  ok('Multijugador: ambos dispositivos reciben su atril', (await p1.locator('.rack .tile').count()) === 14 && (await p2.locator('.rack .tile').count()) === 14);
  const racks = [await p1.locator('.rack .tile').evaluateAll(e => e.map(x => x.dataset.id)), await p2.locator('.rack .tile').evaluateAll(e => e.map(x => x.dataset.id))];
  ok('Multijugador: atriles distintos y privados', racks[0].every(id => !racks[1].includes(id)));
  // cada uno roba en su turno durante unas rondas
  let moves = 0;
  for (let i = 0; i < 40 && moves < 4; i++) {
    for (const p of [p1, p2]) {
      const btn = p.locator('.actions .btn.primary:not([disabled])');
      if (await btn.count()) { await btn.click(); moves++; await p.waitForTimeout(300); }
    }
    await p1.waitForTimeout(250);
  }
  ok('Multijugador: turnos sincronizados entre dispositivos', moves >= 4, `${moves} jugadas`);
  await p2.screenshot({ path: join(shots, 'windows-multijugador.png') });
  // reconexión: recargar la página en Android vuelve a la partida
  await p1.reload();
  await p1.waitForSelector('.rack .tile', { timeout: 10000 });
  ok('Multijugador: al recargar, el jugador vuelve a su partida', (await p1.locator('.rack .tile').count()) >= 14);
  await c1.close(); await c2.close();
}

// Web3 sin billetera y panel de admin
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(base + '#/web3');
  await acceptLegal(page, false);
  await page.goto(base + '#/web3');
  await page.waitForSelector('text=Solo para mayores de 18 años');
  ok('Edad: un menor no puede entrar a Web3', !(await page.locator('text=Conectar TronLink').count()));
  await page.getByRole('button', { name: 'Cambiar mi declaración de edad' }).click();
  await acceptLegal(page, true);
  await page.goto(base + '#/web3');
  ok('Web3: muestra la revisión del contrato', await page.locator('text=Revisión del contrato').isVisible());
  await page.goto(base + '#/terminos/apuestas');
  await page.waitForSelector('#apuestas');
  ok('Términos: sección de lo que conlleva apostar', /Lo que conlleva apostar|8\.3/.test(await page.locator('#apuestas').innerText()));
  await page.goto(base + '#/web3');
  await page.getByRole('button', { name: 'Conectar TronLink' }).click();
  await page.waitForSelector('text=No detectamos TronLink');
  ok('Web3: detecta ausencia de TronLink y explica cómo instalarlo', true);
  // TronLink simulado (inyectado como lo hace la extensión)
  await page.addInitScript(() => {
    window.tronLink = { request: async () => ({ code: 200 }), tronWeb: { defaultAddress: { base58: 'TMNKYEbXGJGFPaZXs8tBER6gMiRvjKtUiU' }, fullNode: { host: 'https://nile.trongrid.io' },
      contract: () => ({ at: async () => ({ balanceOf: () => ({ call: async () => ({ _hex: '0x1bc16d674ec80000' }) }) }) }) } };
  });
  await page.reload();
  await page.getByRole('button', { name: 'Conectar TronLink' }).click();
  await page.waitForSelector('text=Conectada');
  const bal = await page.locator('text=EKOKIIN').last().textContent();
  ok('Web3: muestra dirección abreviada y saldo leído del contrato', /2 EKOKIIN/.test(await page.content()), bal);
  ok('Web3: advierte red incorrecta (Nile)', await page.locator('text=Nile (pruebas)').isVisible());
  await page.screenshot({ path: join(shots, 'windows-web3.png'), fullPage: true });
  // admin
  const reg = await page.evaluate(async () => (await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin_e2e', password: 'clave-admin-e2e' }) })).json());
  ok('Admin: cuenta administradora creada', reg.user?.role === 'admin');
  await page.goto(base + 'admin.html');
  await page.fill('input[autocomplete=username]', 'admin_e2e');
  await page.fill('input[type=password]', 'clave-admin-e2e');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForSelector('text=Usuarios registrados');
  ok('Admin: panel con datos reales', /Partidas terminadas/.test(await page.content()));
  await page.screenshot({ path: join(shots, 'windows-admin.png'), fullPage: true });
  await ctx.close();
}

// KYC de punta a punta: perfil → página de verificación → SDK (simulado) → webhook → verificada
{
  const { createHmac } = await import('node:crypto');
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-MX' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(base);
  await acceptLegal(page, true);
  const reg = await page.evaluate(async () => (await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'kyc_e2e', password: 'clave-kyc-e2e' }) })).json());
  await page.evaluate(r => localStorage.setItem('eko.session', JSON.stringify(r)), reg);
  await page.evaluate(t => fetch('/api/legal/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ version: 'x', adult: true }) }), reg.token);
  await page.goto(base + '#/perfil');
  await page.reload();
  await page.getByRole('button', { name: 'Verificar identidad' }).click({ timeout: 10000 });
  await page.waitForURL(/kyc\.html/);
  ok('KYC: abre la página de verificación con enlace de un solo uso', !/#c=/.test(page.url()), 'el código se borra de la barra de direcciones');
  const disabled = await page.getByRole('button', { name: 'Comenzar verificación' }).isDisabled();
  ok('KYC: exige consentimiento expreso antes de iniciar', disabled);
  await page.screenshot({ path: join(shots, 'iphone-kyc.png') });
  await page.locator('#consentimiento').check();
  await page.getByRole('button', { name: 'Comenzar verificación' }).click();
  await page.waitForSelector('#fake-sdk');
  ok('KYC: lanza el SDK de Sumsub con el token del servidor', /_act-/.test(await page.locator('#fake-sdk').innerText()));
  await page.waitForSelector('text=Recibimos tu información', { timeout: 8000 });
  ok('KYC: confirma el envío al terminar', true);
  const raw = JSON.stringify({ type: 'applicantReviewed', externalUserId: reg.user.id, applicantId: 'e2e', reviewResult: { reviewAnswer: 'GREEN' } });
  const wh = await fetch(base + 'api/kyc/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Payload-Digest': createHmac('sha256', 'e2e-wh').update(raw).digest('hex'), 'X-Payload-Digest-Alg': 'HMAC_SHA256_HEX' }, body: raw });
  ok('KYC: el webhook firmado de Sumsub se acepta', wh.status === 200);
  await page.goto(base + '#/perfil');
  await page.waitForSelector('text=Tu identidad y tu mayoría de edad están verificadas', { timeout: 10000 });
  ok('KYC: el perfil muestra la identidad verificada', true);
  ok('KYC: sin errores de JavaScript', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
await sumsub.close();
await browser.close();
server.kill();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones de navegador aprobadas`);
process.exit(failed.length ? 1 : 0);
