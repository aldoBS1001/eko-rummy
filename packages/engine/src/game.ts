// Motor de partida EKO RUMMY: estado, reparto, validación de turnos, robo, bloqueo y puntuación.
// Independiente de la interfaz y del transporte. Todas las funciones son puras: reciben un estado
// y devuelven uno nuevo (o un error), lo que permite deshacer, reproducir y auditar.

import { TILES, TOTAL_TILES, isValidTileId, penaltyValue } from './tiles.ts';
import { analyzeSet } from './sets.ts';
import { shuffle, type Rng } from './rng.ts';

export interface GameConfig {
  openingThreshold: number; // puntos mínimos de apertura
  initialTiles: number; // fichas iniciales por jugador
  turnSeconds: number; // 0 = sin temporizador
  jokerPenalty: number;
  teams: boolean; // 2 vs 2: asientos 0 y 2 = equipo A; 1 y 3 = equipo B
  timeoutPenaltyDraws: number; // fichas que se roban al agotar el tiempo
  rounds: number; // rondas de la partida
}

export const DEFAULT_CONFIG: GameConfig = {
  openingThreshold: 30,
  initialTiles: 14,
  turnSeconds: 60,
  jokerPenalty: 30,
  teams: false,
  timeoutPenaltyDraws: 1,
  rounds: 1,
};

export interface PlayerSeat {
  id: string;
  name: string;
  isBot?: boolean;
  botLevel?: AiLevel;
  avatar?: string;
}

export type AiLevel = 'principiante' | 'intermedio' | 'avanzado' | 'experto';

export interface PlayerState extends PlayerSeat {
  rack: number[];
  opened: boolean;
  team: number | null;
}

export type EndReason = 'empty_rack' | 'blocked';

export interface RoundResult {
  round: number;
  reason: EndReason;
  winnerSeat: number;
  winnerTeam: number | null;
  /** puntos de la ronda por asiento */
  points: number[];
  /** fichas que quedaban en cada atril */
  remaining: number[][];
}

export interface GameEvent {
  seq: number;
  type: 'deal' | 'play' | 'draw' | 'pass' | 'timeout' | 'round_end' | 'game_end' | 'replace_bot';
  seat?: number;
  tilesPlaced?: number;
  at: number;
}

export interface GameState {
  id: string;
  config: GameConfig;
  players: PlayerState[];
  pool: number[];
  table: number[][];
  turn: number;
  turnNumber: number;
  round: number;
  /** turnos consecutivos sin jugar con el pozo vacío */
  passesWithEmptyPool: number;
  status: 'playing' | 'round_over' | 'finished';
  scores: number[];
  history: RoundResult[];
  events: GameEvent[];
  seq: number;
}

export type Move = { type: 'play'; table: number[][] } | { type: 'draw' };

export interface MoveError {
  ok: false;
  code: string;
  message: string;
}
export type MoveResult = { ok: true; state: GameState; drawn?: number[] } | MoveError;

const fail = (code: string, message: string): MoveError => ({ ok: false, code, message });

function clone(s: GameState): GameState {
  return {
    ...s,
    config: { ...s.config },
    players: s.players.map(p => ({ ...p, rack: [...p.rack] })),
    pool: [...s.pool],
    table: s.table.map(set => [...set]),
    scores: [...s.scores],
    history: [...s.history],
    events: [...s.events],
  };
}

function pushEvent(s: GameState, e: Omit<GameEvent, 'seq' | 'at'>, now = Date.now()) {
  s.seq += 1;
  s.events.push({ ...e, seq: s.seq, at: now });
  if (s.events.length > 500) s.events.splice(0, s.events.length - 500);
}

export function createGame(
  id: string,
  seats: PlayerSeat[],
  config: Partial<GameConfig> = {},
  rng?: Rng,
): GameState {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (seats.length < 2 || seats.length > 4) throw new Error('Se requieren de 2 a 4 jugadores');
  if (cfg.teams && seats.length !== 4) throw new Error('El modo equipos requiere 4 jugadores');
  const state: GameState = {
    id,
    config: cfg,
    players: seats.map((s, i) => ({ ...s, rack: [], opened: false, team: cfg.teams ? i % 2 : null })),
    pool: [],
    table: [],
    turn: 0,
    turnNumber: 0,
    round: 0,
    passesWithEmptyPool: 0,
    status: 'playing',
    scores: seats.map(() => 0),
    history: [],
    events: [],
    seq: 0,
  };
  return dealRound(state, rng);
}

