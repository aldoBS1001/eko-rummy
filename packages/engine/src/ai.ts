// Inteligencia artificial de EKO RUMMY.
// La IA recibe únicamente su vista (PlayerView): su atril, la mesa y conteos. Nunca ve fichas ocultas.
//
// Núcleo: un buscador que particiona un conjunto de fichas en combinaciones válidas, donde las fichas
// "obligatorias" (las de la mesa) deben quedar todas en combinaciones y las "opcionales" (el atril) se
// colocan maximizando cantidad y valor. Con eso se obtienen jugadas con reorganización completa de mesa.

import { tile, type Tile } from './tiles.ts';
import { analyzeSet } from './sets.ts';
import type { AiLevel, Move, PlayerView } from './game.ts';
import type { Rng } from './rng.ts';

interface Item { t: Tile; must: boolean; used: boolean }

export interface SolveResult { sets: number[][]; usedOptional: number[]; complete: boolean; nodes: number }

const tileScore = (t: Tile) => 1000 + (t.joker ? 30 : t.value);

/**
 * Descarta fichas opcionales que no pueden formar parte de ninguna combinación con las fichas
 * disponibles (ni grupo ni escalera de 3). Reduce drásticamente la búsqueda con atriles grandes.
 */
function prunePlaceable(mustIds: number[], optionalIds: number[]): number[] {
  let opt = optionalIds;
  for (;;) {
    const all = [...mustIds, ...opt].map(tile);
    const J = all.filter(t => t.joker).length;
    const has = new Set(all.filter(t => !t.joker).map(t => t.color! * 13 + t.value));
    const ok = (t: Tile) => {
      if (t.joker) return all.length - 1 >= 2;
      let colors = 0;
      for (let c = 0; c < 4; c++) if (c !== t.color && has.has(c * 13 + t.value)) colors++;
      if (colors + J >= 2) return true;
      for (let lo = Math.max(1, t.value - 2); lo <= Math.min(t.value, 11); lo++) {
        let missing = 0;
        for (let v = lo; v < lo + 3; v++) if (v !== t.value && !has.has(t.color! * 13 + v)) missing++;
        if (missing <= J) return true;
      }
      return false;
    };
    const next = opt.filter(id => ok(tile(id)));
    if (next.length === opt.length) return opt;
    opt = next;
  }
}

/**
 * Busca la mejor partición. `budget` limita nodos explorados (dificultad / tiempo).
 * Devuelve null si no encuentra ninguna partición que cubra todas las fichas obligatorias.
 */
