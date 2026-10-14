// Pantalla de partida: mesa, atril, arrastrar y soltar (táctil y mouse), selección por toque,
// validación en vivo, deshacer, ordenar, sugerencias, temporizador, chat y emoticones.

import { analyzeSet, validatePlay, sortRack, hint, tile, type PlayerView, type GameState } from '../../../packages/engine/src/index.ts';
import type { Controller } from './controllers.ts';
import { h, tileEl, avatarEl, toast, sfx, settings, saveSettings, ICONS, tileLabel } from './util.ts';

type Target = { kind: 'set'; index: number } | { kind: 'new' } | { kind: 'rack'; before?: number };
interface Snapshot { table: number[][]; rack: number[]; placed: number[] }

const EMOTES = ['👍', '👏', '😄', '😮', '🤔', '🔥', '🐸', '⚡', 'GG', '¡Bien jugado!'];

export class Board {
  ctrl: Controller;
  root: HTMLElement;
  table: number[][] = [];
  rack: number[] = [];
  placed = new Set<number>();
  selected = new Set<number>();
  hintIds = new Set<number>();
  private hintTable: number[][] | null = null;
  private undoStack: Snapshot[] = [];
  private turnKey = '';
  private rackOrder: number[] = [];
  private busy = false;
  private timerEl: HTMLElement | null = null;
  private timerInt: ReturnType<typeof setInterval>;
  private lastTick = -1;
  private drag: { ids: number[]; ghost: HTMLElement; target: Target | null; targetEl: HTMLElement | null } | null = null;
  private recentlyPlaced = new Set<number>();
  private drawnIds = new Set<number>();
  private dealRound = -1;
  private dealing = false;
  onExit: (() => void) | null = null;
  coach: ((b: Board) => void) | null = null;

  constructor(ctrl: Controller, root: HTMLElement) {
    this.ctrl = ctrl;
    this.root = root;
    ctrl.onChange = () => { this.sync(); this.render(); };
    const prevEvent = ctrl.onEvent;
    ctrl.onEvent = e => {
      prevEvent?.(e);
      if (e.type === 'play') { sfx.place(); }
      else if (e.type === 'drawn' && e.drawn?.length) { sfx.draw(); e.drawn.forEach(id => this.drawnIds.add(id)); }
      else if (e.type === 'timeout' && e.seat === this.view?.seat) toast('Se acabó tu tiempo: robaste una ficha', true);
      else if (e.type === 'emote' && e.seat != null) this.bubble(e.seat, e.emote!);
      else if (e.type === 'chat') this.renderChat();
      else if (e.type === 'error' && e.message) toast(e.message, true);
    };
    this.timerInt = setInterval(() => this.updateTimer(), 250);
    this.sync();
    this.render();
  }

  get view(): PlayerView | null { return this.ctrl.view; }
  get myTurn() { const v = this.view; return !!v && v.status === 'playing' && v.turn === v.seat; }

  destroy() { clearInterval(this.timerInt); this.ctrl.onChange = null; }

  // ---------- sincronización con el estado autoritativo ----------
  private sync() {
    const v = this.view;
    if (!v) return;
    if (v.round !== this.dealRound && v.status === 'playing') { this.dealRound = v.round; this.dealing = true; }
    const key = `${v.round}:${v.turnNumber}:${v.turn === v.seat}`;
    if (key !== this.turnKey) {
      const wasMyTurn = this.turnKey.endsWith('true');
      this.turnKey = key;
      this.table = v.table.map(s => [...s]);
      this.placed.clear();
      this.selected.clear();
      this.undoStack = [];
      this.hintIds.clear(); this.hintTable = null;
      if (this.myTurn && !wasMyTurn) sfx.turn();
    } else if (!this.myTurn) {
      this.table = v.table.map(s => [...s]);
    }
    // el atril conserva el orden que el jugador eligió; las fichas nuevas van al final
    const inRack = new Set(v.rack);
    this.rackOrder = this.rackOrder.filter(id => inRack.has(id));
    for (const id of v.rack) if (!this.rackOrder.includes(id)) this.rackOrder.push(id);
    this.rack = this.rackOrder.filter(id => !this.placed.has(id));
  }

