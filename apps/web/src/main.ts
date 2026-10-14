// EKO RUMMY — aplicación web (PWA) para Android, iPhone y Windows.
import './styles.css';
import { createGame, sortRack, TILES, type AiLevel, type GameState, type RoundResult } from '../../../packages/engine/src/index.ts';
import { Board } from './board.ts';
import { billboardHero, victoryBillboard } from './billboard.ts';
import { TERMS, TERMS_VERSION, TERMS_DATE } from './terms.ts';
import { LocalController, OnlineController, Connection, type Controller, type GameOver } from './controllers.ts';
import { h, $, settings, saveSettings, applyTheme, toast, tileEl, avatarEl, AVATAR_COLORS, ICONS, sfx, GLYPHS, JOKER_SVG, celebrate } from './util.ts';
import { api, apiBase, wsUrl, session, setSession, serverAvailable, ensureSession, IS_DESKTOP_APP } from './net.ts';
import { EKOKIIN, connectWallet, readBalance, readTransfers, shortAddr, type WalletState } from './web3.ts';

declare const __ASSETS__: Record<string, string>;
const asset = (name: string) => (typeof __ASSETS__ !== 'undefined' && __ASSETS__[name]) || `img/${name}`;
const VERSION = '1.0.0';

const app = $('#app')!;
let board: Board | null = null;
let ctrl: Controller | null = null;
let conn: Connection | null = null;
let deferredInstall: any = null;

applyTheme();

// ---------------- navegación ----------------
function go(path: string) { if (location.hash !== `#${path}`) location.hash = path; else route(); }
window.addEventListener('hashchange', () => route());

function stopGame() {
  board?.destroy(); board = null;
  if (ctrl) { ctrl.leave(); ctrl = null; }
}

function route() {
  const p = location.hash.replace(/^#/, '') || '/';
  if (!p.startsWith('/partida')) stopGame();
  document.querySelectorAll('.overlay:not(.legal-gate), .coach').forEach(o => o.remove());
  const [, a, b] = p.split('/');
  switch (a) {
    case '': case undefined: return home();
    case 'jugar': return setupLocal();
    case 'multijugador': return multiplayer(false);
    case 'equipos': return multiplayer(true);
    case 'sala': return joinRoom(b);
    case 'torneos': return tournaments();
    case 'web3': return web3Screen();
    case 'perfil': return profile();
    case 'configuracion': return config();
    case 'terminos': return termsScreen(b);
    case 'tutorial': return startTutorial();
    case 'partida': if (!board) return go('/'); return;
    default: return home();
  }
}

function screen(title: string, ...body: (Node | null)[]) {
  app.replaceChildren(
    h('div', { class: 'screen' },
      h('header', { class: 'screen-head' }, h('button', { class: 'icon-btn', 'aria-label': 'Volver', html: ICONS.back, onclick: () => go('/') }), h('h2', {}, title)),
      h('main', { class: 'screen-body' }, ...body)),
  );
  window.scrollTo(0, 0);
}

function seg<T extends string | number>(options: [T, string][], value: T, onChange: (v: T) => void) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const draw = (val: T) => wrap.replaceChildren(...options.map(([v, label]) => h('button', { type: 'button', 'aria-pressed': String(v === val), onclick: () => { onChange(v); draw(v); } }, label)));
  draw(value);
  return wrap;
}

// ---------------- edad y términos ----------------
function legalOk() { return settings.legal?.version === TERMS_VERSION; }

/** Pantalla obligatoria: declaración de edad y aceptación de términos (se repite si cambian los términos). */
function legalGate(dismissable: boolean) {
  document.querySelectorAll('.legal-gate').forEach(x => x.remove());
  let adult: boolean | null = settings.legal?.adult ?? null;
  let accepted = false;
  const cont = h('button', { class: 'btn primary', disabled: true, onclick: () => {
    settings.legal = { version: TERMS_VERSION, adult: !!adult, at: Date.now() };
    saveSettings();
    if (apiBase()) api('POST', '/api/legal/accept', { version: TERMS_VERSION, adult: !!adult }).catch(() => {});
    ov.remove();
    toast(adult ? 'Listo. ¡A jugar!' : 'Listo. Puedes jugar gratis; Web3 queda oculto.');
    if (board) board.render(); else route();
  } }, 'Continuar');
  const minorNote = h('div', { class: 'notice', hidden: true }, 'Puedes jugar gratis contra la IA y en línea. La billetera Web3 y cualquier función con valor económico no estarán disponibles.');
  const refresh = () => {
    cont.disabled = adult === null || !accepted;
    minorNote.hidden = adult !== false;
    ageSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.v === String(adult))));
  };
  const ageSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Edad' },
    h('button', { type: 'button', 'data-v': 'true', onclick: () => { adult = true; refresh(); } }, 'Soy mayor de 18 años'),
    h('button', { type: 'button', 'data-v': 'false', onclick: () => { adult = false; refresh(); } }, 'Soy menor de 18 años'));
  const chk = h('input', { type: 'checkbox', id: 'acepto-terminos', style: { width: '22px', height: '22px', minHeight: '0', flex: '0 0 auto', accentColor: '#e8b649' }, onchange: (e: Event) => { accepted = (e.target as HTMLInputElement).checked; refresh(); } });
  const ov = h('div', { class: 'overlay legal-gate', style: { zIndex: '400' } },
    h('div', { class: 'modal' },
      h('img', { src: asset('eko-logo.webp'), alt: "EKO K'iin", style: { height: '54px', width: 'auto', background: '#f4ecd6', borderRadius: '10px', padding: '4px 8px', justifySelf: 'start' } }),
      h('h2', {}, 'Antes de jugar'),
      h('p', {}, 'EKO RUMMY es gratuito. Algunas funciones, como la billetera Web3, son solo para mayores de edad.'),
      h('span', { class: 'lbl' }, '¿Cuál es tu edad?'), ageSeg, minorNote,
      h('label', { for: 'acepto-terminos', class: 'row', style: { alignItems: 'flex-start', gap: '10px', cursor: 'pointer', flexWrap: 'nowrap' } }, chk,
        h('span', {}, 'Declaro que la información es verdadera y acepto los ', h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); termsSheet(); } }, 'Términos y condiciones'), ', incluidas las condiciones sobre apuestas, y el aviso de privacidad.')),
      h('div', { class: 'row' }, dismissable ? h('button', { class: 'btn ghost grow', onclick: () => ov.remove() }, 'Cancelar') : null, h('div', { class: 'grow', style: { display: 'grid' } }, cont)),
      h('p', { class: 'foot', style: { textAlign: 'left' } }, `Versión de términos ${TERMS_VERSION}.`)));
  document.body.append(ov);
  refresh();
}

function termsBody(): HTMLElement {
  const wrap = h('div', { class: 'terms' },
    h('p', { class: 'foot', style: { textAlign: 'left' } }, `Última actualización: ${TERMS_DATE}. Versión ${TERMS_VERSION}.`));
  for (const sec of TERMS) {
    const s = h('section', { id: sec.title.startsWith('8.') ? 'apuestas' : undefined }, h('h3', {}, sec.title));
    for (const p of sec.body) s.append(Array.isArray(p) ? h('ul', {}, ...p.map(li => h('li', {}, li))) : h('p', {}, p));
    wrap.append(s);
  }
  return wrap;
}

