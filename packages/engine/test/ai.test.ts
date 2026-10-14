import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyMove, chooseMove, viewFor, checkIntegrity, seededRng, solve, analyzeSet, hint, type AiLevel, type GameState,
} from '../src/index.ts';

const T = (c: number, v: number, copy = 0) => copy * 52 + c * 13 + (v - 1);

/** Juega una partida completa entre bots. Cada jugada pasa por el validador del motor. */
export function simulate(levels: AiLevel[], seed: number, teams = false) {
  const rng = seededRng(seed);
  let s: GameState = createGame(`sim${seed}`, levels.map((l, i) => ({ id: `b${i}`, name: l, isBot: true, botLevel: l })), { teams }, rng);
  let rejected = 0, plays = 0, maxMs = 0;
  for (let guard = 0; guard < 2000 && s.status === 'playing'; guard++) {
    const seat = s.turn;
    const t0 = performance.now();
    const move = chooseMove(viewFor(s, seat), levels[seat], rng);
    maxMs = Math.max(maxMs, performance.now() - t0);
    let r = applyMove(s, seat, move);
    if (!r.ok) { rejected++; r = applyMove(s, seat, { type: 'draw' }); }
    assert.ok(r.ok);
    if (move.type === 'play') plays++;
    s = r.state;
    const integrity = checkIntegrity(s);
    assert.equal(integrity, null, integrity ?? '');
    for (const set of s.table) assert.ok(analyzeSet(set).valid);
  }
  return { s, rejected, plays, maxMs };
}

describe('IA', () => {
  test('encuentra la apertura con reorganización mínima', () => {
    const sol = solve([], [T(0, 10), T(0, 11), T(0, 12), T(1, 2), T(2, 7)], 5000);
    assert.ok(sol);
    assert.deepEqual(sol!.sets.map(s => s.sort((a, b) => a - b)), [[T(0, 10), T(0, 11), T(0, 12)]]);
  });

  test('reorganiza la mesa para colocar fichas (avanzado)', () => {
    // Mesa: 3..9 jade. Atril: 6 sol, 6 coral → dividir la escalera y formar grupo de 6.
    const table = [[3, 4, 5, 6, 7, 8, 9].map(v => T(0, v))];
    const rack = [T(1, 6), T(2, 6), T(3, 13)];
    const view: any = { rack, table, opened: true, config: { openingThreshold: 30 } };
    const m = chooseMove(view, 'avanzado');
    assert.equal(m.type, 'play');
    if (m.type === 'play') {
      const placed = m.table.flat().filter(id => !table[0].includes(id));
      assert.deepEqual(placed.sort((a, b) => a - b), [T(1, 6), T(2, 6)].sort((a, b) => a - b));
      for (const set of m.table) assert.ok(analyzeSet(set).valid);
    }
    // Intermedio no reorganiza: no puede jugar
    assert.equal(chooseMove(view, 'intermedio').type, 'draw');
  });

  test('la IA no recibe información oculta (vista sin atriles ajenos)', () => {
    const s = createGame('g', [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }]);
    const v = viewFor(s, 0) as any;
    assert.equal(v.pool, undefined);
    assert.ok(v.players.every((p: any) => p.rack === undefined));
  });

  test('sugerencia para principiantes', () => {
    const view: any = { rack: [T(0, 10), T(0, 11), T(0, 12), T(2, 1)], table: [], opened: false, config: { openingThreshold: 30 } };
    assert.deepEqual(hint(view).tiles.sort((a, b) => a - b), [T(0, 10), T(0, 11), T(0, 12)]);
  });

  for (const level of ['principiante', 'intermedio', 'avanzado', 'experto'] as AiLevel[]) {
    test(`partidas completas IA ${level} (4 jugadores)`, () => {
      for (const seed of [1, 2, 3]) {
        const { s, rejected, maxMs } = simulate([level, level, level, level], seed * 17 + level.length);
        assert.equal(s.status, 'finished');
        assert.equal(rejected, 0, 'la IA nunca propone jugadas ilegales');
        if (s.history[0].reason === 'empty_rack') assert.equal(s.scores.reduce((a, b) => a + b, 0), 0, 'suma cero');
        assert.ok(maxMs < 5000, `turno demasiado lento: ${maxMs.toFixed(0)} ms`);
      }
    });
  }

  test('partida completa por equipos 2 vs 2', () => {
    const { s, rejected } = simulate(['experto', 'intermedio', 'avanzado', 'principiante'], 99, true);
    assert.equal(s.status, 'finished');
    assert.equal(rejected, 0);
    assert.notEqual(s.history[0].winnerTeam, null);
  });

  test('la IA avanzada gana más que la principiante (30 partidas 1 vs 1)', () => {
    let wins = 0;
    const N = 30;
    for (let i = 0; i < N; i++) {
      const levels: AiLevel[] = i % 2 ? ['avanzado', 'principiante'] : ['principiante', 'avanzado'];
      const { s } = simulate(levels, 1000 + i);
      const expertSeat = levels.indexOf('avanzado');
      if (s.history[0].winnerSeat === expertSeat) wins++;
    }
    assert.ok(wins > N * 0.6, `avanzado ganó ${wins}/${N}`);
    console.log(`  avanzado vs principiante: ${wins}/${N}`);
  });
});