  private snapshot(): Snapshot { return { table: this.table.map(s => [...s]), rack: [...this.rack], placed: [...this.placed] }; }
  private restore(s: Snapshot) { this.table = s.table; this.rack = s.rack; this.placed = new Set(s.placed); }

  private baseIds() { return new Set(this.view?.table.flat() ?? []); }

  /** ¿Se puede tomar esta ficha? */
  private movable(id: number): boolean {
    if (this.rack.includes(id)) return true;
    if (!this.myTurn) return false;
    if (this.placed.has(id)) return true;
    return !!this.view?.opened; // fichas de la mesa: solo tras abrir
  }

  // ---------- movimientos ----------
  moveTo(ids: number[], target: Target) {
    const v = this.view;
    if (!v) return;
    if (target.kind === 'rack') {
      // reordenar el atril o devolver fichas colocadas en este turno
      const base = this.baseIds();
      const back = ids.filter(id => !base.has(id));
      if (back.length < ids.length) toast('Las fichas que ya estaban en la mesa no pueden volver al atril', true);
      if (!back.length) return;
      this.pushUndo();
      this.removeFromTable(back);
      back.forEach(id => this.placed.delete(id));
      let order = this.rackOrder.filter(id => !back.includes(id));
      const at = target.before != null ? order.indexOf(target.before) : -1;
      order = at >= 0 ? [...order.slice(0, at), ...back, ...order.slice(at)] : [...order, ...back];
      this.rackOrder = order;
      this.rack = order.filter(id => !this.placed.has(id));
      this.selected.clear();
      sfx.pick();
      return this.render();
    }
    if (!this.myTurn) { toast('Espera tu turno para jugar en la mesa'); return; }
    if (!v.opened && target.kind === 'set') {
      const s = this.table[target.index];
      if (s?.some(id => this.baseIds().has(id))) { sfx.invalid(); toast(`Antes de abrir (${v.config.openingThreshold} puntos) solo puedes crear combinaciones nuevas`, true); return; }
    }
    const movable = ids.filter(id => this.movable(id));
    if (!movable.length) { if (!v.opened) toast('Primero abre con tus propias fichas', true); return; }
    this.pushUndo();
    const targetSet = target.kind === 'set' ? this.table[target.index] : null;
    this.removeFromTable(movable, targetSet);
    for (const id of movable) if (this.rack.includes(id)) { this.rack = this.rack.filter(x => x !== id); this.placed.add(id); }
    if (target.kind === 'new') this.table.push(this.arrange(movable));
    else {
      const idx = this.table.indexOf(targetSet!);
      this.table[idx] = this.arrange([...targetSet!.filter(id => !movable.includes(id)), ...movable]);
    }
    this.table = this.table.filter(s => s.length);
    movable.forEach(id => this.recentlyPlaced.add(id));
    this.selected.clear();
    this.hintIds.clear();
    sfx.place();
    this.render();
  }

  private removeFromTable(ids: number[], keep: number[] | null = null) {
    this.table = this.table.map(s => (s === keep ? s : s.filter(id => !ids.includes(id))));
  }

  private arrange(ids: number[]) {
    const a = analyzeSet(ids);
    if (a.valid) return a.ordered!;
    return [...ids].sort((x, y) => (tile(x).joker ? 99 : tile(x).value) - (tile(y).joker ? 99 : tile(y).value) || x - y);
  }

  private pushUndo() { this.undoStack.push(this.snapshot()); if (this.undoStack.length > 100) this.undoStack.shift(); }

  undo() { const s = this.undoStack.pop(); if (s) { this.restore(s); this.selected.clear(); this.render(); } }
  resetTurn() {
    if (!this.view) return;
    if (this.undoStack.length) this.restore(this.undoStack[0]);
    this.undoStack = [];
    this.selected.clear();
    this.render();
  }
  sort() {
    settings.sortMode = settings.sortMode === 'color' ? 'value' : 'color';
    saveSettings();
    this.rackOrder = sortRack(this.rackOrder, settings.sortMode);
    this.rack = this.rackOrder.filter(id => !this.placed.has(id));
    toast(settings.sortMode === 'color' ? 'Ordenado por color' : 'Ordenado por número');
    this.render();
  }