function termsSheet() {
  const ov = h('div', { class: 'overlay', style: { zIndex: '450' }, onclick: (e: Event) => { if (e.target === ov) ov.remove(); } },
    h('div', { class: 'modal', style: { width: 'min(720px, 100%)' } }, h('h2', {}, 'Términos y condiciones'), termsBody(),
      h('button', { class: 'btn', onclick: () => ov.remove() }, 'Cerrar')));
  document.body.append(ov);
}

function termsScreen(anchor?: string) {
  screen('Términos y condiciones', h('section', { class: 'card' }, termsBody()),
    h('button', { class: 'btn ghost', onclick: () => legalGate(true) }, 'Revisar mi aceptación'));
  if (anchor === 'apuestas') setTimeout(() => document.getElementById('apuestas')?.scrollIntoView({ behavior: 'smooth' }), 50);
}

// ---------------- inicio ----------------
function titleTiles() {
  const letters: [string, number][] = [['E', 0], ['K', 1], ['O', 2], [' ', -1], ['R', 3], ['U', 0], ['M', 1], ['M', 2], ['Y', 3]];
  const row = h('div', { class: 'title-tiles', role: 'img', 'aria-label': 'EKO RUMMY' });
  letters.forEach(([ch, c], i) => {
    if (c < 0) return row.append(h('span', { class: 'gap' }));
    const t = h('div', { class: `tile c${c}` }, h('span', { class: 'n' }, ch), h('span', { html: GLYPHS[c], style: { display: 'contents' } }));
    t.style.setProperty('--i', String(i));
    t.style.setProperty('--rz', `${(i % 2 ? 1 : -1) * (1 + (i % 3))}deg`);
    row.append(t);
  });
  return row;
}

function home() {
  const install = deferredInstall || isIOS() && !isStandalone();
  app.replaceChildren(
    h('div', { class: 'home' },
      h('div', { class: 'home-top' },
        h('img', { src: asset('eko-logo.webp'), alt: "EKO K'iin" , style: { height: '46px', background: '#f4ecd6', borderRadius: '10px', padding: '4px 8px' } }),
        h('div', { class: 'row' },
          install ? h('button', { class: 'btn small ghost', onclick: installApp }, 'Instalar app') : null,
          h('button', { class: 'icon-btn', 'aria-label': 'Configuración', html: ICONS.gear, onclick: () => go('/configuracion') })),
      ),
      h('div', { class: 'home-hero' },
        billboardHero(),
        h('p', { class: 'home-sub' }, 'Arma grupos y escaleras, reorganiza la mesa y quédate sin fichas antes que nadie.'),
        h('nav', { class: 'menu', 'aria-label': 'Menú principal' },
          h('button', { class: 'btn primary', onclick: () => go('/jugar') }, 'Jugar gratis', h('small', {}, 'contra la IA, sin conexión')),
          h('button', { class: 'btn', onclick: () => go('/multijugador') }, 'Multijugador', h('small', {}, '2 a 4 en línea')),
          h('button', { class: 'btn', onclick: () => go('/equipos') }, 'Equipos', h('small', {}, '2 contra 2')),
          h('div', { class: 'menu-row' },
            h('button', { class: 'btn ghost', onclick: () => go('/torneos') }, 'Torneos'),
            h('button', { class: 'btn ghost', onclick: () => go('/web3') }, 'Web3'),
            h('button', { class: 'btn ghost', onclick: () => go('/perfil') }, 'Perfil')),
          h('div', { class: 'menu-row', style: { gridTemplateColumns: '1fr 1fr' } },
            h('button', { class: 'btn ghost', onclick: () => go('/tutorial') }, 'Aprender a jugar'),
            h('button', { class: 'btn ghost', onclick: () => go('/configuracion') }, 'Configuración')),
        ),
      ),
      h('p', { class: 'foot' }, `EKO RUMMY ${VERSION} · Business Shop · EKO K'iin · `, h('a', { href: '#/terminos' }, 'Términos y condiciones')),
    ),
    h('img', { class: 'home-guide', src: asset('guia.webp'), alt: '' }),
  );
  // fichas flotando al fondo
  const fl = h('div', { class: 'floaters', 'aria-hidden': 'true' });
  for (let i = 0; i < 9; i++) {
    const t = tileEl(TILES[(i * 23) % 104].id);
    t.tabIndex = -1;
    t.style.left = `${(i * 11 + 4) % 96}%`;
    t.style.setProperty('--d', `${-i * 2.1}s`);
    fl.append(t);
  }
  app.querySelector('.home')?.prepend(fl);
  // inclinación 3D del título con el mouse o el giroscopio
  const tt = app.querySelector('.title-tiles') as HTMLElement | null;
  const tilt = (x: number, y: number) => { tt?.style.setProperty('--rx', String(x * 14)); tt?.style.setProperty('--ry', String(-y * 10)); };
  app.querySelector('.home')?.addEventListener('pointermove', e => { const pe = e as PointerEvent; tilt(pe.clientX / innerWidth - .5, pe.clientY / innerHeight - .5); });
  window.ondeviceorientation = e => { if (location.hash && location.hash !== '#/') return; if (e.gamma != null && e.beta != null) tilt(Math.max(-1, Math.min(1, e.gamma / 45)) / 2, Math.max(-1, Math.min(1, (e.beta - 45) / 45)) / 2); };
  if (legalOk() && !settings.tutorialDone && !sessionStorageGet('eko.tutoOffer')) {
    sessionStorageSet('eko.tutoOffer', '1');
    setTimeout(() => offerTutorial(), 600);
  }
}

function sessionStorageGet(k: string) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch {} }

function offerTutorial() {
  if (location.hash && location.hash !== '#/') return;
  const ov = h('div', { class: 'overlay' },
    h('div', { class: 'modal', style: { textAlign: 'center' } },
      h('img', { src: asset('guia.webp'), alt: '', style: { height: '180px', margin: '0 auto' } }),
      h('h2', {}, '¿Primera vez?'),
      h('p', {}, 'Te enseño a jugar en menos de dos minutos con una partida guiada.'),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost grow', onclick: () => ov.remove() }, 'Ya sé jugar'), h('button', { class: 'btn primary grow', onclick: () => { ov.remove(); go('/tutorial'); } }, 'Enséñame')),
    ));
  document.body.append(ov);
}

// ---------------- instalación (PWA) ----------------
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
window.addEventListener('beforeinstallprompt', (e: any) => { e.preventDefault(); deferredInstall = e; if (!location.hash || location.hash === '#/') home(); });
async function installApp() {
  if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; return home(); }
  installHelp();
}
function installHelp() {
  const ov = h('div', { class: 'overlay', onclick: (e: Event) => { if (e.target === ov) ov.remove(); } },
    h('div', { class: 'modal' },
      h('h2', {}, 'Instala EKO RUMMY'),
      h('div', { class: 'card' }, h('h3', {}, 'iPhone y iPad'), h('p', {}, 'Abre esta página en Safari, toca Compartir y elige "Agregar a pantalla de inicio".')),
      h('div', { class: 'card' }, h('h3', {}, 'Android'), h('p', {}, 'En Chrome, abre el menú ⋮ y elige "Instalar app" o "Agregar a la pantalla principal".')),
      h('div', { class: 'card' }, h('h3', {}, 'Windows'), h('p', {}, 'En Edge o Chrome, haz clic en el ícono de instalar de la barra de direcciones, o en el menú elige "Aplicaciones › Instalar EKO RUMMY".')),
      h('button', { class: 'btn', onclick: () => ov.remove() }, 'Entendido')));
  document.body.append(ov);
}

