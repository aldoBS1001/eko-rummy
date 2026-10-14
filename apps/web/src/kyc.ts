// Página de verificación de identidad (kyc.html). Se abre desde el juego con un enlace de un solo uso
// y lanza el WebSDK de Sumsub después de pedir el consentimiento expreso para datos biométricos.
import './styles.css';
import { h, $, applyTheme } from './util.ts';

declare global { interface Window { snsWebSdk?: any } }
applyTheme();

const app = $('#app')!;
const code = new URLSearchParams(location.hash.slice(1)).get('c');
history.replaceState(null, '', location.pathname); // el código no queda en el historial

function shell(...kids: Node[]) {
  app.replaceChildren(h('div', { class: 'screen' },
    h('header', { class: 'screen-head' }, h('h2', {}, 'Verificación de identidad')),
    h('main', { class: 'screen-body' }, ...kids)));
}

function message(title: string, text: string, ok = false) {
  shell(h('section', { class: 'card' }, h('h3', {}, title), h('p', {}, text),
    h('a', { class: `btn ${ok ? 'primary' : ''}`, href: './' }, 'Volver al juego')));
}

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j;
}

function loadScript(src: string) {
  return new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('No se pudo cargar el verificador. Revisa tu conexión.'));
    document.head.append(s);
  });
}

async function start(btn: HTMLButtonElement) {
  btn.disabled = true;
  btn.textContent = 'Preparando…';
  try {
    const { token, refreshKey, sdkUrl, user } = await post('/api/kyc/token', { code });
    await loadScript(sdkUrl);
    const container = h('div', { id: 'sumsub-websdk-container', style: { minHeight: '520px' } });
    shell(h('p', { class: 'foot', style: { textAlign: 'left' } }, `Cuenta: ${user}`), container);
    const sdk = window.snsWebSdk
      .init(token, () => post('/api/kyc/token/refresh', { refreshKey }).then(r => r.token))
      .withConf({ lang: 'es', theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' })
      .withOptions({ addViewportTag: false, adaptIframeHeight: true })
      .on('idCheck.onApplicantSubmitted', () => done())
      .on('idCheck.onApplicantResubmitted', () => done())
      .on('idCheck.onApplicantStatusChanged', (p: any) => { if (p?.reviewStatus === 'completed' || p?.reviewStatus === 'pending') done(); })
      .on('idCheck.onError', (e: any) => console.warn('Sumsub', e))
      .build();
    sdk.launch('#sumsub-websdk-container');
  } catch (e) {
    message('No se pudo iniciar la verificación', (e as Error).message);
  }
}

let finished = false;
function done() {
  if (finished) return;
  finished = true;
  setTimeout(() => message('Recibimos tu información', 'La revisión suele tardar unos minutos. Verás el resultado en tu Perfil dentro del juego.', true), 1500);
}

if (!code) {
  message('Enlace incompleto', 'Abre la verificación desde el juego: Perfil › Verificar identidad.');
} else {
  const chk = h('input', { type: 'checkbox', id: 'consentimiento', style: { width: '22px', height: '22px', minHeight: '0', flex: '0 0 auto', accentColor: '#e8b649' } });
  const btn = h('button', { class: 'btn primary', disabled: true, onclick: () => start(btn) }, 'Comenzar verificación');
  chk.addEventListener('change', () => { btn.disabled = !chk.checked; });
  shell(
    h('section', { class: 'card' },
      h('h3', {}, 'Comprueba tu identidad y tu edad'),
      h('p', {}, 'La necesitamos antes de cualquier función con valor económico. Toma unos 3 minutos:'),
      h('ul', { class: 'terms' },
        h('li', {}, 'Ten a la mano tu INE, pasaporte u otra identificación oficial vigente.'),
        h('li', {}, 'Toma una foto de tu identificación y una selfie en video corta.'),
        h('li', {}, 'Busca buena luz y permite el uso de la cámara cuando el navegador lo pida.')),
      h('p', {}, 'La verificación la realiza Sumsub, nuestro proveedor. EKO RUMMY no guarda tus documentos ni tus fotos; solo recibe si fuiste aprobado.'),
      h('label', { for: 'consentimiento', class: 'row', style: { alignItems: 'flex-start', gap: '10px', flexWrap: 'nowrap', cursor: 'pointer' } }, chk,
        h('span', {}, 'Doy mi consentimiento expreso para que Sumsub trate mis datos de identificación y biométricos (rostro) con el único fin de verificar mi identidad y mi edad, conforme al aviso de privacidad y los términos de EKO RUMMY.')),
      btn,
    ),
  );
}