  showHint() {
    const v = this.view;
    if (!v || !this.myTurn) return;
    if (this.hintTable && this.hintIds.size) {
      // segunda pulsación: aplicar la sugerencia
      this.pushUndo();
      const base = this.baseIds();
      this.table = this.hintTable.map(s => [...s]);
      const now = new Set(this.table.flat());
      this.rack.filter(id => now.has(id)).forEach(id => this.placed.add(id));
      this.rack = this.rack.filter(id => !now.has(id));
      for (const id of now) if (!base.has(id)) this.recentlyPlaced.add(id);
      this.hintIds.clear(); this.hintTable = null;
      sfx.place();
      return this.render();
    }
    this.resetTurn();
    const hv = { ...v, rack: this.rackOrder, table: v.table };
    const r = hint(hv);
    if (!r.tiles.length) { toast('No veo jugada: roba una ficha'); return; }
    this.hintIds = new Set(r.tiles);
    this.hintTable = r.table ?? null;
    toast(`Puedes colocar ${r.tiles.length} ficha${r.tiles.length > 1 ? 's' : ''}. Toca la bombilla otra vez para colocarlas.`);
    this.render();
  }

  /** Validación local idéntica a la del servidor (el servidor vuelve a validar). */
  check(): { ok: boolean; message: string; opening?: number } {
    const v = this.view!;
    const fake = {
      status: 'playing', turn: v.seat, table: v.table, config: v.config,
      players: v.players.map((_, i) => ({ rack: i === v.seat ? this.rackOrder : [], opened: i === v.seat ? v.opened : true })),
    } as unknown as GameState;
    const bad = this.table.find(s => !analyzeSet(s).valid);
    let opening: number | undefined;
    if (!v.opened) {
      const base = this.baseIds();
      opening = this.table.filter(s => !s.some(id => base.has(id)) && analyzeSet(s).valid).reduce((a, s) => a + analyzeSet(s).points, 0);
    }
    if (bad) return { ok: false, message: analyzeSet(bad).reason ?? 'Combinación inválida', opening };
    const r = validatePlay(fake, v.seat, this.table);
    return r.ok ? { ok: true, message: '', opening } : { ok: false, message: r.message, opening };
  }

  async endTurn() {
    if (!this.myTurn || this.busy) return;
    this.busy = true;
    try {
      if (!this.placed.size) {
        const r = await this.ctrl.draw();
        if (!r.ok && r.message) toast(r.message, true);
        return;
      }
      const c = this.check();
      if (!c.ok) { sfx.invalid(); toast(c.message, true); return; }
      const r = await this.ctrl.play(this.table.map(s => [...s]));
      if (!r.ok) {
        // el servidor rechazó: restaurar el estado del inicio del turno
        sfx.invalid();
        toast(r.message ?? 'Jugada rechazada', true);
        this.resetTurn();
      } else sfx.place();
    } finally { this.busy = false; this.render(); }
  }

  // ---------- render ----------
  render() {
    const v = this.view;
    this.root.replaceChildren();
    if (!v) { this.root.append(h('div', { class: 'game' }, h('div', { class: 'table-empty' }, 'Cargando partida…'))); return; }
    const game = h('div', { class: 'game' });
    game.append(this.renderTop(v), this.renderTable(v), this.renderBottom(v), this.renderSide());
    this.root.append(game);
    this.timerEl = game.querySelector('.timer');
    this.updateTimer();
    this.recentlyPlaced.clear();
    this.drawnIds.clear();
    this.dealing = false;
    this.coach?.(this);
  }