// ---------------- jugar gratis ----------------
function setupLocal() {
  const cfg = { rivals: 3, level: 'intermedio' as AiLevel, turnSeconds: settings.turnSeconds, rounds: 1, teams: false };
  const levelLabels: [AiLevel, string][] = [['principiante', 'Principiante'], ['intermedio', 'Intermedio'], ['avanzado', 'Avanzado'], ['experto', 'Experto']];
  const nameIn = h('input', { value: settings.name, maxlength: '16', placeholder: 'Tu nombre', 'aria-label': 'Tu nombre' });
  screen('Jugar gratis',
    h('section', { class: 'card' },
      h('div', { class: 'field' }, h('label', {}, 'Tu nombre'), nameIn),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Rivales'), seg<number>([[1, '1'], [2, '2'], [3, '3']], cfg.rivals, v => (cfg.rivals = v))),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Dificultad de la IA'), seg(levelLabels, cfg.level, v => (cfg.level = v))),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Tiempo por turno'), seg<number>([[0, 'Sin límite'], [60, '60 s'], [90, '90 s'], [120, '2 min']], cfg.turnSeconds, v => (cfg.turnSeconds = v))),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Rondas'), seg<number>([[1, '1'], [3, '3'], [5, '5']], cfg.rounds, v => (cfg.rounds = v))),
      h('button', { class: 'btn primary', onclick: () => {
        settings.name = nameIn.value.trim().slice(0, 16); settings.turnSeconds = cfg.turnSeconds; saveSettings();
        startLocal({ name: settings.name || 'Tú', avatar: settings.avatar, levels: Array(cfg.rivals).fill(cfg.level), turnSeconds: cfg.turnSeconds, rounds: cfg.rounds });
      } }, 'Empezar partida'),
    ),
    h('section', { class: 'card' },
      h('h3', {}, 'Equipos contra la IA'),
      h('p', {}, 'Tú y una IA aliada contra dos rivales. Gana el equipo de quien se quede primero sin fichas.'),
      h('button', { class: 'btn', onclick: () => startLocal({ name: settings.name || 'Tú', avatar: settings.avatar, levels: [cfg.level, cfg.level, cfg.level], teams: true, turnSeconds: cfg.turnSeconds, rounds: cfg.rounds }) }, 'Jugar 2 contra 2'),
    ),
    h('p', { class: 'foot' }, 'La partida contra la IA funciona sin conexión y no requiere cuenta, billetera ni compras.'),
  );
}

function startLocal(opts: ConstructorParameters<typeof LocalController>[0], tutorial = false) {
  stopGame();
  const c = new LocalController(opts);
  if (tutorial) c.kind = 'tutorial';
  mountGame(c, () => startLocal(opts, false));
  return c;
}

function mountGame(c: Controller, again?: () => void) {
  ctrl = c;
  const root = h('div', { style: { display: 'contents' } });
  app.replaceChildren(root);
  if (location.hash !== '#/partida') history.replaceState(null, '', '#/partida');
  board = new Board(c, root);
  board.onExit = () => go('/');
  c.onRoundOver = r => roundModal(c, r);
  c.onGameOver = g => gameOverModal(c, g, again);
}

function scoreTable(c: Controller, points: number[], highlight: number | null, remaining?: number[][]) {
  const v = c.view!;
  return h('table', { class: 'scores' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Jugador'), remaining ? h('th', {}, 'Fichas restantes') : null, h('th', { class: 'num' }, 'Puntos'))),
    h('tbody', {}, ...v.players.map((p, i) => h('tr', { class: i === highlight ? 'win' : '' },
      h('td', {}, i === v.seat ? 'Tú' : p.name, p.team != null ? ` (equipo ${p.team === 0 ? 'A' : 'B'})` : ''),
      remaining ? h('td', {}, h('div', { class: 'mini-rack' }, ...remaining[i].map(id => tileEl(id)))) : null,
      h('td', { class: 'num' }, (points[i] > 0 ? '+' : '') + points[i])))));
}

function roundModal(c: Controller, r: RoundResult) {
  const v = c.view!;
  const won = r.winnerSeat === v.seat || (r.winnerTeam != null && v.players[v.seat].team === r.winnerTeam);
  won ? sfx.win() : sfx.lose();
  const ov = h('div', { class: 'overlay' },
    h('div', { class: 'modal' },
      h('h2', {}, won ? '¡Ganaste la ronda!' : `Ronda para ${r.winnerSeat === v.seat ? 'ti' : v.players[r.winnerSeat].name}`),
      h('p', {}, r.reason === 'blocked' ? 'El pozo se agotó y nadie pudo jugar: gana quien tenía menos puntos en el atril.' : 'Alguien se quedó sin fichas.'),
      scoreTable(c, r.points, r.winnerSeat, r.remaining),
      h('p', {}, `Marcador acumulado: ${v.scores.map((s, i) => `${i === v.seat ? 'Tú' : v.players[i].name} ${s}`).join(', ')}`),
      c.kind === 'online' ? h('p', {}, 'La siguiente ronda empieza en unos segundos…') :
        h('button', { class: 'btn primary', onclick: () => { ov.remove(); (c as LocalController).nextRound(); } }, 'Siguiente ronda'),
    ));
  document.body.append(ov);
  if (c.kind === 'online') setTimeout(() => ov.remove(), 7500);
}

function gameOverModal(c: Controller, g: GameOver, again?: () => void) {
  const v = c.view!;
  const myTeam = v.players[v.seat].team;
  const won = g.teams ? myTeam === g.winnerTeam : g.winnerSeat === v.seat;
  won ? sfx.win() : sfx.lose();
  if (c.kind === 'tutorial') { settings.tutorialDone = true; saveSettings(); }
  const last = g.history[g.history.length - 1];
  const ov = h('div', { class: 'overlay' },
    h('div', { class: 'modal' },
      h('h2', {}, won ? (g.teams ? '¡Tu equipo ganó!' : '¡Ganaste la partida!') : 'Fin de la partida'),
      g.teams ? h('p', {}, `Equipo A ${g.teams[0]} · Equipo B ${g.teams[1]}`) : null,
      scoreTable(c, g.scores, g.teams ? null : g.winnerSeat, last?.remaining),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost grow', onclick: () => { ov.remove(); go('/'); } }, 'Menú'),
        again ? h('button', { class: 'btn primary grow', onclick: () => { ov.remove(); again(); } }, 'Jugar otra vez') : null),
    ));
  if (won) victoryBillboard(g.teams ? 'EQUIPO GANA' : 'GANASTE').then(() => { document.body.append(ov); celebrate(); });
  else document.body.append(ov);
}

// ---------------- tutorial ----------------
function riggedTutorialState(): GameState {
  const s = createGame('tutorial', [{ id: 'me', name: 'Tú' }, { id: 'ia', name: 'Kiin', isBot: true, botLevel: 'principiante' }], { turnSeconds: 0 });
  const T = (c: number, v: number, copy = 0) => copy * 52 + c * 13 + (v - 1);
  const want = [T(0, 10), T(0, 11), T(0, 12), T(1, 7), T(2, 7), T(3, 7), T(1, 2), T(2, 9), T(3, 4), T(1, 12), T(0, 3), T(2, 13), T(3, 11), 104];
  // intercambia fichas entre atriles y pozo manteniendo la integridad (106 fichas, sin duplicados)
  const where = (id: number) => s.players[0].rack.includes(id) ? s.players[0].rack : s.players[1].rack.includes(id) ? s.players[1].rack : s.pool;
  for (const id of want) {
    if (s.players[0].rack.includes(id)) continue;
    const out = s.players[0].rack.find(x => !want.includes(x))!;
    const src = where(id);
    src[src.indexOf(id)] = out;
    s.players[0].rack[s.players[0].rack.indexOf(out)] = id;
  }
  s.players[0].rack = sortRack(s.players[0].rack);
  return s;
}

