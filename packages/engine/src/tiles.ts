// EKO RUMMY — definición de fichas.
// 106 fichas: 4 colores × 13 números × 2 copias + 2 comodines.
// El id es inmutable y determina la ficha: id = copia*52 + color*13 + (valor-1); 104 y 105 son comodines.

export type Color = 0 | 1 | 2 | 3;

export interface Tile {
  readonly id: number;
  readonly color: Color | null;
  readonly value: number; // 1..13; 0 para comodín
  readonly joker: boolean;
}

export const COLOR_NAMES = ['Jade', 'Sol', 'Coral', 'Noche'] as const;
export const TOTAL_TILES = 106;
export const JOKER_IDS = [104, 105] as const;

function buildTiles(): readonly Tile[] {
  const out: Tile[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (let color = 0; color < 4; color++) {
      for (let value = 1; value <= 13; value++) {
        out.push(Object.freeze({ id: copy * 52 + color * 13 + (value - 1), color: color as Color, value, joker: false }));
      }
    }
  }
  out.push(Object.freeze({ id: 104, color: null, value: 0, joker: true }));
  out.push(Object.freeze({ id: 105, color: null, value: 0, joker: true }));
  return Object.freeze(out);
}

export const TILES: readonly Tile[] = buildTiles();

export function tile(id: number): Tile {
  const t = TILES[id];
  if (!t || !Number.isInteger(id)) throw new Error(`Ficha inexistente: ${id}`);
  return t;
}

export function isValidTileId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < TOTAL_TILES;
}

/** Valor de penalización de una ficha en el atril al cerrar ronda. */
export function penaltyValue(id: number, jokerPenalty = 30): number {
  const t = tile(id);
  return t.joker ? jokerPenalty : t.value;
}

export function describeTile(id: number): string {
  const t = tile(id);
  return t.joker ? 'Comodín' : `${t.value} ${COLOR_NAMES[t.color!]}`;
}

/** Orden de atril: por color y valor (o por valor y color). */
export function sortRack(ids: number[], mode: 'color' | 'value' = 'color'): number[] {
  return [...ids].sort((a, b) => {
    const ta = tile(a), tb = tile(b);
    if (ta.joker !== tb.joker) return ta.joker ? 1 : -1;
    if (ta.joker) return a - b;
    if (mode === 'color') return ta.color! - tb.color! || ta.value - tb.value || a - b;
    return ta.value - tb.value || ta.color! - tb.color! || a - b;
  });
}