export function solve(mustIds: number[], optionalIds: number[], budget = 20000, preferKeepJokers = false, maxMs = Infinity): SolveResult | null {
  const deadline = Date.now() + maxMs;
  optionalIds = prunePlaceable(mustIds, optionalIds);
  const items: Item[] = [
    ...mustIds.map(id => ({ t: tile(id), must: true, used: false })),
    ...optionalIds.map(id => ({ t: tile(id), must: false, used: false })),
  ].sort((a, b) => {
    if (a.t.joker !== b.t.joker) return a.t.joker ? 1 : -1;
    if (a.t.joker) return (b.must ? 1 : 0) - (a.must ? 1 : 0);
    return a.t.color! - b.t.color! || a.t.value - b.t.value || (b.must ? 1 : 0) - (a.must ? 1 : 0);
  });
  const jokerIdx = items.map((it, i) => (it.t.joker ? i : -1)).filter(i => i >= 0);
  const optScore = (it: Item) => (it.must ? 0 : tileScore(it.t) - (preferKeepJokers && it.t.joker ? 1500 : 0));
  let potential = items.reduce((a, it) => a + Math.max(0, optScore(it)), 0);

  let nodes = 0;
  let aborted = false;
  let best: { score: number; sets: number[][] } | null = null;
  const current: number[][] = [];

  const findReal = (color: number, value: number): number => {
    let found = -1;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.used && !it.t.joker && it.t.color === color && it.t.value === value) {
        if (it.must) return i;
        if (found < 0) found = i;
      }
    }
    return found;
  };

  const freeJokers = () => jokerIdx.filter(i => !items[i].used);

  function candidates(first: number): number[][] {
    const t = items[first].t;
    const out: number[][] = [];
    const jokers = freeJokers();
    // Escaleras: t es la ficha real libre más baja de su color, así que debajo solo puede haber comodines.
    for (let lo = t.value; lo >= Math.max(1, t.value - jokers.length); lo--) {
      const below = t.value - lo;
      const chain: number[] = [];
      let jUsed = below;
      for (let k = 0; k < below; k++) chain.push(-1);
      chain.push(first);
      for (let v = t.value + 1; v <= 13; v++) {
        items[first].used = true; // evitar reusar t
        const idx = findReal(t.color!, v);
        items[first].used = false;
        if (idx >= 0) chain.push(idx);
        else { if (jUsed >= jokers.length) break; chain.push(-1); jUsed++; }
        if (chain.length >= 3) {
          let ji = 0;
          const set = chain.map(c => (c >= 0 ? c : jokers[ji++]));
          out.push(set);
        }
      }
      // escalera que termina en 13 con comodines debajo ya cubierta; también escaleras cortas sólo con comodines arriba
    }
    // Grupos
    const others: number[] = [];
    items[first].used = true;
    for (let c = 0; c < 4; c++) if (c !== t.color) { const idx = findReal(c, t.value); if (idx >= 0) others.push(idx); }
    items[first].used = false;
    for (let mask = 0; mask < 1 << others.length; mask++) {
      const sel = others.filter((_, i) => mask & (1 << i));
      for (let j = 0; j <= Math.min(2, jokers.length); j++) {
        const size = 1 + sel.length + j;
        if (size < 3 || size > 4) continue;
        out.push([first, ...sel, ...jokers.slice(0, j)]);
      }
    }
    // Primero las combinaciones que usan más fichas obligatorias / más fichas en general.
    out.sort((a, b) => b.length - a.length);
    return out;
  }

  function record(s: number) {
    if (!best || s > best.score) best = { score: s, sets: current.map(set => set.map(i => items[i].t.id)) };
  }

  function dfs(gained: number, pot: number) {
    if (aborted) return;
    if (++nodes > budget || ((nodes & 255) === 0 && Date.now() > deadline)) { aborted = true; return; }
    if (best && gained + pot <= best.score) return; // poda por cota superior
    let first = -1;
    for (let i = 0; i < items.length; i++) if (!items[i].used && !items[i].t.joker) { first = i; break; }
    if (first < 0) {
      // quedan solo comodines libres: los obligatorios deben estar colocados
      if (jokerIdx.some(i => !items[i].used && items[i].must)) return;
      record(gained);
      return;
    }
    const it = items[first];
    for (const cand of candidates(first)) {
      const ids = cand.map(i => items[i].t.id);
      if (!analyzeSet(ids).valid) continue;
      let g = 0, p = 0;
      for (const i of cand) { items[i].used = true; const sc = optScore(items[i]); g += sc; p += Math.max(0, sc); }
      current.push(cand);
      dfs(gained + g, pot - p);
      current.pop();
      for (const i of cand) items[i].used = false;
      if (aborted) return;
    }
    if (!it.must) {
      it.used = true; // descartar (no colocar) esta ficha opcional
      dfs(gained, pot - Math.max(0, optScore(it)));
      it.used = false;
    }
  }

  dfs(0, potential);
  if (!best) return null;
  const b = best as { score: number; sets: number[][] };
  const placed = new Set(b.sets.flat());
  return { sets: b.sets, usedOptional: optionalIds.filter(id => placed.has(id)), complete: !aborted, nodes };
}

const sumPoints = (sets: number[][]) => sets.reduce((a, s) => a + analyzeSet(s).points, 0);

/** Agrega fichas sueltas del atril a combinaciones existentes, sin reorganizar. */
function extendTable(table: number[][], rack: number[]): { table: number[][]; placed: number[] } {
  const t = table.map(s => [...s]);
  const left = [...rack];
  const placed: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < left.length; i++) {
      const id = left[i];
      if (tile(id).joker) continue; // los comodines sueltos se guardan
      for (const set of t) {
        if (analyzeSet([...set, id]).valid) {
          set.push(id);
          placed.push(id);
          left.splice(i, 1);
          i--;
          changed = true;
          break;
        }
      }
    }
  }
  return { table: t.map(s => analyzeSet(s).ordered ?? s), placed };
}

const BUDGET: Record<AiLevel, number> = { principiante: 3000, intermedio: 8000, avanzado: 40000, experto: 150000 };
/** Tiempo máximo de búsqueda por llamada (ms), para que el turno de la IA se sienta ágil en móviles. */
const TIME: Record<AiLevel, number> = { principiante: 60, intermedio: 120, avanzado: 250, experto: 450 };