function startTutorial() {
  stopGame();
  const T = (c: number, v: number) => c * 13 + (v - 1);
  const run = [T(0, 10), T(0, 11), T(0, 12)];
  const c = startLocal({ name: settings.name || 'Tú', avatar: settings.avatar, levels: ['principiante'], turnSeconds: 0, state: riggedTutorialState() }, true);
  c.botDelay = [1400, 1900];
  let step = 0;
  const steps: { text: string; button?: string; done?: (b: Board) => boolean; enter?: (b: Board) => void }[] = [
    { text: 'Hola, soy tu guía. Cada ficha tiene un número del 1 al 13 y uno de cuatro colores, cada uno con su símbolo: hoja, sol, gota y luna. La del rayo es el comodín.', button: 'Siguiente' },
    { text: 'Una escalera son 3 o más números seguidos del mismo color. Toca las tres fichas que brillan: 10, 11 y 12 de color Jade.', enter: b => { b.hintIds = new Set(run); b.render(); }, done: b => run.every(id => b.selected.has(id)) },
    { text: 'Ahora toca "Crear combinación aquí" en la mesa. También puedes arrastrar las fichas.', done: b => b.table.some(s => run.every(id => s.includes(id))) },
    { text: 'Un grupo es el mismo número en colores distintos. Arma el grupo de 7 con los tres sietes de tu atril.', done: b => b.table.some(s => s.length >= 3 && s.every(id => id < 104 && (id % 13) === 6)) },
    { text: 'Tu primera jugada debe sumar 30 puntos o más: 10+11+12+7+7+7 = 54. Toca "Terminar turno".', done: b => !!b.view?.opened },
    { text: 'Después de abrir puedes mover fichas de la mesa para crear nuevas combinaciones, siempre que todo quede válido al terminar. Si no puedes jugar, roba una ficha. Gana quien se quede sin fichas. ¡Ahora juega tú!', button: '¡A jugar!' },
  ];
  const draw = (b: Board) => {
    document.querySelectorAll('.coach').forEach(x => x.remove());
    if (step >= steps.length) return;
    const st = steps[step];
    if (st.done?.(b)) { step++; steps[step]?.enter?.(b); return draw(b); }
    const say = h('div', { class: 'say' }, h('b', {}, 'Tu guía'), h('span', {}, st.text));
    if (st.button) say.append(h('button', { class: 'btn small primary', onclick: () => { step++; if (step >= steps.length) { settings.tutorialDone = true; saveSettings(); } steps[step]?.enter?.(b); draw(b); } }, st.button));
    else say.append(h('button', { class: 'btn small ghost', onclick: () => { step = steps.length; settings.tutorialDone = true; saveSettings(); draw(b); } }, 'Saltar tutorial'));
    document.body.append(h('div', { class: 'coach' }, h('img', { src: asset('guia.webp'), alt: '' }), say));
  };
  board!.coach = draw;
  draw(board!);
}

// ---------------- en línea ----------------
async function ensureConn(): Promise<Connection> {
  const s = await ensureSession();
  if (conn && conn.status !== 'closed' && conn.token === s.token) return conn;
  conn?.close();
  conn = new Connection(wsUrl(), s.token);
  conn.on(globalOnlineHandler);
  conn.onStatus = st => { if (st === 'closed' && board && ctrl?.kind === 'online') toast('Conexión perdida. Reconectando…', true); };
  await conn.connect();
  return conn;
}

function globalOnlineHandler(m: any) {
  switch (m.t) {
    case 'state':
      if (!board || ctrl?.kind !== 'online') { document.querySelectorAll('.overlay').forEach(o => o.remove()); mountGame(new OnlineController(conn!, m)); }
      break;
    case 'lobby': if (!board) lobby(m); break;
    case 'queued': queued(); break;
    case 'invite': inviteToast(m.from, m.code); break;
    case 'tournament_match': inviteToast('Tu torneo', m.code); break;
    case 'error': if (!board) toast(m.message, true); break;
    case 'welcome': if (m.announcement) toast(m.announcement); break;
    case 'kyc': toast(m.status === 'approved' ? 'Tu identidad quedó verificada.' : `Verificación: ${KYC_LABEL[m.status] ?? m.status}`, m.status === 'rejected'); break;
  }
}

function inviteToast(from: string, code: string) {
  const ov = h('div', { class: 'overlay' }, h('div', { class: 'modal' },
    h('h2', {}, 'Invitación'), h('p', {}, `${from} te invita a la sala ${code}.`),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost grow', onclick: () => ov.remove() }, 'Ahora no'), h('button', { class: 'btn primary grow', onclick: () => { ov.remove(); conn?.send({ t: 'join', code }); } }, 'Unirme'))));
  document.body.append(ov);
}

function offlineNotice() {
  return h('section', { class: 'card' },
    h('h3', {}, 'El servidor de partidas en línea no está disponible'),
    h('p', {}, apiBase() ? `No hay respuesta de ${apiBase()}. Revisa tu conexión a internet o inténtalo más tarde.` : 'Esta copia del juego aún no tiene servidor en línea. Escribe su dirección en Configuración › Avanzado.'),
    h('p', {}, 'Mientras tanto puedes jugar gratis contra la IA, que funciona sin conexión.'),
    h('button', { class: 'btn primary', onclick: () => go('/jugar') }, 'Jugar contra la IA'));
}

async function multiplayer(teams: boolean) {
  const title = teams ? 'Equipos' : 'Multijugador';
  screen(title, h('div', { class: 'row' }, h('div', { class: 'spinner' }), 'Conectando…'));
  if (!(await serverAvailable())) return screen(title, offlineNotice());
  try { await ensureConn(); } catch (e) { return screen(title, offlineNotice()); }
  const opt = { size: 4, turnSeconds: 90, rounds: 1 };
  const code = h('input', { placeholder: 'Código de 6 letras', maxlength: '6', style: { textTransform: 'uppercase', letterSpacing: '.2em' }, 'aria-label': 'Código de sala' });
  screen(title,
    h('section', { class: 'card' },
      h('h3', {}, 'Partida rápida'),
      h('p', {}, teams ? 'Te emparejamos con tres jugadores: dos equipos de dos. Si nadie llega en 30 segundos, la IA completa la mesa.' : 'Te emparejamos con jugadores de todo el mundo. Si nadie llega en 30 segundos, la IA completa la mesa.'),
      teams ? h('button', { class: 'btn primary', onclick: () => conn!.send({ t: 'quick', teams: true }) }, 'Buscar partida 2 contra 2')
        : h('div', { class: 'menu-row' }, ...[2, 3, 4].map(n => h('button', { class: 'btn primary', onclick: () => conn!.send({ t: 'quick', size: n }) }, `${n} jugadores`))),
    ),
    h('section', { class: 'card' },
      h('h3', {}, 'Sala privada'),
      h('p', {}, 'Crea una sala y comparte el código o el enlace con tus amigos.'),
      teams ? null : h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Jugadores'), seg<number>([[2, '2'], [3, '3'], [4, '4']], opt.size, v => (opt.size = v))),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Tiempo por turno'), seg<number>([[60, '60 s'], [90, '90 s'], [120, '2 min'], [0, 'Sin límite']], opt.turnSeconds, v => (opt.turnSeconds = v))),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Rondas'), seg<number>([[1, '1'], [3, '3'], [5, '5']], opt.rounds, v => (opt.rounds = v))),
      h('button', { class: 'btn', onclick: () => conn!.send({ t: 'create', size: opt.size, teams, turnSeconds: opt.turnSeconds, rounds: opt.rounds }) }, 'Crear sala'),
    ),
    h('section', { class: 'card' },
      h('h3', {}, 'Unirme con código'),
      h('form', { class: 'row', onsubmit: (e: Event) => { e.preventDefault(); if (code.value.trim().length === 6) conn!.send({ t: 'join', code: code.value.trim().toUpperCase() }); } },
        h('div', { class: 'grow' }, code), h('button', { class: 'btn', type: 'submit' }, 'Unirme'))),
  );
}

