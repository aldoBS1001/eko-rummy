// Panel administrativo de EKO RUMMY. Requiere una cuenta con rol de administrador.
import './styles.css';
import { h, $, toast, applyTheme } from './util.ts';
import { api, session, setSession } from './net.ts';

applyTheme();
const app = $('#app')!;
const fmt = (t: number | null) => (t ? new Date(t).toLocaleString() : '—');
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

function shell(...kids: Node[]) {
  app.replaceChildren(h('div', { class: 'screen' },
    h('header', { class: 'screen-head' }, h('a', { class: 'btn small ghost', href: './' }, 'Ir al juego'), h('h2', {}, 'Panel administrativo'),
      session ? h('button', { class: 'btn small ghost', onclick: () => { setSession(null); login(); } }, 'Salir') : null),
    h('main', { class: 'screen-body', style: { width: 'min(1100px, 100%)' } }, ...kids)));
}

function login(msg?: string) {
  const u = h('input', { placeholder: 'Usuario administrador', autocomplete: 'username' });
  const p = h('input', { placeholder: 'Contraseña', type: 'password', autocomplete: 'current-password' });
  shell(h('form', { class: 'card', onsubmit: async (e: Event) => {
    e.preventDefault();
    try { const r = await api('POST', '/api/auth/login', { username: u.value, password: p.value }); setSession(r); load(); } catch (er) { toast((er as Error).message, true); }
  } }, h('h3', {}, 'Acceso de administradores'), msg ? h('div', { class: 'notice' }, msg) : null, u, p, h('button', { class: 'btn primary' }, 'Entrar')));
}

function stat(label: string, value: string | number) {
  return h('div', { class: 'card', style: { gap: '4px' } }, h('span', { class: 'lbl' }, label), h('div', { class: 'display', style: { fontSize: '28px' } }, String(value)));
}
function table(head: string[], rows: (Node | string)[][]) {
  return h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'scores' },
    h('thead', {}, h('tr', {}, ...head.map(x => h('th', {}, x)))),
    h('tbody', {}, ...(rows.length ? rows.map(r => h('tr', {}, ...r.map(c => h('td', {}, c)))) : [h('tr', {}, h('td', { colspan: String(head.length) }, 'Sin datos'))]))));
}