/** Decide la jugada de la IA a partir de su vista. */
export function chooseMove(view: PlayerView, level: AiLevel, rng: Rng = Math.random): Move {
  const rack = view.rack;
  const table = view.table;
  const budget = BUDGET[level];
  const ms = TIME[level];

  if (!view.opened) {
    const sol = solve([], rack, budget, false, ms);
    if (!sol || sol.sets.length === 0) return { type: 'draw' };
    let sets = sol.sets;
    if (level === 'principiante' && rng() < 0.25) return { type: 'draw' }; // a veces no ve la jugada
    if (sumPoints(sets) < view.config.openingThreshold) return { type: 'draw' };
    // Experto: si la apertura no necesita los comodines, los guarda.
    if (level === 'experto' && sets.length > 1) {
      const withoutJ = solve([], rack.filter(id => !tile(id).joker), budget, false, ms);
      if (withoutJ && sumPoints(withoutJ.sets) >= view.config.openingThreshold && withoutJ.usedOptional.length >= sol.usedOptional.length - 2 && rack.length - withoutJ.usedOptional.length > 0)
        sets = withoutJ.sets;
    }
    return { type: 'play', table: [...table.map(s => [...s]), ...sets] };
  }

  if (level === 'principiante') {
    if (rng() < 0.2) return { type: 'draw' };
    const sol = solve([], rack, budget, false, ms);
    if (sol && sol.sets.length) return { type: 'play', table: [...table, sol.sets[0]] };
    const ext = extendTable(table, rack);
    if (ext.placed.length) return { type: 'play', table: ext.table };
    return { type: 'draw' };
  }

  // Intermedio: combinaciones nuevas del atril + extender combinaciones existentes.
  const simple = (() => {
    const sol = solve([], rack, budget, false, ms);
    const newSets = sol?.sets ?? [];
    const used = new Set(newSets.flat());
    const ext = extendTable(table, rack.filter(id => !used.has(id)));
    return { table: [...ext.table, ...newSets], count: used.size + ext.placed.length };
  })();
  if (level === 'intermedio') return simple.count > 0 ? { type: 'play', table: simple.table } : { type: 'draw' };

  // Avanzado / experto: reorganización de la mesa. Solo se reabren las combinaciones que pueden
  // interactuar con el atril (mismo número, mismo color cercano o con comodín); el resto queda fijo.
  const { open, fixed } = relevantSets(table, rack, level === 'experto' ? 2 : 1);
  const tryFull = (keepJ: boolean) => {
    const r = solve(open.flat(), rack, budget, keepJ, ms);
    return r ? { table: [...fixed, ...r.sets], count: r.usedOptional.length, all: r.usedOptional.length === rack.length } : null;
  };
  const full = tryFull(level === 'experto');
  let bestTable = simple.table, bestCount = simple.count;
  if (full && (full.count > bestCount || full.all)) { bestTable = full.table; bestCount = full.count; }
  if (level === 'experto' && bestCount === 0) {
    // Sin jugada guardando comodines: reintentar permitiendo usarlos.
    const any = tryFull(false);
    if (any && any.count > 0) { bestTable = any.table; bestCount = any.count; }
  }
  return bestCount > 0 ? { type: 'play', table: bestTable } : { type: 'draw' };
}

/** Separa la mesa en combinaciones reorganizables (relacionadas con el atril) y fijas. */
function relevantSets(table: number[][], rack: number[], depth: number): { open: number[][]; fixed: number[][] } {
  const isOpen = table.map(() => false);
  let frontier = rack.map(tile);
  const touches = (a: Tile, b: Tile) =>
    a.joker || b.joker || a.value === b.value || (a.color === b.color && Math.abs(a.value - b.value) <= 2);
  for (let d = 0; d < depth; d++) {
    const added: Tile[] = [];
    table.forEach((set, i) => {
      if (isOpen[i]) return;
      const ts = set.map(tile);
      if (ts.some(t => t.joker) || ts.some(t => frontier.some(f => !f.joker && touches(t, f)))) { isOpen[i] = true; added.push(...ts); }
    });
    if (!added.length) break;
    frontier = added;
  }
  return { open: table.filter((_, i) => isOpen[i]), fixed: table.filter((_, i) => !isOpen[i]) };
}

/** Sugerencia para principiantes: qué fichas podría jugar ahora. */
export function hint(view: PlayerView): { tiles: number[]; table?: number[][] } {
  const m = chooseMove(view, 'avanzado');
  if (m.type === 'draw') return { tiles: [] };
  const before = new Set(view.table.flat());
  return { tiles: m.table.flat().filter(id => !before.has(id)), table: m.table };
}
