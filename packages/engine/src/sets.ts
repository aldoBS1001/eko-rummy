// Validación de combinaciones (grupos y escaleras) y valor de los comodines.
//
// REGLAMENTO EKO RUMMY (comodines):
// - Un comodín sustituye cualquier ficha. Un grupo o escalera puede llevar como máximo 2 comodines
//   (solo existen 2) y debe contener al menos 1 ficha real.
// - Los comodines de la mesa pueden recuperarse y moverse libremente durante la reorganización del turno
//   de un jugador que ya abrió. Como ninguna ficha de la mesa puede regresar al atril, un comodín
//   recuperado queda obligatoriamente usado en una combinación válida al terminar ese mismo turno.
// - Valor del comodín (para la apertura): en un grupo vale el número del grupo; en una escalera, el número
//   que ocupa. Si una escalera tiene comodines sobrantes en los extremos, se colocan primero arriba
//   (hacia el 13) y, si no caben, abajo. Si una combinación puede leerse como grupo o como escalera,
//   se toma la lectura de mayor puntuación.
// - El 1 solo es el valor más bajo: 12-13-1 no es escalera.

import { tile, type Tile, type Color } from './tiles.ts';

export type SetKind = 'group' | 'run';

export interface SetAnalysis {
  valid: boolean;
  kind?: SetKind;
  points: number;
  /** ids ordenados para mostrar (comodines en su posición) */
  ordered?: number[];
  /** valor asignado a cada comodín (id → valor) */
  jokerValues?: Record<number, number>;
  /** color de la escalera */
  color?: Color;
  reason?: string;
}

const invalid = (reason: string): SetAnalysis => ({ valid: false, points: 0, reason });

function analyzeGroup(tiles: Tile[]): SetAnalysis {
  if (tiles.length < 3 || tiles.length > 4) return invalid('Un grupo debe tener 3 o 4 fichas');
  const reals = tiles.filter(t => !t.joker);
  const jokers = tiles.filter(t => t.joker);
  if (reals.length === 0) return invalid('Se necesita al menos una ficha real');
  const v = reals[0].value;
  if (reals.some(t => t.value !== v)) return invalid('Un grupo debe tener el mismo número');
  const colors = new Set(reals.map(t => t.color));
  if (colors.size !== reals.length) return invalid('Un grupo no puede repetir color');
  const ordered = [...reals].sort((a, b) => a.color! - b.color!).map(t => t.id).concat(jokers.map(t => t.id));
  const jokerValues: Record<number, number> = {};
  for (const j of jokers) jokerValues[j.id] = v;
  return { valid: true, kind: 'group', points: v * tiles.length, ordered, jokerValues };
}

function analyzeRun(tiles: Tile[]): SetAnalysis {
  if (tiles.length < 3) return invalid('Una escalera debe tener al menos 3 fichas');
  if (tiles.length > 13) return invalid('Una escalera no puede superar 13 fichas');
  const reals = tiles.filter(t => !t.joker);
  const jokers = tiles.filter(t => t.joker);
  if (reals.length === 0) return invalid('Se necesita al menos una ficha real');
  const color = reals[0].color!;
  if (reals.some(t => t.color !== color)) return invalid('Una escalera debe ser de un solo color');
  const values = reals.map(t => t.value).sort((a, b) => a - b);
  for (let i = 1; i < values.length; i++) if (values[i] === values[i - 1]) return invalid('Una escalera no puede repetir número');
  const min = values[0], max = values[values.length - 1];
  const span = max - min + 1;
  if (span > tiles.length) return invalid('Faltan fichas para completar la escalera');
  const extra = tiles.length - span;
  const hi = Math.min(13, max + extra);
  const lo = hi - tiles.length + 1;
  if (lo < 1) return invalid('La escalera se sale del rango 1–13');
  const byValue = new Map(reals.map(t => [t.value, t.id]));
  const ordered: number[] = [];
  const jokerValues: Record<number, number> = {};
  let j = 0;
  let points = 0;
  for (let v = lo; v <= hi; v++) {
    points += v;
    const id = byValue.get(v);
    if (id !== undefined) ordered.push(id);
    else { const jid = jokers[j++].id; ordered.push(jid); jokerValues[jid] = v; }
  }
  return { valid: true, kind: 'run', points, ordered, jokerValues, color };
}

export function analyzeSet(ids: number[]): SetAnalysis {
  if (!Array.isArray(ids) || ids.length === 0) return invalid('Combinación vacía');
  if (new Set(ids).size !== ids.length) return invalid('Ficha duplicada');
  let tiles: Tile[];
  try { tiles = ids.map(tile); } catch { return invalid('Ficha inexistente'); }
  if (tiles.filter(t => t.joker).length > 2) return invalid('Demasiados comodines');
  const g = analyzeGroup(tiles);
  const r = analyzeRun(tiles);
  if (g.valid && r.valid) return g.points >= r.points ? g : r;
  if (g.valid) return g;
  if (r.valid) return r;
  // Mensaje más útil: si todos los reales comparten número, explicar el error de grupo.
  const reals = tiles.filter(t => !t.joker);
  return reals.every(t => t.value === reals[0]?.value) ? g : r;
}

export const isValidSet = (ids: number[]) => analyzeSet(ids).valid;

export function setPoints(ids: number[]): number {
  return analyzeSet(ids).points;
}