async function load() {
  if (!session) return login();
  let o: any;
  try { o = await api('GET', '/api/admin/overview'); } catch (e) { return login((e as Error).message); }
  const [users, matches, reports, errors, purchases, tours] = await Promise.all([
    api('GET', '/api/admin/users'), api('GET', '/api/admin/matches'), api('GET', '/api/admin/reports'),
    api('GET', '/api/admin/errors'), api('GET', '/api/admin/purchases'), api('GET', '/api/admin/tournaments'),
  ]);
  const m = o.metrics, live = o.live;
  const grid = (...k: Node[]) => h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' } }, ...k);
  const flagRow = (key: string, label: string, def: string) => {
    const val = o.flags[key] ?? def;
    return h('div', { class: 'list-item' }, h('span', { class: 'grow' }, label), h('b', {}, val === 'true' ? 'Activado' : 'Desactivado'),
      h('button', { class: 'btn small', onclick: async () => { await api('POST', '/api/admin/flags', { key, value: val === 'true' ? 'false' : 'true' }); load(); } }, 'Cambiar'));
  };
  const ann = h('input', { value: o.flags.announcement ?? '', placeholder: 'Aviso para todos los jugadores' });
  shell(
    grid(stat('Usuarios registrados', m.usersRegistered), stat('Conectados ahora', live.usersOnline), stat('Partidas activas', live.roomsActive),
      stat('Partidas terminadas', m.matchesFinished), stat('Activos 24 h', m.activeUsers24h), stat('Retención D1', m.retentionD1 == null ? '—' : `${m.retentionD1}%`),
      stat('Retención D7', m.retentionD7 == null ? '—' : `${m.retentionD7}%`), stat('Reportes abiertos', m.openReports), stat('Ventas', money(m.revenueCents)),
      stat('KYC aprobados', m.kycApproved), stat('KYC en proceso', m.kycPending), stat('Aceptaron términos', m.termsAccepted),
      stat('Errores 24 h', m.errors24h), stat('Memoria', `${o.memoryMB} MB`), stat('En cola', live.queued)),
    h('section', { class: 'card' }, h('h3', {}, 'Estado de integraciones'),
      h('div', { class: 'list' },
        h('div', { class: 'list-item' }, h('span', { class: 'grow' }, 'Stripe'), h('b', {}, { disabled: 'Sin configurar', test: 'Modo de prueba', live: 'Producción', blocked_live: 'Clave live bloqueada (falta aprobación)' }[o.stripe as string] ?? o.stripe)),
        h('div', { class: 'list-item' }, h('span', { class: 'grow' }, 'KYC (Sumsub)'), h('b', {}, o.kyc.enabled ? `Activo · nivel ${o.kyc.level}` : 'Sin configurar (faltan claves)')),
        h('div', { class: 'list-item' }, h('span', { class: 'grow' }, 'TRON'), h('b', {}, `${o.web3.network} · ${o.web3.contract}`)),
        h('div', { class: 'list-item' }, h('span', { class: 'grow' }, 'Registro de auditoría'), h('b', {}, o.audit.ok ? `Íntegro (${o.audit.count} eventos)` : `ALTERADO en evento ${o.audit.brokenAt}`)),
        h('div', { class: 'list-item' }, h('span', { class: 'grow' }, 'Módulo económico'), h('b', {}, o.betting.enabled ? 'Habilitado' : 'Bloqueado')))),
    h('section', { class: 'card' }, h('h3', {}, 'Módulo económico (solo lectura)'),
      h('p', {}, 'No se puede activar desde este panel. Requiere BETTING_ENABLED en el servidor y todas las aprobaciones documentadas.'),
      table(['Requisito', 'Estado', 'Responsable', 'Referencia'], o.betting.approvals.map((a: any) => [a.label, a.ok ? 'Aprobado' : 'Pendiente', a.approver ?? '—', a.reference ?? '—']))),
    h('section', { class: 'card' }, h('h3', {}, 'Controles de funciones'),
      flagRow('maintenance', 'Modo mantenimiento (bloquea partidas nuevas)', 'false'), flagRow('chat_enabled', 'Chat', 'true'),
      flagRow('tournaments_enabled', 'Torneos', 'true'), flagRow('registration_enabled', 'Registro de cuentas', 'true'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, ann), h('button', { class: 'btn small', onclick: async () => { await api('POST', '/api/admin/flags', { key: 'announcement', value: ann.value }); toast('Aviso guardado'); } }, 'Publicar aviso'))),
    h('section', { class: 'card' }, h('h3', {}, 'Partidas activas'),
      table(['Sala', 'Modo', 'Estado', 'Ronda/Turno', 'Jugadores'], matches.active.map((r: any) => [r.code, r.mode, r.status, `${r.round}/${r.turnNumber}`, r.players.map((p: any) => `${p.name}${p.bot ? ' (IA)' : p.connected ? '' : ' (desc.)'}`).join(', ')]))),
    h('section', { class: 'card' }, h('h3', {}, 'Partidas recientes'),
      table(['Inicio', 'Fin', 'Modo', 'Jugadores', 'Puntos'], matches.recent.slice(0, 40).map((r: any) => [fmt(r.started_at), fmt(r.ended_at), r.mode, JSON.parse(r.players).map((p: any) => p.name).join(', '), r.result ? JSON.parse(r.result).scores.join(' / ') : '—']))),
    h('section', { class: 'card' }, h('h3', {}, 'Reportes de fraude y conducta'),
      table(['Fecha', 'Motivo', 'Partida', ''], reports.reports.map((r: any) => [fmt(r.at), r.reason, r.match_id ?? '—',
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: async () => { await api('POST', `/api/admin/reports/${r.id}`, { status: 'resolved' }); load(); } }, 'Resuelto'),
          h('button', { class: 'btn small ghost', onclick: async () => { await api('POST', `/api/admin/reports/${r.id}`, { status: 'dismissed' }); load(); } }, 'Descartar'))]))),
    h('section', { class: 'card' }, h('h3', {}, 'Usuarios'),
      table(['Usuario', 'Rol', 'Elo', 'Alta', 'Mayor de edad', 'KYC', 'Billetera', ''], users.users.map((u: any) => [u.username, u.role, String(u.rating), fmt(u.created_at), u.adult_declared === 1 ? 'Declarado' : u.adult_declared === 0 ? 'Menor' : '—', u.kyc_status ?? 'none', u.wallet ?? '—',
        h('button', { class: `btn small ${u.banned ? '' : 'danger'}`, onclick: async () => { await api('POST', `/api/admin/users/${u.id}/ban`, { banned: !u.banned }); load(); } }, u.banned ? 'Desbloquear' : 'Bloquear')]))),
    h('section', { class: 'card' }, h('h3', {}, 'Transacciones comerciales (Stripe)'),
      table(['Fecha', 'Usuario', 'Producto', 'Monto', 'Estado'], purchases.purchases.map((p: any) => [fmt(p.created_at), p.username ?? p.user_id, p.product, `${money(p.amount)} ${p.currency.toUpperCase()}`, p.status]))),
    h('section', { class: 'card' }, h('h3', {}, 'Torneos'),
      table(['Nombre', 'Estado', 'Inscritos', 'Campeón'], tours.tournaments.map((t: any) => [t.name, t.status, `${t.entrants.length}/${t.size}`, t.champion ?? '—']))),
    h('section', { class: 'card' }, h('h3', {}, 'Historial de errores'),
      table(['Fecha', 'Origen', 'Mensaje'], errors.errors.slice(0, 50).map((e: any) => [fmt(e.at), e.source, h('code', { style: { fontSize: '12px', whiteSpace: 'pre-wrap' } }, e.message.slice(0, 400))]))),
    h('button', { class: 'btn', onclick: load }, 'Actualizar'),
  );
}

load();
setInterval(() => { if (document.visibilityState === 'visible' && session && !document.querySelector('input:focus')) load(); }, 30000);