/** Reparte una ronda nueva. El orden del pozo lo genera el servidor (CSPRNG por defecto). */
export function dealRound(prev: GameState, rng?: Rng): GameState {
  const s = clone(prev);
  const all = TILES.map(t => t.id);
  const pool = shuffle(all, rng);
  for (const p of s.players) {
    p.rack = pool.splice(0, s.config.initialTiles);
    p.opened = false;
  }
  s.pool = pool;
  s.table = [];
  s.round += 1;
  s.turn = (s.round - 1) % s.players.length;
  s.turnNumber = 1;
  s.passesWithEmptyPool = 0;
  s.status = 'playing';
  pushEvent(s, { type: 'deal' });
  return s;
}

/** Comprueba la integridad: 106 fichas, sin duplicados ni desapariciones. */
export function checkIntegrity(s: GameState): string | null {
  const seen = new Uint8Array(TOTAL_TILES);
  const mark = (id: number) => {
    if (!isValidTileId(id)) return `Id inválido ${id}`;
    if (seen[id]) return `Ficha duplicada ${id}`;
    seen[id] = 1;
    return null;
  };
  for (const id of s.pool) { const e = mark(id); if (e) return e; }
  for (const p of s.players) for (const id of p.rack) { const e = mark(id); if (e) return e; }
  for (const set of s.table) for (const id of set) { const e = mark(id); if (e) return e; }
  for (let i = 0; i < TOTAL_TILES; i++) if (!seen[i]) return `Ficha desaparecida ${i}`;
  return null;
}

const key = (set: number[]) => [...set].sort((a, b) => a - b).join(',');

/** Valida una jugada completa (mesa resultante) sin modificar el estado. */
export function validatePlay(s: GameState, seat: number, newTable: unknown): { ok: true; placed: number[] } | MoveError {
  if (s.status !== 'playing') return fail('NOT_PLAYING', 'La ronda no está en curso');
  if (seat !== s.turn) return fail('NOT_YOUR_TURN', 'No es tu turno');
  if (!Array.isArray(newTable) || newTable.some(set => !Array.isArray(set)))
    return fail('BAD_FORMAT', 'Formato de mesa inválido');
  const sets = newTable as unknown[][];
  const all: number[] = [];
  for (const set of sets) for (const id of set) {
    if (!isValidTileId(id)) return fail('BAD_TILE', 'Ficha inválida');
    all.push(id);
  }
  const newIds = new Set(all);
  if (newIds.size !== all.length) return fail('DUPLICATE', 'Hay fichas duplicadas en la mesa');

  const oldIds = new Set(s.table.flat());
  for (const id of oldIds) if (!newIds.has(id)) return fail('TABLE_TILE_REMOVED', 'Las fichas de la mesa no pueden regresar al atril');

  const player = s.players[seat];
  const rack = new Set(player.rack);
  const placed = all.filter(id => !oldIds.has(id));
  for (const id of placed) if (!rack.has(id)) return fail('NOT_IN_RACK', 'Esa ficha no está en tu atril');
  if (placed.length === 0) return fail('NO_TILES', 'Debes colocar al menos una ficha o robar');

  for (const set of sets) {
    const a = analyzeSet(set as number[]);
    if (!a.valid) return fail('INVALID_SET', a.reason ?? 'Combinación inválida');
  }

  if (!player.opened) {
    // Antes de abrir: la mesa existente debe quedar intacta y las nuevas combinaciones
    // deben formarse solo con fichas propias y sumar el mínimo de apertura.
    const remaining = new Map<string, number>();
    for (const set of s.table) remaining.set(key(set), (remaining.get(key(set)) ?? 0) + 1);
    let openingPoints = 0;
    for (const set of sets as number[][]) {
      const k = key(set);
      const c = remaining.get(k) ?? 0;
      if (c > 0) { remaining.set(k, c - 1); continue; }
      if (set.some(id => oldIds.has(id))) return fail('NOT_OPENED_MANIPULATION', 'Antes de abrir no puedes modificar combinaciones de la mesa');
      openingPoints += analyzeSet(set).points;
    }
    if (openingPoints < s.config.openingThreshold)
      return fail('OPENING_TOO_LOW', `La apertura debe sumar al menos ${s.config.openingThreshold} puntos (llevas ${openingPoints})`);
  }
  return { ok: true, placed };
}