  private renderTop(v: PlayerView) {
    const opps = h('div', { class: 'opps', role: 'list', 'aria-label': 'Jugadores' });
    const n = v.players.length;
    for (let k = 0; k < n; k++) {
      const i = (v.seat + k) % n;
      const p = v.players[i];
      const pres = this.ctrl.presence[i];
      const off = pres && !pres.connected;
      const chip = h('div', { class: `opp${v.turn === i && v.status === 'playing' ? ' turn' : ''}${p.team != null ? ' team' + p.team : ''}`, role: 'listitem', 'data-seat': i },
        avatarEl(p.name, this.ctrl.avatars[i] ?? i),
        h('div', { class: 'meta' },
          h('b', {}, i === v.seat ? 'Tú' : p.name),
          h('span', {}, `${p.rackCount} fichas${p.opened ? ' · abrió' : ''}`),
          off ? h('span', { class: 'off' }, 'desconectado') : null,
        ));
      opps.append(chip);
    }
    return h('div', { class: 'g-top' },
      h('button', { class: 'icon-btn', 'aria-label': 'Salir de la partida', html: ICONS.back, onclick: () => this.confirmExit() }),
      opps,
      h('div', { class: 'pool', title: 'Fichas en el pozo', 'aria-label': `${v.poolCount} fichas en el pozo` }, h('div', { class: 'tile back' }), String(v.poolCount)),
      h('div', { class: 'timer', 'aria-live': 'off' }, h('span', {}, '')),
      h('button', { class: 'icon-btn', 'aria-label': settings.sound ? 'Silenciar' : 'Activar sonido', html: settings.sound ? ICONS.sound : ICONS.mute, onclick: () => { settings.sound = !settings.sound; saveSettings(); this.render(); } }),
    );
  }

  private renderTable(v: PlayerView) {
    const wrap = h('div', { class: 'table', 'aria-label': 'Mesa' });
    const base = this.baseIds();
    if (!this.table.length && !this.myTurn) wrap.append(h('div', { class: 'table-empty' }, 'La mesa está vacía. La primera jugada de cada quien debe sumar al menos 30 puntos.'));
    this.table.forEach((set, i) => {
      const a = analyzeSet(set);
      const isNew = set.some(id => !base.has(id));
      const locked = !v.opened && set.some(id => base.has(id));
      const el = h('div', { class: `set${!a.valid ? ' invalid' : isNew && this.myTurn ? ' valid-new' : ''}${locked && this.myTurn ? ' locked' : ''}`, 'data-set': i, role: 'group', 'aria-label': `Combinación ${i + 1}${a.valid ? '' : ', inválida'}` });
      for (const id of set) el.append(this.tileFor(id, 'table'));
      if (this.selected.size && this.myTurn && !locked) {
        el.append(h('button', { class: 'newset', style: { minWidth: '44px', minHeight: 'auto', padding: '0 8px' }, 'aria-label': 'Agregar fichas seleccionadas aquí', onclick: (e: Event) => { e.stopPropagation(); this.moveTo([...this.selected], { kind: 'set', index: i }); } }, '+'));
      }
      el.addEventListener('click', e => { if (e.target === el && this.selected.size) this.moveTo([...this.selected], { kind: 'set', index: i }); });
      wrap.append(el);
    });
    if (this.myTurn) {
      wrap.append(h('button', { class: 'newset', 'data-new': '1', onclick: () => { if (this.selected.size) this.moveTo([...this.selected], { kind: 'new' }); else toast('Selecciona fichas del atril y toca aquí, o arrástralas'); } },
        this.selected.size ? 'Crear combinación aquí' : 'Arrastra aquí para una combinación nueva'));
    }
    return wrap;
  }

