// Escena "billboard 3D" anamórfica: una pantalla en esquina de la que salen fichas sólidas.
// Solo CSS 3D (sin librerías), funciona sin internet en el APK y en Windows.
import { h, GLYPHS, JOKER_SVG } from './util.ts';

/** Ficha cúbica con grosor real (6 caras). */
export function tile3d(content: string, cls: string, extra: Record<string, string> = {}) {
  const box = h('div', { class: `t3 ${cls}`, 'aria-hidden': 'true' });
  for (const [k, v] of Object.entries(extra)) box.style.setProperty(k, v);
  box.append(
    h('div', { class: 'f front', html: content }),
    h('div', { class: 'f back' }),
    h('div', { class: 'f side l' }), h('div', { class: 'f side r' }),
    h('div', { class: 'f cap t' }), h('div', { class: 'f cap b' }),
  );
  return box;
}

const letterFace = (ch: string, c: number) => `<span class="n">${ch}</span>${GLYPHS[c]}`;

function screens(label: string) {
  const panel = (side: 'l' | 'r') =>
    h('div', { class: `bb-panel ${side}` },
      h('div', { class: 'bb-screen' },
        h('div', { class: 'bb-grid' }),
        h('div', { class: 'bb-tiles-bg' }),
        h('div', { class: 'bb-brand' }, side === 'l' ? 'EKO' : label),
        h('div', { class: 'bb-scan' })));
  return [panel('l'), panel('r')];
}

/** Escena de la portada. Tócala para repetir la animación. */
export function billboardHero(words: string[] = ['EKO', 'RUMMY']) {
  const stage = h('div', { class: 'bb-stage', role: 'img', 'aria-label': words.join(' ') });
  const build = () => {
    const corner = h('div', { class: 'bb-corner' }, ...screens("K'IIN"));
    const actors = h('div', { class: 'bb-actors' });
    actors.append(
      h('div', { class: 'bb-shadow' }),
      tile3d(JOKER_SVG, 'joker hero', {}),
    );
    const title = h('div', { class: 'bb-title' });
    let i = 0;
    words.forEach((w, wi) => {
      if (wi) title.append(h('span', { class: 'bb-gap' }));
      for (const ch of w) {
        const c = i % 4;
        const sx = `${(i - 4) * 38}px`, sy = `${-40 - (i % 3) * 30}px`;
        title.append(tile3d(letterFace(ch, c), `letter c${c}`, { '--i': String(i), '--sx': sx, '--sy': sy, '--rz': `${(i % 2 ? 1 : -1) * (2 + (i % 3))}deg` }));
        i++;
      }
    });
    actors.append(title);
    corner.append(actors);
    stage.replaceChildren(corner);
  };
  build();
  stage.addEventListener('click', build);
  return stage;
}

/** Celebración de victoria: la esquina aparece sobre la pantalla y el texto sale del marco. */
export function victoryBillboard(text: string, ms = 2600): Promise<void> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const ov = h('div', { class: 'bb-overlay' });
  const stage = h('div', { class: 'bb-stage victory', role: 'img', 'aria-label': text });
  const corner = h('div', { class: 'bb-corner' }, ...screens('GG'));
  const actors = h('div', { class: 'bb-actors' }, h('div', { class: 'bb-shadow' }), tile3d(JOKER_SVG, 'joker hero', {}));
  const title = h('div', { class: 'bb-title' });
  [...text].forEach((ch, i) => {
    if (ch === ' ') return title.append(h('span', { class: 'bb-gap' }));
    title.append(tile3d(letterFace(ch, i % 4), `letter c${i % 4}`, { '--i': String(i), '--sx': `${(i - text.length / 2) * 40}px`, '--sy': '-60px', '--rz': `${(i % 2 ? 1 : -1) * 3}deg` }));
  });
  actors.append(title);
  corner.append(actors);
  stage.append(corner);
  ov.append(stage);
  document.body.append(ov);
  return new Promise(res => {
    const done = () => { ov.classList.add('out'); setTimeout(() => { ov.remove(); res(); }, 350); };
    const t = setTimeout(done, ms);
    ov.addEventListener('click', () => { clearTimeout(t); done(); }, { once: true });
  });
}