function advanceTurn(s: GameState) {
  s.turn = (s.turn + 1) % s.players.length;
  s.turnNumber += 1;
}

export function applyMove(prev: GameState, seat: number, move: Move, now = Date.now()): MoveResult {
  if (move.type === 'play') {
    const v = validatePlay(prev, seat, move.table);
    if (!v.ok) return v;
    const s = clone(prev);
    const placed = new Set(v.placed);
    const p = s.players[seat];
    p.rack = p.rack.filter(id => !placed.has(id));
    p.opened = true;
    s.table = (move.table as number[][]).map(set => analyzeSet(set).ordered!);
    s.passesWithEmptyPool = 0;
    pushEvent(s, { type: 'play', seat, tilesPlaced: placed.size }, now);
    if (p.rack.length === 0) return { ok: true, state: endRound(s, seat, 'empty_rack', now) };
    advanceTurn(s);
    return { ok: true, state: s };
  }
  if (move.type === 'draw') return drawOrPass(prev, seat, 1, 'draw', now);
  return fail('BAD_MOVE', 'Movimiento desconocido');
}

/** Robar al no jugar. Si el pozo está vacío el turno se pasa; si todos pasan, la ronda queda bloqueada. */
function drawOrPass(prev: GameState, seat: number, count: number, type: 'draw' | 'timeout', now: number): MoveResult {
  if (prev.status !== 'playing') return fail('NOT_PLAYING', 'La ronda no está en curso');
  if (seat !== prev.turn) return fail('NOT_YOUR_TURN', 'No es tu turno');
  const s = clone(prev);
  const drawn = s.pool.splice(0, count);
  s.players[seat].rack.push(...drawn);
  if (drawn.length === 0) {
    s.passesWithEmptyPool += 1;
    pushEvent(s, { type: 'pass', seat }, now);
    if (s.passesWithEmptyPool >= s.players.length) return { ok: true, state: endRound(s, blockedWinner(s), 'blocked', now), drawn };
  } else {
    pushEvent(s, { type, seat }, now);
  }
  advanceTurn(s);
  return { ok: true, state: s, drawn };
}

/** Tiempo agotado: se descarta lo movido (el servidor nunca aplicó nada) y se roba la penalización. */
export function applyTimeout(prev: GameState, now = Date.now()): MoveResult {
  return drawOrPass(prev, prev.turn, Math.max(1, prev.config.timeoutPenaltyDraws), 'timeout', now);
}

function rackValue(s: GameState, seat: number) {
  return s.players[seat].rack.reduce((a, id) => a + penaltyValue(id, s.config.jokerPenalty), 0);
}

/** Bloqueo: gana quien tenga menos puntos en el atril; empate → menos fichas → asiento menor tras el último turno. */
function blockedWinner(s: GameState): number {
  let best = 0;
  for (let i = 1; i < s.players.length; i++) {
    const a = rackValue(s, i), b = rackValue(s, best);
    if (a < b || (a === b && s.players[i].rack.length < s.players[best].rack.length)) best = i;
  }
  return best;
}

/**
 * Puntuación.
 * Individual: cada perdedor resta el valor de su atril (comodín = 30); el ganador suma el total.
 * En bloqueo el ganador también puede tener fichas: los perdedores restan su atril y el ganador suma
 * la suma de los perdedores menos su propio atril multiplicado por el número de perdedores
 * (equivalente a cobrar la diferencia a cada uno).
 * Equipos (variante EKO): gana el equipo del jugador que cierra. Los integrantes del equipo perdedor
 * restan su atril; el equipo ganador suma esa cantidad, repartida al asiento que cerró. El compañero
 * del ganador no resta ni suma. En bloqueo gana el equipo con menor suma de atriles.
 */