  private renderBottom(v: PlayerView) {
    const status = h('div', { class: 'status', 'aria-live': 'polite' });
    const msg = h('span', { class: 'msg' });
    let canEnd = false;
    if (v.status !== 'playing') msg.textContent = 'Ronda terminada';
    else if (!this.myTurn) msg.textContent = `Turno de ${v.players[v.turn].name}…`;
    else if (!this.placed.size) {
      msg.textContent = v.opened ? 'Tu turno: coloca fichas, reorganiza la mesa o roba.' : `Tu turno: abre con combinaciones propias de ${v.config.openingThreshold}+ puntos o roba.`;
      canEnd = true;
    } else {
      const c = this.check();
      canEnd = c.ok;
      if (c.opening != null) status.append(h('span', { class: 'pill' }, `Apertura ${c.opening}/${v.config.openingThreshold}`));
      msg.className = `msg ${c.ok ? 'good' : 'bad'}`;
      msg.textContent = c.ok ? 'Jugada válida. Termina tu turno.' : c.message;
    }
    status.prepend(msg);

    const rack = h('div', { class: 'rack', 'aria-label': 'Tu atril', role: 'group' });
    this.rack.forEach((id, i) => {
      const t = this.tileFor(id, 'rack');
      if (this.dealing) { t.style.setProperty('--i', String(i)); t.style.setProperty('--dx', `${(i % 7 - 3) * 12}px`); }
      rack.append(t);
    });
    rack.addEventListener('click', e => {
      if (e.target !== rack) return;
      const back = [...this.selected].filter(id => this.placed.has(id));
      if (back.length) this.moveTo(back, { kind: 'rack' });
    });

    const primaryLabel = !this.myTurn ? 'Esperando…' : this.placed.size ? 'Terminar turno' : v.poolCount ? 'Robar ficha' : 'Pasar';
    const actions = h('div', { class: 'actions' },
      h('button', { class: 'btn ghost small', disabled: !this.undoStack.length || !this.myTurn, onclick: () => this.undo(), 'aria-label': 'Deshacer' }, h('span', { html: ICONS.undo, style: { display: 'grid', width: '20px' } }), h('span', { class: 'icon-label' }, 'Deshacer')),
      h('button', { class: 'btn ghost small', onclick: () => this.sort(), 'aria-label': 'Ordenar atril' }, h('span', { html: ICONS.sort, style: { display: 'grid', width: '20px' } }), h('span', { class: 'icon-label' }, 'Ordenar')),
      settings.hints && this.ctrl.kind !== 'online'
        ? h('button', { class: 'btn ghost small', disabled: !this.myTurn, onclick: () => this.showHint(), 'aria-label': 'Sugerencia' }, h('span', { html: ICONS.bulb, style: { display: 'grid', width: '20px' } }), h('span', { class: 'icon-label' }, 'Pista'))
        : h('button', { class: 'btn ghost small', disabled: !this.undoStack.length || !this.myTurn, onclick: () => this.resetTurn(), 'aria-label': 'Reiniciar turno' }, h('span', { html: ICONS.reset, style: { display: 'grid', width: '20px' } }), h('span', { class: 'icon-label' }, 'Reiniciar')),
      h('button', { class: 'btn primary', disabled: !this.myTurn || this.busy || (this.placed.size > 0 && !canEnd), onclick: () => this.endTurn() }, primaryLabel),
    );
    return h('div', { class: 'g-bottom' }, status, rack, actions);
  }

  private renderSide() {
    const side = h('aside', { class: 'side', 'aria-label': 'Chat' });
    if (this.ctrl.kind !== 'online') {
      const v = this.view!;
      side.append(h('div', { class: 'chatlog' },
        h('b', {}, `Ronda ${v.round} de ${v.config.rounds}`),
        ...v.players.map((p, i) => h('div', {}, `${i === v.seat ? 'Tú' : p.name}: ${v.scores[i]} pts`)),
        h('p', { style: { color: 'rgba(255,255,255,.65)', fontSize: '13px' } }, 'Arrastra fichas a la mesa o tócalas para seleccionarlas. Las combinaciones en rojo aún no son válidas.'),
      ));
      return side;
    }
    side.append(h('div', { class: 'chatlog', id: 'chatlog', 'aria-live': 'polite' }));
    const input = h('input', { placeholder: 'Escribe un mensaje', maxlength: '200', 'aria-label': 'Mensaje de chat' });
    side.append(
      h('form', { class: 'chat-form', onsubmit: (e: Event) => { e.preventDefault(); const t = input.value.trim(); if (t) { this.ctrl.sendChat?.(t); input.value = ''; } } }, input, h('button', { class: 'btn small', type: 'submit' }, 'Enviar')),
      h('div', { class: 'emotes' }, ...EMOTES.map(e => h('button', { type: 'button', onclick: () => this.ctrl.sendEmote?.(e) }, e))),
    );
    queueMicrotask(() => this.renderChat());
    return side;
  }

  renderChat() {
    const log = this.root.querySelector('#chatlog');
    if (!log) return;
    log.replaceChildren(...this.ctrl.chat.slice(-60).map(c => h('div', { class: c.system ? 'sys' : '' }, h('b', {}, `${c.name}: `), c.text)));
    log.scrollTop = log.scrollHeight;
  }