async function joinRoom(code?: string) {
  if (!code) return go('/multijugador');
  screen('Uniéndote…', h('div', { class: 'row' }, h('div', { class: 'spinner' }), `Sala ${code}`));
  if (!(await serverAvailable())) return screen('Sala', offlineNotice());
  try { (await ensureConn()).send({ t: 'join', code: code.toUpperCase() }); } catch { screen('Sala', offlineNotice()); }
}

function queued() {
  screen('Buscando jugadores',
    h('section', { class: 'card', style: { justifyItems: 'center', textAlign: 'center' } },
      h('div', { class: 'spinner' }), h('p', {}, 'Buscando rivales… Si tarda, la IA completará la mesa.'),
      h('button', { class: 'btn ghost', onclick: () => { conn?.send({ t: 'cancel_quick' }); go('/multijugador'); } }, 'Cancelar')));
}

function lobby(m: any) {
  const link = `${location.origin}${location.pathname}#/sala/${m.code}`;
  const share = async () => {
    try { if (navigator.share) await navigator.share({ title: 'EKO RUMMY', text: `Juega conmigo EKO RUMMY. Sala ${m.code}`, url: link }); else { await navigator.clipboard.writeText(link); toast('Enlace copiado'); } }
    catch {}
  };
  const levels: [AiLevel, string][] = [['principiante', 'Principiante'], ['intermedio', 'Intermedio'], ['avanzado', 'Avanzado'], ['experto', 'Experto']];
  screen(m.teams ? 'Sala de equipos' : 'Sala privada',
    h('section', { class: 'card', style: { textAlign: 'center', justifyItems: 'center' } },
      h('span', { class: 'lbl' }, 'Código de la sala'), h('div', { class: 'code' }, m.code),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: share }, 'Invitar'), h('button', { class: 'btn ghost', onclick: () => navigator.clipboard?.writeText(m.code).then(() => toast('Código copiado')) }, 'Copiar código'))),
    h('section', { class: 'card' },
      h('h3', {}, `Jugadores ${m.seats.length}/${m.size}`),
      h('div', { class: 'list' }, ...m.seats.map((s: any, i: number) => h('div', { class: 'list-item' }, avatarEl(s.name, i * 2), h('div', { class: 'grow' }, s.name, s.you ? ' (tú)' : ''),
        m.teams ? h('span', { class: 'pill' }, i % 2 ? 'Equipo B' : 'Equipo A') : null, s.isBot ? h('span', { class: 'pill' }, s.botLevel) : null))),
      m.isHost && m.seats.length < m.size ? h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Agregar IA'), h('div', { class: 'seg' }, ...levels.map(([l, t]) => h('button', { type: 'button', onclick: () => conn!.send({ t: 'add_bot', level: l }) }, t)))) : null,
      m.isHost ? h('button', { class: 'btn primary', disabled: m.seats.length < 2 || (m.teams && m.seats.length < 4), onclick: () => conn!.send({ t: 'start' }) }, 'Iniciar partida')
        : h('p', {}, 'Esperando a que el anfitrión inicie la partida…'),
      h('button', { class: 'btn ghost', onclick: () => { conn!.send({ t: 'leave' }); go('/multijugador'); } }, 'Salir de la sala')),
  );
}

// ---------------- torneos ----------------
async function tournaments() {
  screen('Torneos', h('div', { class: 'row' }, h('div', { class: 'spinner' }), 'Cargando…'));
  if (!(await serverAvailable())) return screen('Torneos', offlineNotice());
  let data: any;
  try { data = await api('GET', '/api/tournaments'); } catch (e) { return screen('Torneos', h('p', {}, (e as Error).message)); }
  const name = h('input', { placeholder: 'Nombre del torneo', maxlength: '40' });
  let size = 4;
  const registered = session && session.user.role !== 'guest';
  screen('Torneos',
    h('section', { class: 'card' }, h('h3', {}, 'Torneos gratuitos'), h('p', {}, 'Eliminación directa en duelos 1 contra 1. Sin inscripción ni premios en dinero. Cuando se llenan los lugares, empiezan las partidas; si alguien no se presenta, la IA juega por él.')),
    registered ? h('section', { class: 'card' }, h('h3', {}, 'Crear torneo'), name, seg<number>([[4, '4 jugadores'], [8, '8 jugadores']], 4, v => (size = v)),
      h('button', { class: 'btn primary', onclick: async () => { try { await api('POST', '/api/tournaments', { name: name.value, size }); toast('Torneo creado'); tournaments(); } catch (e) { toast((e as Error).message, true); } } }, 'Crear torneo'))
      : h('section', { class: 'card' }, h('p', {}, 'Crea una cuenta en Perfil para organizar torneos. Para unirte basta con jugar como invitado.')),
    ...(data.tournaments.length ? data.tournaments.map((t: any) => h('section', { class: 'card' },
      h('div', { class: 'row' }, h('h3', { class: 'grow' }, t.name), h('span', { class: 'pill' }, t.status === 'registration' ? `${t.entrants.length}/${t.size} inscritos` : t.status === 'running' ? 'En juego' : 'Terminado')),
      t.champion ? h('p', {}, `Campeón: ${t.champion}`) : null,
      t.matches.length ? h('div', { class: 'list' }, ...t.matches.map((m: any) => h('div', { class: 'list-item' }, h('span', { class: 'pill' }, `Ronda ${m.round}`), h('span', { class: 'grow' }, `${m.a} vs ${m.b}`), m.winner ? h('b', {}, m.winner) : m.code ? h('button', { class: 'btn small', onclick: () => go(`/sala/${m.code}`) }, 'Ir') : null))) : null,
      t.status === 'registration' ? h('button', { class: 'btn', onclick: async () => { try { await ensureSession(); await ensureConn(); await api('POST', `/api/tournaments/${t.id}/join`); toast('Inscrito. Te avisaremos cuando empiece tu partida.'); tournaments(); } catch (e) { toast((e as Error).message, true); } } }, 'Inscribirme') : null,
    )) : [h('section', { class: 'card' }, h('p', {}, 'No hay torneos abiertos. Crea el primero.'))]),
  );
}

