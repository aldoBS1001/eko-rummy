// Utilidades del cliente: ajustes persistentes, DOM, fichas, sonidos.
import { tile } from '../../../packages/engine/src/index.ts';

// ---------- ajustes (localStorage puede no existir o fallar: privado, iframe, etc.) ----------
export interface Settings {
  theme: 'auto' | 'dark' | 'light';
  sound: boolean;
  hints: boolean;
  sortMode: 'color' | 'value';
  turnSeconds: number;
  avatar: number;
  name: string;
  serverUrl: string;
  tutorialDone: boolean;
  legal: { version: string; adult: boolean; at: number } | null;
}
const DEFAULTS: Settings = { theme: 'auto', sound: true, hints: true, sortMode: 'color', turnSeconds: 0, avatar: 0, name: '', serverUrl: '', tutorialDone: false, legal: null };
const mem: Record<string, string> = {};
export function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } }
export function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { mem[k] = v; } }
export function lsDel(k: string) { try { localStorage.removeItem(k); } catch { delete mem[k]; } }

export const settings: Settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(lsGet('eko.settings') ?? '{}') }; } catch { return { ...DEFAULTS }; }
})();
export function saveSettings() { lsSet('eko.settings', JSON.stringify(settings)); applyTheme(); }
export function applyTheme() {
  const r = document.documentElement;
  if (settings.theme === 'auto') delete r.dataset.theme; else r.dataset.theme = settings.theme;
}

// ---------- DOM ----------
type Attrs = Record<string, any>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // solo para SVG/markup propio, nunca contenido del usuario
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement | null;

// ---------- glifos ----------
export const GLYPHS = [
  // Jade: hoja
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 3c-9 0-15 4-15 11 0 2 .6 3.6 1.5 4.8L4 21.3 5.3 22.7l2.6-2.6C9 21 10.6 21.5 12.3 21.5 18.5 21.5 21 15 20 3Zm-3.4 5.2-8 8-.9-.9 8-8 .9.9Z"/></svg>',
  // Sol: sol (K\'iin)
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M11 1h2v4h-2zM11 19h2v4h-2zM1 11h4v2H1zM19 11h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8L7 8.4zM15.6 17l1.4-1.4 2.8 2.8-1.4 1.4zM4.2 18.4 7 15.6l1.4 1.4-2.8 2.8zM15.6 7 18.4 4.2l1.4 1.4L17 8.4z"/></svg>',
  // Coral: gota
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2s7 7.6 7 12.6A7 7 0 0 1 5 14.6C5 9.6 12 2 12 2Z"/></svg>',
  // Noche: luna
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 2.5A9.5 9.5 0 1 0 21.5 17 8 8 0 0 1 14.5 2.5Z"/></svg>',
];
export const JOKER_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27"/><path d="M37 9 21 36h11l-5 19 17-28H33l4-18z" fill="#f4ecd6"/></svg>';
export const COLOR_LABELS = ['Jade', 'Sol', 'Coral', 'Noche'];

export function tileLabel(id: number) {
  const t = tile(id);
  return t.joker ? 'Comodín' : `${t.value} ${COLOR_LABELS[t.color!]}`;
}

export function tileEl(id: number, extra = ''): HTMLButtonElement {
  const t = tile(id);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `tile ${t.joker ? 'joker' : 'c' + t.color} ${extra}`;
  b.dataset.id = String(id);
  b.setAttribute('aria-label', tileLabel(id));
  b.innerHTML = t.joker ? JOKER_SVG : `<span class="n">${t.value}</span>${GLYPHS[t.color!]}`;
  return b;
}

export function toast(text: string, bad = false) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3100);
}

export const AVATAR_COLORS = ['#f4ecd6', '#e8b649', '#7fe0b8', '#f2a07b', '#a9b8ff', '#e9a4d6', '#b7e36b', '#8fd3e8'];
export function avatarEl(name: string, idx: number) {
  return h('div', { class: 'avatar', style: { background: AVATAR_COLORS[idx % AVATAR_COLORS.length] }, 'aria-hidden': 'true' }, (name || '?').trim().charAt(0).toUpperCase());
}

export const ICONS = {
  back: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12.5 8c-2.6 0-5 1-6.9 2.6L2 7v9h9l-3.6-3.6A7.9 7.9 0 0 1 20.1 16l2.4-.8A10.5 10.5 0 0 0 12.5 8z"/></svg>',
  sort: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></svg>',
  bulb: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16v12H6l-2 2V4z"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm18.4 1.4L20 9l-2.5 2.6L15 9l-1.4 1.4 2.5 2.6-2.5 2.6L15 17l2.5-2.6L20 17l1.4-1.4-2.6-2.6z"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4L10.7 6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.3 2.7h4l.3-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>',
};

// ---------- sonidos (sintetizados con Web Audio, sin archivos) ----------
let ctx: AudioContext | null = null;
function ac() {
  if (!settings.sound) return null;
  try { ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; } catch { return null; }
}
function noiseClick(gain = 0.35, freq = 2400) {
  const c = ac(); if (!c) return;
  const len = Math.floor(c.sampleRate * 0.045);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.4;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination); src.start();
}
function tone(freqs: number[], dur = 0.12, type: OscillatorType = 'sine', gain = 0.12) {
  const c = ac(); if (!c) return;
  freqs.forEach((fr, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = fr;
    const t0 = c.currentTime + i * dur * 0.8;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 1.6);
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur * 1.8);
  });
}
export const sfx = {
  pick: () => noiseClick(0.25, 3200),
  place: () => noiseClick(0.45, 1800),
  draw: () => { noiseClick(0.3, 1400); setTimeout(() => noiseClick(0.2, 1200), 60); },
  invalid: () => tone([220, 180], 0.1, 'triangle', 0.1),
  turn: () => tone([660, 880], 0.09, 'sine', 0.09),
  win: () => tone([523, 659, 784, 1046], 0.13, 'triangle', 0.12),
  lose: () => tone([392, 330, 262], 0.16, 'sine', 0.1),
  tick: () => tone([1200], 0.03, 'square', 0.03),
};

// ---------- celebración: lluvia de fichas (canvas, se retira sola) ----------
export function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  document.body.append(c);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const colors = ['#0d7a6a', '#b06a00', '#c8372d', '#2c3a94'];
  const parts = Array.from({ length: 70 }, () => ({
    x: Math.random() * innerWidth, y: -40 - Math.random() * innerHeight * .6, vy: 2 + Math.random() * 3.5, vx: (Math.random() - .5) * 1.6,
    r: Math.random() * Math.PI, vr: (Math.random() - .5) * .12, s: 16 + Math.random() * 14, n: 1 + Math.floor(Math.random() * 13), c: colors[Math.floor(Math.random() * 4)], flip: Math.random() * Math.PI,
  }));
  const t0 = performance.now();
  const frame = (t: number) => {
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr; p.flip += .08;
      const w = p.s, hgt = p.s * 1.38, sx = Math.cos(p.flip);
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(sx, 1);
      g.fillStyle = '#b29d6c'; g.fillRect(-w / 2, -hgt / 2 + 3, w, hgt);
      g.fillStyle = Math.abs(sx) > .15 ? '#f7efda' : '#d6c69c'; g.fillRect(-w / 2, -hgt / 2, w, hgt);
      if (Math.abs(sx) > .3) { g.fillStyle = p.c; g.font = `800 ${w * .6}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(p.n), 0, 1); }
      g.restore();
    }
    if (t - t0 < 4200) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}