  openChatSheet() {
    const list = h('div', { class: 'chatlog', style: { maxHeight: '40vh' } }, ...this.ctrl.chat.slice(-40).map(c => h('div', {}, h('b', {}, `${c.name}: `), c.text)));
    const input = h('input', { placeholder: 'Escribe un mensaje', maxlength: '200' });
    const ov = h('div', { class: 'overlay', onclick: (e: Event) => { if (e.target === ov) ov.remove(); } },
      h('div', { class: 'modal' }, h('h2', {}, 'Chat'), list,
        h('form', { class: 'row', onsubmit: (e: Event) => { e.preventDefault(); if (input.value.trim()) { this.ctrl.sendChat?.(input.value.trim()); ov.remove(); } } }, h('div', { class: 'grow' }, input), h('button', { class: 'btn' }, 'Enviar')),
        h('div', { class: 'row' }, ...EMOTES.map(e => h('button', { class: 'btn small ghost', onclick: () => { this.ctrl.sendEmote?.(e); ov.remove(); } }, e))),
      ));
    document.body.append(ov);
  }

  private bubble(seat: number, text: string) {
    const chip = this.root.querySelector(`[data-seat="${seat}"]`) as HTMLElement | null;
    const r = chip?.getBoundingClientRect();
    const b = h('div', { class: 'bubble' }, text);
    b.style.left = `${Math.max(8, (r?.left ?? 20))}px`;
    b.style.top = `${(r?.bottom ?? 60) + 6}px`;
    document.body.append(b);
    setTimeout(() => b.remove(), 2300);
  }

  private updateTimer() {
    const el = this.timerEl;
    if (!el) return;
    const d = this.ctrl.deadline;
    const v = this.view;
    if (!d || !v || v.status !== 'playing') { el.style.visibility = 'hidden'; return; }
    el.style.visibility = 'visible';
    const total = (v.config.turnSeconds || 60) * 1000;
    const left = Math.max(0, d - Date.now());
    const secs = Math.ceil(left / 1000);
    el.style.setProperty('--p', String(Math.min(1, left / total)));
    el.classList.toggle('low', secs <= 10);
    (el.firstChild as HTMLElement).textContent = String(secs);
    if (this.myTurn && secs <= 5 && secs !== this.lastTick && secs > 0) { this.lastTick = secs; sfx.tick(); }
  }

  private confirmExit() {
    const ov = h('div', { class: 'overlay' },
      h('div', { class: 'modal' },
        h('h2', {}, '¿Salir de la partida?'),
        h('p', {}, this.ctrl.kind === 'online' ? 'Si sales, la IA ocupará tu lugar y la partida seguirá sin ti.' : 'Se perderá el progreso de esta partida.'),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost grow', onclick: () => ov.remove() }, 'Seguir jugando'), h('button', { class: 'btn danger grow', onclick: () => { ov.remove(); this.onExit?.(); } }, 'Salir')),
        this.ctrl.kind === 'online' ? h('button', { class: 'btn ghost', onclick: () => { ov.remove(); this.openChatSheet(); } }, 'Abrir chat') : null,
      ));
    document.body.append(ov);
  }