export function scoreRound(s: GameState, winnerSeat: number, reason: EndReason): RoundResult {
  const n = s.players.length;
  const vals = s.players.map((_, i) => rackValue(s, i));
  const points = new Array(n).fill(0);
  let winnerTeam: number | null = null;
  if (s.config.teams) {
    let wt = s.players[winnerSeat].team!;
    if (reason === 'blocked') {
      const t0 = vals[0] + vals[2], t1 = vals[1] + vals[3];
      wt = t0 <= t1 ? 0 : 1;
      winnerSeat = [0, 1, 2, 3].filter(i => s.players[i].team === wt).sort((a, b) => vals[a] - vals[b])[0];
    }
    winnerTeam = wt;
    let total = 0;
    for (let i = 0; i < n; i++) if (s.players[i].team !== wt) { points[i] = -vals[i]; total += vals[i]; }
    if (reason === 'blocked') {
      const own = [0, 1, 2, 3].filter(i => s.players[i].team === wt).reduce((a, i) => a + vals[i], 0);
      total = Math.max(0, total - own);
    }
    points[winnerSeat] = total;
  } else {
    let total = 0;
    for (let i = 0; i < n; i++) if (i !== winnerSeat) { points[i] = -vals[i]; total += vals[i]; }
    if (reason === 'blocked') total = Math.max(0, total - vals[winnerSeat] * (n - 1));
    points[winnerSeat] = total;
  }
  return { round: s.round, reason, winnerSeat, winnerTeam, points, remaining: s.players.map(p => [...p.rack]) };
}

function endRound(s: GameState, winnerSeat: number, reason: EndReason, now: number): GameState {
  const r = scoreRound(s, winnerSeat, reason);
  s.history.push(r);
  for (let i = 0; i < s.scores.length; i++) s.scores[i] += r.points[i];
  s.status = s.round >= s.config.rounds ? 'finished' : 'round_over';
  pushEvent(s, { type: 'round_end', seat: r.winnerSeat }, now);
  if (s.status === 'finished') pushEvent(s, { type: 'game_end' }, now);
  return s;
}

export function teamScores(s: GameState): [number, number] | null {
  if (!s.config.teams) return null;
  return [s.scores[0] + s.scores[2], s.scores[1] + s.scores[3]];
}

/** Ganador global (asiento o equipo) de una partida terminada. */
export function matchWinner(s: GameState): { seat: number; team: number | null } {
  const ts = teamScores(s);
  if (ts) {
    const team = ts[0] >= ts[1] ? 0 : 1;
    const seat = [0, 1, 2, 3].filter(i => i % 2 === team).sort((a, b) => s.scores[b] - s.scores[a])[0];
    return { seat, team };
  }
  let best = 0;
  s.scores.forEach((v, i) => { if (v > s.scores[best]) best = i; });
  return { seat: best, team: null };
}

/** Reemplaza a un jugador que abandonó por un bot (mantiene su atril). */
export function replaceWithBot(prev: GameState, seat: number, level: AiLevel = 'intermedio'): GameState {
  const s = clone(prev);
  s.players[seat] = { ...s.players[seat], isBot: true, botLevel: level };
  pushEvent(s, { type: 'replace_bot', seat });
  return s;
}

// ---------- Vistas seguras ----------

export interface PlayerView {
  gameId: string;
  seat: number;
  config: GameConfig;
  rack: number[];
  opened: boolean;
  table: number[][];
  poolCount: number;
  turn: number;
  turnNumber: number;
  round: number;
  status: GameState['status'];
  scores: number[];
  history: RoundResult[];
  players: { name: string; rackCount: number; opened: boolean; team: number | null; isBot: boolean; avatar?: string }[];
  seq: number;
}

/** Lo único que el servidor envía a cada cliente: nunca atriles ajenos ni el orden del pozo. */
export function viewFor(s: GameState, seat: number): PlayerView {
  const showAll = s.status !== 'playing';
  return {
    gameId: s.id,
    seat,
    config: s.config,
    rack: [...s.players[seat].rack],
    opened: s.players[seat].opened,
    table: s.table.map(x => [...x]),
    poolCount: s.pool.length,
    turn: s.turn,
    turnNumber: s.turnNumber,
    round: s.round,
    status: s.status,
    scores: [...s.scores],
    history: showAll ? s.history : s.history.map(h => ({ ...h })),
    players: s.players.map(p => ({ name: p.name, rackCount: p.rack.length, opened: p.opened, team: p.team, isBot: !!p.isBot, avatar: p.avatar })),
    seq: s.seq,
  };
}