// ---------------- Web3 ----------------
function appendKids(el: HTMLElement, ...kids: (Node | null)[]) { for (const k of kids) if (k) el.append(k); }
let wallet: WalletState | null = null;
async function web3Screen() {
  if (!settings.legal?.adult) {
    return screen('Web3', h('section', { class: 'card' },
      h('h3', {}, 'Solo para mayores de 18 años'),
      h('p', {}, 'La billetera y el token EKOKIIN están disponibles únicamente para personas mayores de edad. Puedes seguir jugando gratis todo lo demás.'),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost grow', onclick: () => go('/') }, 'Volver al menú'), h('button', { class: 'btn grow', onclick: () => legalGate(true) }, 'Cambiar mi declaración de edad'))));
  }
  const body = h('div', { style: { display: 'grid', gap: '16px' } });
  const tokenCard = h('section', { class: 'card' },
    h('div', { class: 'row' }, h('img', { src: asset('eko-logo.webp'), alt: '', style: { width: '56px', background: '#f4ecd6', borderRadius: '10px', padding: '4px' } }),
      h('div', { class: 'grow' }, h('h3', {}, EKOKIIN.name), h('p', {}, `${EKOKIIN.symbol} · TRC-20 · TRON`))),
    h('div', { class: 'list' },
      h('div', { class: 'list-item' }, h('span', { class: 'grow' }, 'Contrato'), h('code', { style: { fontSize: '12px', wordBreak: 'break-all' } }, EKOKIIN.contract)),
      h('div', { class: 'list-item' }, h('span', { class: 'grow' }, 'Decimales'), h('b', {}, String(EKOKIIN.decimals))),
      h('div', { class: 'list-item' }, h('span', { class: 'grow' }, 'Suministro total'), h('b', {}, EKOKIIN.supply))),
    h('div', { class: 'row' }, h('a', { class: 'btn small ghost', href: EKOKIIN.explorer, target: '_blank', rel: 'noopener' }, 'Ver en TronScan'), h('a', { class: 'btn small ghost', href: EKOKIIN.swap, target: '_blank', rel: 'noopener' }, 'Abrir SUN.io')),
    h('p', { style: { fontSize: '13px' } }, 'Datos verificados en TronScan el 14 de octubre de 2026. EKO RUMMY no asigna ni garantiza un precio al token. SUN.io es un servicio externo; cualquier operación ahí es responsabilidad de cada usuario.'),
  );
  const walletCard = h('section', { class: 'card' });
  const renderWallet = async () => {
    walletCard.replaceChildren(h('h3', {}, 'Tu billetera'));
    if (!wallet || wallet.status !== 'connected') {
      appendKids(walletCard,
        h('p', {}, 'Conecta TronLink para ver tu saldo de EKOKIIN y tus movimientos. Nunca te pediremos tu frase semilla ni tu llave privada.'),
        wallet?.status === 'no-wallet' ? h('div', { class: 'notice' }, 'No detectamos TronLink. En computadora instala la extensión TronLink para Chrome o Edge. En iPhone o Android abre este juego desde el navegador DApp de la app TronLink.') : null,
        wallet?.status === 'locked' ? h('div', { class: 'notice' }, 'TronLink está bloqueado. Desbloquéalo e inténtalo de nuevo.') : null,
        wallet?.status === 'rejected' ? h('div', { class: 'notice' }, 'Cancelaste la conexión en TronLink.') : null,
        h('button', { class: 'btn primary', onclick: async () => { wallet = await connectWallet(); renderWallet(); } }, 'Conectar TronLink'));
      return;
    }
    const w = wallet;
    const bal = h('b', {}, '…');
    const hist = h('div', { class: 'list' }, h('p', {}, 'Cargando movimientos…'));
    appendKids(walletCard,
      h('div', { class: 'row' }, h('span', { class: 'grow' }, `Conectada: ${shortAddr(w.address)}`), h('button', { class: 'btn small ghost', onclick: () => { wallet = null; renderWallet(); } }, 'Desconectar')),
      w.network !== 'mainnet' ? h('div', { class: 'notice' }, `Tu billetera está en la red ${w.network === 'nile' ? 'Nile (pruebas)' : w.network}. EKOKIIN vive en TRON Mainnet: cambia de red en TronLink para ver tu saldo real.`) : null,
      h('div', { class: 'list-item' }, h('span', { class: 'grow' }, 'Saldo EKOKIIN'), bal),
      h('h3', {}, 'Movimientos recientes'), hist,
      h('a', { class: 'btn small ghost', href: `https://tronscan.org/#/address/${w.address}`, target: '_blank', rel: 'noopener' }, 'Ver todo en TronScan'),
    );
    if (session && session.user.role !== 'guest') api('POST', '/api/web3/link', { address: w.address }).catch(() => {});
    readBalance(w.address).then(b => (bal.textContent = `${b} EKOKIIN`)).catch(e => (bal.textContent = `No disponible (${(e as Error).message})`));
    readTransfers(w.address, w.network === 'nile' ? 'nile' : 'mainnet').then(list => {
      hist.replaceChildren(...(list.length ? list.map((t: any) => h('div', { class: 'list-item' },
        h('span', { class: 'grow' }, t.to === w.address ? `Recibido de ${shortAddr(t.from)}` : `Enviado a ${shortAddr(t.to)}`, h('br'), h('small', {}, new Date(t.at).toLocaleString())),
        h('a', { href: `https://tronscan.org/#/transaction/${t.txid}`, target: '_blank', rel: 'noopener' }, `${t.to === w.address ? '+' : '−'}${t.value}`))) : [h('p', {}, 'Sin movimientos de EKOKIIN.')]));
    }).catch(() => hist.replaceChildren(h('p', {}, 'No se pudo consultar el historial ahora.')));
  };
  const audit = h('section', { class: 'card' },
    h('h3', {}, 'Revisión del contrato'),
    h('p', {}, 'Revisamos el contrato en la red TRON el 14 de octubre de 2026:'),
    h('div', { class: 'list' },
      ...[
        ['Suministro', 'Fijo: 100,000,000 EKOKIIN emitidos al crearlo'],
        ['Crear más tokens', 'No es posible'],
        ['Pausar o congelar cuentas', 'No es posible'],
        ['Comisión por transferencia', 'No cobra'],
        ['Funciones de administrador', 'No tiene'],
        ['Código fuente en TronScan', 'Aún no publicado'],
      ].map(([k, v]) => h('div', { class: 'list-item' }, h('span', { class: 'grow' }, k), h('b', {}, v)))),
    h('p', { style: { fontSize: '13px' } }, 'El contrato solo tiene las funciones estándar de un token TRC-20: consultar saldos, transferir y autorizar transferencias.'));
  body.append(tokenCard, audit, walletCard,
    h('section', { class: 'card' }, h('h3', {}, 'Partidas con valor económico'),
      h('p', {}, 'Desactivadas. Solo se habilitarán cuando existan los permisos de la Secretaría de Gobernación, la verificación de edad e identidad (KYC), la auditoría independiente de contratos y la aprobación del operador. El juego gratuito no las necesita.'),
      h('div', { class: 'row' }, h('a', { class: 'btn small ghost', href: '#/terminos/apuestas' }, 'Lo que conlleva apostar'), h('a', { class: 'btn small ghost', href: '#/perfil' }, 'Verificar mi identidad'))));
  screen('Web3', body);
  renderWallet();
}

// ---------------- verificación de identidad (KYC) ----------------
const KYC_LABEL: Record<string, string> = {
  none: 'Sin verificar', started: 'En proceso', pending: 'En revisión', approved: 'Verificada', retry: 'Requiere corrección', rejected: 'Rechazada', on_hold: 'En revisión adicional',
};

async function kycCard(): Promise<Node> {
  const card = h('section', { class: 'card' }, h('h3', {}, 'Verificación de identidad'));
  if (!session || session.user.role === 'guest') {
    card.append(h('p', {}, 'Para verificar tu identidad necesitas una cuenta registrada. Créala arriba en esta misma pantalla.'));
    return card;
  }
  if (!settings.legal?.adult) {
    card.append(h('p', {}, 'La verificación es solo para mayores de 18 años.'), h('button', { class: 'btn small ghost', onclick: () => legalGate(true) }, 'Cambiar mi declaración de edad'));
    return card;
  }
  let st: any;
  try { st = await api('GET', '/api/kyc/status'); } catch (e) { card.append(h('p', {}, (e as Error).message)); return card; }
  const pill = h('span', { class: 'pill', style: st.status === 'approved' ? { background: 'rgba(60,207,142,.25)', color: 'var(--text)' } : st.status === 'rejected' ? { background: 'rgba(255,107,94,.25)', color: 'var(--text)' } : {} }, KYC_LABEL[st.status] ?? st.status);
  card.append(h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Estado'), pill));
  const text: Record<string, string> = {
    none: 'Comprueba tu identidad y tu edad con una identificación oficial y una selfie. Es necesaria para cualquier función con valor económico cuando se habiliten. Toma unos 3 minutos.',
    started: 'Empezaste la verificación pero no la terminaste. Puedes continuarla.',
    pending: 'Recibimos tu información y está en revisión. Suele tardar unos minutos.',
    on_hold: 'Tu verificación necesita una revisión adicional. Te avisaremos el resultado.',
    retry: 'Hay algo que corregir (por ejemplo, una foto borrosa). Vuelve a intentarlo.',
    approved: 'Tu identidad y tu mayoría de edad están verificadas.',
    rejected: 'Tu verificación fue rechazada. Si crees que es un error, contacta a soporte.',
  };
  card.append(h('p', {}, text[st.status] ?? ''));
  if (!st.enabled) { card.append(h('div', { class: 'notice' }, 'La verificación de identidad aún no está disponible en este servidor.')); return card; }
  const row = h('div', { class: 'row' });
  if (['none', 'started', 'retry'].includes(st.status)) {
    row.append(h('button', { class: 'btn primary grow', onclick: async () => {
      try {
        const r = await api('POST', '/api/kyc/start');
        // en la app de Windows se abre otra ventana; en web, iPhone y Android (APK) se abre la página de verificación
        if (IS_DESKTOP_APP) window.open(r.url, '_blank'); else location.href = r.url;
      } catch (e) { toast((e as Error).message, true); }
    } }, st.status === 'none' ? 'Verificar identidad' : 'Continuar verificación'));
  }
  if (['started', 'pending', 'on_hold', 'retry'].includes(st.status)) {
    row.append(h('button', { class: 'btn ghost grow', onclick: async () => {
      try { await api('POST', '/api/kyc/refresh'); profile(); } catch (e) { toast((e as Error).message, true); }
    } }, 'Actualizar estado'));
  }
  if (row.childNodes.length) card.append(row);
  return card;
}

// ---------------- perfil ----------------
async function profile() {
  const nameIn = h('input', { value: settings.name, maxlength: '16', 'aria-label': 'Nombre en partidas locales' });
  const avatars = h('div', { class: 'avatars' });
  const drawAv = () => avatars.replaceChildren(...AVATAR_COLORS.map((_, i) => h('button', { type: 'button', 'aria-pressed': String(settings.avatar === i), 'aria-label': `Avatar ${i + 1}`, onclick: () => { settings.avatar = i; saveSettings(); drawAv(); } }, avatarEl(settings.name || 'Tú', i))));
  drawAv();
  const local = h('section', { class: 'card' }, h('h3', {}, 'Tu jugador'), h('div', { class: 'field' }, h('label', {}, 'Nombre'), nameIn), h('span', { class: 'lbl' }, 'Avatar'), avatars,
    h('button', { class: 'btn small', onclick: () => { settings.name = nameIn.value.trim().slice(0, 16); saveSettings(); toast('Guardado'); drawAv(); } }, 'Guardar'));
  screen('Perfil', local, h('div', { class: 'row' }, h('div', { class: 'spinner' }), 'Cargando cuenta…'));
  const online = await serverAvailable();
  const sections: Node[] = [local];
  if (!online) { sections.push(h('section', { class: 'card' }, h('h3', {}, 'Cuenta en línea'), h('p', {}, 'Las cuentas, la clasificación mundial, los amigos y la tienda requieren el servidor de EKO RUMMY, que no está disponible en esta copia.'))); return screen('Perfil', ...sections); }

  if (!session || session.user.role === 'guest') {
    const u = h('input', { placeholder: 'Usuario', autocomplete: 'username', maxlength: '20' });
    const p = h('input', { placeholder: 'Contraseña (mínimo 8)', type: 'password', autocomplete: 'current-password' });
    const doAuth = async (kind: 'login' | 'register') => {
      try { const r = await api('POST', `/api/auth/${kind}`, { username: u.value.trim(), password: p.value }); setSession(r); conn?.close(); conn = null; toast(kind === 'login' ? 'Sesión iniciada' : 'Cuenta creada'); profile(); }
      catch (e) { toast((e as Error).message, true); }
    };
    sections.push(h('section', { class: 'card' }, h('h3', {}, 'Cuenta'), h('p', {}, 'Con una cuenta entras a la clasificación mundial, guardas tu historial, agregas amigos y organizas torneos.'),
      u, p, h('div', { class: 'row' }, h('button', { class: 'btn ghost grow', onclick: () => doAuth('login') }, 'Iniciar sesión'), h('button', { class: 'btn primary grow', onclick: () => doAuth('register') }, 'Crear cuenta'))));
    sections.push(await kycCard());
  } else {
    try {
      const me = await api('GET', '/api/me');
      const [hist, friends] = await Promise.all([api('GET', '/api/history'), api('GET', '/api/friends')]);
      const st = me.stats ?? {};
      const fIn = h('input', { placeholder: 'Usuario de tu amigo' });
      sections.push(
        h('section', { class: 'card' }, h('div', { class: 'row' }, avatarEl(me.user.name, settings.avatar), h('h3', { class: 'grow' }, me.user.name), h('span', { class: 'pill' }, `Elo ${me.user.rating}`)),
          h('div', { class: 'menu-row' }, h('div', {}, h('span', { class: 'lbl' }, 'Partidas'), h('div', { class: 'display', style: { fontSize: '26px' } }, String(st.played ?? 0))),
            h('div', {}, h('span', { class: 'lbl' }, 'Victorias'), h('div', { class: 'display', style: { fontSize: '26px' } }, String(st.wins ?? 0))),
            h('div', {}, h('span', { class: 'lbl' }, 'Mejor puntaje'), h('div', { class: 'display', style: { fontSize: '26px' } }, String(st.best ?? 0)))),
          me.user.role === 'admin' ? h('a', { class: 'btn small ghost', href: 'admin.html' }, 'Abrir panel administrativo') : null,
          h('button', { class: 'btn small ghost', onclick: () => { setSession(null); conn?.close(); conn = null; profile(); } }, 'Cerrar sesión')),
        h('section', { class: 'card' }, h('h3', {}, 'Amigos'),
          h('form', { class: 'row', onsubmit: async (e: Event) => { e.preventDefault(); try { await api('POST', '/api/friends', { username: fIn.value.trim() }); toast('Amigo agregado'); profile(); } catch (er) { toast((er as Error).message, true); } } }, h('div', { class: 'grow' }, fIn), h('button', { class: 'btn' }, 'Agregar')),
          h('div', { class: 'list' }, ...(friends.friends.length ? friends.friends.map((f: any) => h('div', { class: 'list-item' }, h('span', { class: 'grow' }, f.username), h('span', { class: 'pill' }, f.online ? 'En línea' : 'Desconectado'),
            f.online ? h('button', { class: 'btn small', onclick: async () => { const c = await ensureConn(); c.send({ t: 'create', size: 2 }); const off = c.on(m => { if (m.t === 'lobby') { off(); api('POST', '/api/friends/invite', { friendId: f.id, code: m.code }).then(() => toast('Invitación enviada')); } }); } }, 'Invitar') : null))
            : [h('p', {}, 'Aún no tienes amigos agregados.')]))),
        h('section', { class: 'card' }, h('h3', {}, 'Historial'), h('div', { class: 'list' }, ...(hist.history.length ? hist.history.map((x: any) => h('div', { class: 'list-item' }, h('span', { class: 'grow' }, new Date(x.ended_at).toLocaleString()), h('span', { class: 'pill' }, x.mode), h('b', {}, x.won ? 'Victoria' : `${x.score} pts`))) : [h('p', {}, 'Juega en línea para construir tu historial.')]))),
      );
      sections.push(await kycCard());
      sections.push(await shopCard(me.user.cosmetics ?? []));
    } catch (e) { sections.push(h('p', {}, (e as Error).message)); }
  }
  try {
    const lb = await api('GET', '/api/leaderboard');
    sections.push(h('section', { class: 'card' }, h('h3', {}, 'Clasificación mundial'),
      h('table', { class: 'scores' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Jugador'), h('th', { class: 'num' }, 'Victorias'), h('th', { class: 'num' }, 'Elo'))),
        h('tbody', {}, ...lb.leaderboard.slice(0, 20).map((r: any, i: number) => h('tr', {}, h('td', {}, String(i + 1)), h('td', {}, r.username), h('td', { class: 'num' }, String(r.wins)), h('td', { class: 'num' }, String(r.rating))))))));
  } catch {}
  screen('Perfil', ...sections);
}

async function shopCard(owned: string[]) {
  const shop = await api('GET', '/api/shop');
  const card = h('section', { class: 'card' }, h('h3', {}, 'Tienda'),
    h('p', {}, 'Solo artículos estéticos. No dan ventajas en el juego, no se canjean y no se convierten en fichas ni saldo.'));
  if (shop.mode === 'disabled' || shop.mode === 'blocked_live') { card.append(h('div', { class: 'notice' }, 'Los pagos aún no están habilitados.')); return card; }
  if (shop.mode === 'test') card.append(h('div', { class: 'notice' }, 'Modo de prueba de Stripe: usa la tarjeta 4242 4242 4242 4242. No se cobra dinero real.'));
  for (const p of shop.products) {
    const has = owned.includes(p.id);
    card.append(h('div', { class: 'list-item' }, h('span', { class: 'grow' }, p.name), h('b', {}, `$${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}`),
      h('button', { class: 'btn small', disabled: has, onclick: async () => { try { const r = await api('POST', '/api/shop/checkout', { product: p.id, requestId: crypto.randomUUID() }); location.href = r.url; } catch (e) { toast((e as Error).message, true); } } }, has ? 'Tuyo' : 'Comprar')));
  }
  return card;
}

// ---------------- configuración ----------------
function config() {
  const server = h('input', { value: settings.serverUrl, placeholder: 'https://juego.ekokiin.com (vacío = este sitio)', 'aria-label': 'Servidor' });
  screen('Configuración',
    h('section', { class: 'card' },
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Tema'), seg<Settings['theme']>([['auto', 'Automático'], ['dark', 'Oscuro'], ['light', 'Claro']], settings.theme, v => { settings.theme = v; saveSettings(); })),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Sonido'), seg<string>([['on', 'Activado'], ['off', 'Silencio']], settings.sound ? 'on' : 'off', v => { settings.sound = v === 'on'; saveSettings(); if (settings.sound) sfx.place(); })),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Pistas para principiantes (contra la IA)'), seg<string>([['on', 'Mostrar'], ['off', 'Ocultar']], settings.hints ? 'on' : 'off', v => { settings.hints = v === 'on'; saveSettings(); })),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Orden del atril'), seg<Settings['sortMode']>([['color', 'Por color'], ['value', 'Por número']], settings.sortMode, v => { settings.sortMode = v; saveSettings(); })),
    ),
    h('section', { class: 'card' }, h('h3', {}, 'Edad y términos'),
      h('p', {}, settings.legal ? `Declaraste ser ${settings.legal.adult ? 'mayor' : 'menor'} de 18 años y aceptaste los términos el ${new Date(settings.legal.at).toLocaleDateString('es-MX')}.` : 'Aún no aceptas los términos.'),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost grow', onclick: () => go('/terminos') }, 'Ver términos'), h('button', { class: 'btn ghost grow', onclick: () => legalGate(true) }, 'Cambiar declaración'))),
    h('section', { class: 'card' }, h('h3', {}, 'Instalar en tu dispositivo'), h('p', {}, 'EKO RUMMY se instala como app en iPhone, Android y Windows, con ícono propio y pantalla completa.'), h('button', { class: 'btn', onclick: installApp }, 'Cómo instalar')),
    h('section', { class: 'card' }, h('h3', {}, 'Reglas'),
      h('p', {}, '106 fichas: números del 1 al 13 en cuatro colores, dos de cada una, y dos comodines. Cada quien recibe 14. Grupos: mismo número, colores distintos (3 o 4). Escaleras: números seguidos del mismo color (3 o más; el 1 solo va abajo). La primera jugada debe sumar 30 puntos con fichas propias. Después puedes reorganizar la mesa si al terminar todo es válido. Si no juegas, robas una. Al terminar, cada ficha restante resta su valor y cada comodín resta 30.'),
      h('button', { class: 'btn ghost', onclick: () => go('/tutorial') }, 'Repetir tutorial')),
    h('section', { class: 'card' }, h('h3', {}, 'Avanzado'), h('div', { class: 'field' }, h('label', {}, 'Servidor de partidas en línea'), server),
      h('button', { class: 'btn small', onclick: () => { settings.serverUrl = server.value.trim(); saveSettings(); conn?.close(); conn = null; toast('Servidor guardado'); } }, 'Guardar servidor')),
    h('p', { class: 'foot' }, `Versión ${VERSION}. Juego gratuito de entretenimiento. Business Shop · EKO K'iin.`),
    h('img', { src: asset('business-shop.webp'), alt: 'Business Shop', style: { width: '140px', margin: '0 auto', background: '#fff', borderRadius: '10px', padding: '6px' } }),
  );
}
type Settings = typeof settings;

// ---------------- arranque ----------------
(async function boot() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('sala')) location.hash = `/sala/${qs.get('sala')}`;
  if (qs.get('demo') === 'victoria' || location.hash === '#victoria') { if (location.hash === '#victoria') history.replaceState(null, '', '#/'); setTimeout(() => victoryBillboard('GANASTE', 5000), 400); }
  if (qs.get('compra') === 'ok') setTimeout(() => toast('¡Gracias por tu compra! Se aplicará en cuanto Stripe la confirme.'), 500);
  if (location.hash === '#/partida') history.replaceState(null, '', '#/');
  if (!legalOk()) legalGate(false);
  route();
  // reanudar una partida en línea en curso (p. ej. tras cerrar la app o perder la red)
  if (session && apiBase() && (await serverAvailable())) {
    try { await ensureConn(); } catch {}
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker?.register('sw.js').catch(() => {});
  }
})();

// referencia para evitar que el empaquetador descarte imágenes y símbolos
void TILES; void JOKER_SVG;