  // ---------- fichas e interacción ----------
  private tileFor(id: number, where: 'rack' | 'table') {
    const cls = [
      this.selected.has(id) ? 'sel' : '',
      this.placed.has(id) && where === 'table' ? 'new' : '',
      this.hintIds.has(id) ? 'hint' : '',
      this.recentlyPlaced.has(id) ? 'pop' : '',
      this.drawnIds.has(id) && where === 'rack' ? 'flip' : '',
      this.dealing && where === 'rack' ? 'deal' : '',
      where === 'table' && !this.movable(id) ? 'locked' : '',
    ].join(' ');
    const el = tileEl(id, cls);
    el.setAttribute('aria-pressed', String(this.selected.has(id)));
    el.addEventListener('pointerdown', e => this.onPointerDown(e, id, where));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(id, where); } });
    el.addEventListener('click', e => { if ((e as PointerEvent).detail === 0) this.toggle(id, where); }); // activación por teclado
    return el;
  }

  private toggle(id: number, where: 'rack' | 'table') {
    if (where === 'table' && !this.movable(id)) {
      if (this.selected.size && this.myTurn) {
        const idx = this.table.findIndex(s => s.includes(id));
        if (idx >= 0) return this.moveTo([...this.selected], { kind: 'set', index: idx });
      }
      if (this.myTurn && !this.view?.opened) toast('Podrás mover fichas de la mesa después de abrir', false);
      return;
    }
    if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id);
    sfx.pick();
    this.render();
  }

  private onPointerDown(e: PointerEvent, id: number, where: 'rack' | 'table') {
    if (e.button > 0) return;
    const el = e.currentTarget as HTMLElement;
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7) return;
        if (where === 'table' && !this.movable(id)) return;
        started = true;
        const ids = this.selected.has(id) ? [...this.selected] : [id];
        this.startDrag(ids, ev);
      }
      if (this.drag) this.moveDrag(ev);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try { el.releasePointerCapture(e.pointerId); } catch {}
      if (started && this.drag) this.endDrag(ev);
      else if (!started && ev.type === 'pointerup') this.toggle(id, where);
    };
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  private startDrag(ids: number[], ev: PointerEvent) {
    const ghost = h('div', { style: { position: 'fixed', zIndex: '1000', pointerEvents: 'none', display: 'flex', gap: '2px', left: '0', top: '0' } });
    ids.forEach(id => { const t = tileEl(id, 'ghost'); t.style.position = 'static'; ghost.append(t); });
    document.body.append(ghost);
    ids.forEach(id => this.root.querySelectorAll(`[data-id="${id}"]`).forEach(n => n.classList.add('drag-src')));
    this.drag = { ids, ghost, target: null, targetEl: null };
    sfx.pick();
    this.moveDrag(ev);
  }

  private moveDrag(ev: PointerEvent) {
    const d = this.drag!;
    d.ghost.style.transform = `translate(${ev.clientX - 24}px, ${ev.clientY - 40}px)`;
    const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    d.targetEl?.classList.remove('target');
    d.target = null; d.targetEl = null;
    if (!under) return;
    const setEl = under.closest('.set') as HTMLElement | null;
    const newEl = under.closest('.newset[data-new]') as HTMLElement | null;
    const rackEl = under.closest('.rack') as HTMLElement | null;
    if (setEl) { d.target = { kind: 'set', index: Number(setEl.dataset.set) }; d.targetEl = setEl; }
    else if (newEl) { d.target = { kind: 'new' }; d.targetEl = newEl; }
    else if (rackEl) {
      const before = under.closest('.tile') as HTMLElement | null;
      d.target = { kind: 'rack', before: before ? Number(before.dataset.id) : undefined };
      d.targetEl = rackEl;
    }
    d.targetEl?.classList.add('target');
    // desplazamiento automático de la mesa cerca de los bordes
    const tbl = this.root.querySelector('.table') as HTMLElement | null;
    if (tbl) {
      const r = tbl.getBoundingClientRect();
      if (ev.clientY < r.top + 40) tbl.scrollTop -= 12;
      else if (ev.clientY > r.bottom - 40 && ev.clientY < r.bottom) tbl.scrollTop += 12;
    }
  }

  private endDrag(_ev: PointerEvent) {
    const d = this.drag!;
    this.drag = null;
    d.ghost.remove();
    d.targetEl?.classList.remove('target');
    this.root.querySelectorAll('.drag-src').forEach(n => n.classList.remove('drag-src'));
    if (!d.target) return this.render();
    if (d.target.kind === 'rack') {
      const fromRack = d.ids.filter(id => this.rack.includes(id));
      if (fromRack.length === d.ids.length) {
        // solo reordenar el atril
        let order = this.rackOrder.filter(id => !fromRack.includes(id));
        const at = d.target.before != null ? order.indexOf(d.target.before) : -1;
        order = at >= 0 ? [...order.slice(0, at), ...fromRack, ...order.slice(at)] : [...order, ...fromRack];
        this.rackOrder = order;
        this.rack = order.filter(id => !this.placed.has(id));
        this.selected.clear();
        return this.render();
      }
    }
    this.moveTo(d.ids, d.target);
  }
}

export function describeEvent(name: string | undefined, type: string, n?: number) {
  if (type === 'play') return `${name} colocó ${n} ficha${n === 1 ? '' : 's'}`;
  if (type === 'draw') return `${name} robó una ficha`;
  return '';
}
export { tileLabel };
