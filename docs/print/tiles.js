// Dibuja fichas: <span data-t="7c0 8c0 J"> → 7 Jade, 8 Jade, comodín
const G = [
 '<svg viewBox="0 0 24 24"><path d="M20 3c-9 0-15 4-15 11 0 2 .6 3.6 1.5 4.8L4 21.3 5.3 22.7l2.6-2.6C9 21 10.6 21.5 12.3 21.5 18.5 21.5 21 15 20 3Zm-3.4 5.2-8 8-.9-.9 8-8 .9.9Z"/></svg>',
 '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M11 1h2v4h-2zM11 19h2v4h-2zM1 11h4v2H1zM19 11h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8L7 8.4zM15.6 17l1.4-1.4 2.8 2.8-1.4 1.4zM4.2 18.4 7 15.6l1.4 1.4-2.8 2.8zM15.6 7 18.4 4.2l1.4 1.4L17 8.4z"/></svg>',
 '<svg viewBox="0 0 24 24"><path d="M12 2s7 7.6 7 12.6A7 7 0 0 1 5 14.6C5 9.6 12 2 12 2Z"/></svg>',
 '<svg viewBox="0 0 24 24"><path d="M14.5 2.5A9.5 9.5 0 1 0 21.5 17 8 8 0 0 1 14.5 2.5Z"/></svg>'];
const J = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27"/><path d="M37 9 21 36h11l-5 19 17-28H33l4-18z" fill="#f4ecd6"/></svg>';
for (const el of document.querySelectorAll('[data-t]')) {
  el.innerHTML = el.dataset.t.trim().split(/\s+/).map(t => t === 'J' ? `<span class="tile j">${J}</span>` : (() => { const [, v, c] = t.match(/(\d+)c(\d)/); return `<span class="tile c${c}">${v}${G[c]}</span>`; })()).join('');
}
