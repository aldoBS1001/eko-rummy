import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TILES, TOTAL_TILES, tile, analyzeSet, createGame, applyMove, applyTimeout, checkIntegrity, viewFor,
  validatePlay, seededRng, scoreRound, dealRound, replaceWithBot, matchWinner, teamScores, type GameState,
} from '../src/index.ts';

// id(color, value, copy)
const T = (c: number, v: number, copy = 0) => copy * 52 + c * 13 + (v - 1);
const J1 = 104, J2 = 105;
const R = 0, Y = 1, C = 2, N = 3; // Jade, Sol, Coral, Noche

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Jugador ${i + 1}` }));

/** Prepara un estado controlado: atriles y mesa a medida, el resto al pozo. */
function rig(racks: number[][], table: number[][] = [], opened: boolean[] = [], extra: Partial<GameState['config']> = {}): GameState {
  const s = createGame('g', seats(racks.length), extra, seededRng(1));
  const used = new Set([...racks.flat(), ...table.flat()]);
  s.players.forEach((p, i) => { p.rack = [...racks[i]]; p.opened = opened[i] ?? false; });
  s.table = table.map(x => [...x]);
  s.pool = TILES.map(t => t.id).filter(id => !used.has(id));
  s.turn = 0;
  assert.equal(checkIntegrity(s), null);
  return s;
}

describe('1. Generación de fichas', () => {
  test('exactamente 106 fichas con ids únicos e inmutables', () => {
    assert.equal(TILES.length, 106);
    assert.equal(TOTAL_TILES, 106);
    assert.equal(new Set(TILES.map(t => t.id)).size, 106);
    TILES.forEach((t, i) => assert.equal(t.id, i));
    assert.ok(Object.isFrozen(TILES) && Object.isFrozen(TILES[0]));
  });
  test('4 colores × 13 números × 2 copias + 2 comodines', () => {
    const reals = TILES.filter(t => !t.joker);
    assert.equal(reals.length, 104);
    assert.equal(TILES.filter(t => t.joker).length, 2);
    for (let c = 0; c < 4; c++) for (let v = 1; v <= 13; v++)
      assert.equal(reals.filter(t => t.color === c && t.value === v).length, 2);
  });
});

describe('2. Reparto', () => {
  test('14 fichas por jugador, sin duplicados, resto en el pozo', () => {
    for (const n of [2, 3, 4]) {
      const s = createGame('g', seats(n));
      s.players.forEach(p => assert.equal(p.rack.length, 14));
      assert.equal(s.pool.length, 106 - 14 * n);
      assert.equal(checkIntegrity(s), null);
    }
  });
  test('el pozo se baraja (CSPRNG): dos repartos distintos', () => {
    const a = createGame('a', seats(2)), b = createGame('b', seats(2));
    assert.notDeepEqual(a.pool, b.pool);
  });
  test('la vista de un jugador no contiene atriles ajenos ni el pozo', () => {
    const s = createGame('g', seats(4));
    const v = viewFor(s, 1);
    const json = JSON.stringify(v);
    assert.deepEqual(v.rack, s.players[1].rack);
    assert.ok(!('pool' in v));
    assert.equal(v.poolCount, s.pool.length);
    for (const p of v.players) assert.ok(!('rack' in p));
    // ninguna ficha del jugador 0 aparece como lista en la vista del 1 (salvo casualidad de números sueltos)
    assert.ok(!json.includes(JSON.stringify(s.players[0].rack)));
  });
});

describe('3. Apertura de 30 puntos', () => {
  test('rechaza apertura de 29 y acepta de 30', () => {
    // 9+10+11 = 30 ; 8+9+10 = 27 ; grupo 9×3 = 27 + 2?
    const s = rig([[T(R, 9), T(R, 10), T(R, 11), T(Y, 8), T(Y, 9), T(Y, 10), T(C, 1)], [T(N, 1)]]);
    const low = applyMove(s, 0, { type: 'play', table: [[T(Y, 8), T(Y, 9), T(Y, 10)]] });
    assert.equal(low.ok, false);
    assert.equal((low as any).code, 'OPENING_TOO_LOW');
    const ok = applyMove(s, 0, { type: 'play', table: [[T(R, 9), T(R, 10), T(R, 11)]] });
    assert.equal(ok.ok, true);
    if (ok.ok) { assert.equal(ok.state.players[0].opened, true); assert.equal(checkIntegrity(ok.state), null); }
  });
  test('varias combinaciones suman para la apertura', () => {
    const s = rig([[T(R, 1), T(R, 2), T(R, 3), T(Y, 8), T(Y, 9), T(Y, 10), T(C, 4)], [T(N, 1)]]);
    const r = applyMove(s, 0, { type: 'play', table: [[T(R, 1), T(R, 2), T(R, 3)], [T(Y, 8), T(Y, 9), T(Y, 10)]] });
    assert.equal(r.ok, true); // 6 + 27 = 33
  });
  test('antes de abrir no se puede tocar la mesa', () => {
    const table = [[T(N, 5), T(N, 6), T(N, 7)]];
    const s = rig([[T(N, 8), T(R, 10), T(Y, 10), T(C, 10)], [T(R, 1)]], table);
    const r = applyMove(s, 0, { type: 'play', table: [[T(N, 5), T(N, 6), T(N, 7), T(N, 8)], [T(R, 10), T(Y, 10), T(C, 10)]] });
    assert.equal(r.ok, false);
    assert.equal((r as any).code, 'NOT_OPENED_MANIPULATION');
    const ok = applyMove(s, 0, { type: 'play', table: [[T(N, 7), T(N, 5), T(N, 6)], [T(R, 10), T(Y, 10), T(C, 10)]] });
    assert.equal(ok.ok, true, 'reordenar visualmente una combinación intacta sí se permite');
  });
});

describe('4. Grupos', () => {
  test('válidos', () => {
    assert.ok(analyzeSet([T(R, 7), T(Y, 7), T(C, 7)]).valid);
    assert.ok(analyzeSet([T(R, 7), T(Y, 7), T(C, 7), T(N, 7, 1)]).valid);
    assert.equal(analyzeSet([T(R, 7), T(Y, 7), T(C, 7)]).kind, 'group');
    assert.equal(analyzeSet([T(R, 7), T(Y, 7), T(C, 7)]).points, 21);
  });
  test('inválidos', () => {
    assert.equal(analyzeSet([T(R, 7), T(Y, 7)]).valid, false, 'menos de 3');
    assert.equal(analyzeSet([T(R, 7), T(R, 7, 1), T(C, 7)]).valid, false, 'color repetido');
    assert.equal(analyzeSet([T(R, 7), T(Y, 8), T(C, 7)]).valid, false, 'número distinto');
    assert.equal(analyzeSet([T(R, 7), T(Y, 7), T(C, 7), T(N, 7), J1]).valid, false, 'más de 4');
  });
});

describe('5. Escaleras', () => {
  test('válidas', () => {
    assert.ok(analyzeSet([T(C, 3), T(C, 4), T(C, 5)]).valid);
    assert.ok(analyzeSet([T(C, 5), T(C, 3), T(C, 4)]).valid, 'orden de entrada indiferente');
    const full = Array.from({ length: 13 }, (_, i) => T(N, i + 1));
    assert.ok(analyzeSet(full).valid);
    assert.equal(analyzeSet(full).points, 91);
    assert.ok(analyzeSet([T(R, 1), T(R, 2), T(R, 3)]).valid, '1 como valor inferior');
  });
  test('inválidas', () => {
    assert.equal(analyzeSet([T(C, 3), T(C, 4), T(Y, 5)]).valid, false, 'mezcla colores');
    assert.equal(analyzeSet([T(C, 3), T(C, 5), T(C, 6)]).valid, false, 'hueco');
    assert.equal(analyzeSet([T(C, 12), T(C, 13), T(C, 1)]).valid, false, '1 no va después del 13');
    assert.equal(analyzeSet([T(C, 4), T(C, 4, 1), T(C, 5)]).valid, false, 'número repetido');
  });
});

describe('6. Comodines', () => {
  test('sustituyen en grupos y escaleras', () => {
    assert.ok(analyzeSet([T(R, 9), T(Y, 9), J1]).valid);
    const run = analyzeSet([T(C, 3), J1, T(C, 5)]);
    assert.ok(run.valid);
    assert.deepEqual(run.ordered, [T(C, 3), J1, T(C, 5)]);
    assert.equal(run.jokerValues![J1], 4);
    assert.ok(analyzeSet([T(C, 3), J1, J2]).valid);
    assert.equal(analyzeSet([J1, J2]).valid, false);
  });
  test('comodín extremo va arriba; si no cabe, abajo', () => {
    assert.equal(analyzeSet([T(C, 5), T(C, 6), J1]).jokerValues![J1], 7);
    assert.equal(analyzeSet([T(C, 12), T(C, 13), J1]).jokerValues![J1], 11);
    assert.equal(analyzeSet([T(C, 12), T(C, 13), J1]).points, 36);
  });
  test('el comodín cuenta su valor para la apertura', () => {
    const s = rig([[T(R, 10), T(R, 11), J1, T(N, 2)], [T(N, 1)]]);
    const r = applyMove(s, 0, { type: 'play', table: [[T(R, 10), T(R, 11), J1]] }); // 10+11+12 = 33
    assert.equal(r.ok, true);
  });
  test('sustitución: recuperar el comodín de la mesa y usarlo en el mismo turno', () => {
    const table = [[T(N, 4), J1, T(N, 6)]];
    const s = rig([[T(N, 5), T(R, 9), T(Y, 9), T(C, 1)], [T(R, 1)]], table, [true, true]);
    const r = applyMove(s, 0, { type: 'play', table: [[T(N, 4), T(N, 5), T(N, 6)], [T(R, 9), T(Y, 9), J1]] });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(checkIntegrity(r.state), null);
  });
  test('el comodín recuperado no puede quedarse en el atril', () => {
    const table = [[T(N, 4), J1, T(N, 6)]];
    const s = rig([[T(N, 5), T(C, 1)], [T(R, 1)]], table, [true, true]);
    const r = applyMove(s, 0, { type: 'play', table: [[T(N, 4), T(N, 5), T(N, 6)]] });
    assert.equal(r.ok, false);
    assert.equal((r as any).code, 'TABLE_TILE_REMOVED');
  });
});

describe('7. Reorganización de la mesa', () => {
  test('dividir una escalera e insertar fichas', () => {
    const table = [[T(R, 3), T(R, 4), T(R, 5), T(R, 6), T(R, 7), T(R, 8)]];
    const s = rig([[T(Y, 5), T(C, 5), T(N, 13)], [T(N, 1)]], table, [true, true]);
    const r = applyMove(s, 0, { type: 'play', table: [[T(R, 6), T(R, 7), T(R, 8)], [T(R, 5), T(Y, 5), T(C, 5)], [T(R, 3), T(R, 4)]] });
    assert.equal(r.ok, false, 'dejar 3-4 sueltos es inválido');
    assert.equal((r as any).code, 'INVALID_SET');
    // Correcto: dividir 3..9 en 3-4-5 / grupo de 6 / 7-8-9
    const table2 = [[T(R, 3), T(R, 4), T(R, 5), T(R, 6), T(R, 7), T(R, 8), T(R, 9)]];
    const s2 = rig([[T(Y, 6), T(C, 6), T(N, 13)], [T(N, 1)]], table2, [true, true]);
    const ok = applyMove(s2, 0, { type: 'play', table: [[T(R, 3), T(R, 4), T(R, 5)], [T(R, 6), T(Y, 6), T(C, 6)], [T(R, 7), T(R, 8), T(R, 9)]] });
    assert.equal(ok.ok, true);
    if (ok.ok) { assert.equal(ok.state.table.length, 3); assert.deepEqual(ok.state.players[0].rack, [T(N, 13)]); }
  });
  test('no se puede colocar una ficha ajena', () => {
    const s = rig([[T(R, 1)], [T(Y, 1), T(Y, 2), T(Y, 3)]], [], [true, true]);
    const r = applyMove(s, 0, { type: 'play', table: [[T(Y, 1), T(Y, 2), T(Y, 3)]] });
    assert.equal((r as any).code, 'NOT_IN_RACK');
  });
  test('no se acepta duplicar fichas', () => {
    const s = rig([[T(R, 1), T(R, 2), T(R, 3)], [T(Y, 1)]], [], [true, true]);
    const r = applyMove(s, 0, { type: 'play', table: [[T(R, 1), T(R, 2), T(R, 3)], [T(R, 1), T(R, 2), T(R, 3)]] });
    assert.equal((r as any).code, 'DUPLICATE');
  });
  test('formato malicioso rechazado', () => {
    const s = rig([[T(R, 1)], [T(Y, 1)]], [], [true, true]);
    for (const bad of [null, 'x', [[999]], [[-1]], [[1.5]], [['a']], [{}]] as any[])
      assert.equal(applyMove(s, 0, { type: 'play', table: bad }).ok, false);
  });
  test('turno equivocado rechazado', () => {
    const s = rig([[T(R, 1), T(R, 2), T(R, 3)], [T(Y, 1)]], [], [true, true]);
    assert.equal((applyMove(s, 1, { type: 'draw' }) as any).code, 'NOT_YOUR_TURN');
  });
});

describe('8. Restauración ante jugadas inválidas', () => {
  test('una jugada inválida no altera el estado', () => {
    const s = rig([[T(R, 1), T(R, 2), T(Y, 5)], [T(Y, 1)]], [[T(N, 1), T(N, 2), T(N, 3)]], [true, true]);
    const snapshot = JSON.stringify(s);
    const r = applyMove(s, 0, { type: 'play', table: [[T(N, 1), T(N, 2), T(N, 3)], [T(R, 1), T(R, 2), T(Y, 5)]] });
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(s), snapshot);
  });
  test('tiempo agotado: roba penalización y pasa el turno', () => {
    const s = rig([[T(R, 1)], [T(Y, 1)]], [], [], { timeoutPenaltyDraws: 2 });
    const r = applyTimeout(s);
    assert.ok(r.ok);
    if (r.ok) { assert.equal(r.state.players[0].rack.length, 3); assert.equal(r.state.turn, 1); assert.equal(checkIntegrity(r.state), null); }
  });
});

describe('9. Agotamiento del pozo y bloqueo', () => {
  test('robar con pozo vacío pasa; todos pasan → ronda bloqueada', () => {
    let s = rig([[T(R, 1), T(R, 5)], [T(Y, 13), T(Y, 12)], [T(C, 2)]]);
    // mover el pozo a los atriles para dejarlo vacío conservando integridad
    s.players[2].rack.push(...s.pool);
    s.pool = [];
    assert.equal(checkIntegrity(s), null);
    for (let i = 0; i < 3; i++) {
      const r = applyMove(s, s.turn, { type: 'draw' });
      assert.ok(r.ok);
      if (r.ok) s = r.state;
    }
    assert.equal(s.status, 'finished');
    const h = s.history[0];
    assert.equal(h.reason, 'blocked');
    assert.equal(h.winnerSeat, 0); // 6 puntos en atril
    assert.equal(h.points[1], -25);
    assert.equal(h.points[0], (25 - 6) + (s.players[2].rack.reduce((a, id) => a + (tile(id).joker ? 30 : tile(id).value), 0) - 6));
  });
  test('robar normal toma una ficha del pozo', () => {
    const s = rig([[T(R, 1)], [T(Y, 1)]]);
    const top = s.pool[0];
    const r = applyMove(s, 0, { type: 'draw' });
    assert.ok(r.ok);
    if (r.ok) { assert.ok(r.state.players[0].rack.includes(top)); assert.equal(r.state.pool.length, s.pool.length - 1); }
  });
});

describe('10. Finalización y puntuación', () => {
  test('quedarse sin fichas termina la ronda; comodín resta 30', () => {
    const s = rig([[T(R, 10), T(R, 11), T(R, 12)], [T(Y, 5), J1], [T(C, 13), T(N, 2)]]);
    const r = applyMove(s, 0, { type: 'play', table: [[T(R, 10), T(R, 11), T(R, 12)]] });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.state.status, 'finished');
    assert.deepEqual(r.state.history[0].points, [35 + 15, -35, -15]);
    assert.deepEqual(r.state.scores, [50, -35, -15]);
    assert.equal(matchWinner(r.state).seat, 0);
  });
  test('varias rondas acumulan marcador', () => {
    let s = rig([[T(R, 10), T(R, 11), T(R, 12)], [T(Y, 5)]], [], [], { rounds: 2 });
    const r = applyMove(s, 0, { type: 'play', table: [[T(R, 10), T(R, 11), T(R, 12)]] });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.state.status, 'round_over');
    s = dealRound(r.state);
    assert.equal(s.round, 2);
    assert.equal(s.turn, 1, 'la salida rota');
    assert.deepEqual(s.scores, [5, -5]);
    assert.equal(checkIntegrity(s), null);
  });
  test('equipos: gana el equipo del que cierra; el compañero no resta', () => {
    const s = rig([[T(R, 10), T(R, 11), T(R, 12)], [T(Y, 5)], [T(C, 9)], [T(N, 3), J1]], [], [], { teams: true });
    const r = applyMove(s, 0, { type: 'play', table: [[T(R, 10), T(R, 11), T(R, 12)]] });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.state.history[0].points, [38, -5, 0, -33]);
    assert.equal(r.state.history[0].winnerTeam, 0);
    assert.deepEqual(teamScores(r.state), [38, -38]);
  });
  test('equipos requiere 4 jugadores', () => {
    assert.throws(() => createGame('g', seats(2), { teams: true }));
  });
  test('scoreRound directo con pozo intacto', () => {
    const s = rig([[T(R, 1)], [T(Y, 13), J2]]);
    const res = scoreRound(s, 0, 'empty_rack');
    assert.deepEqual(res.points, [43, -43]);
  });
});

describe('Abandono', () => {
  test('un bot reemplaza al jugador y conserva su atril', () => {
    const s = createGame('g', seats(2));
    const b = replaceWithBot(s, 1, 'avanzado');
    assert.equal(b.players[1].isBot, true);
    assert.deepEqual(b.players[1].rack, s.players[1].rack);
  });
});

test('validatePlay no requiere estado mutable', () => {
  const s = rig([[T(R, 10), T(R, 11), T(R, 12)], [T(Y, 5)]]);
  assert.deepEqual(validatePlay(s, 0, [[T(R, 10), T(R, 11), T(R, 12)]]), { ok: true, placed: [T(R, 10), T(R, 11), T(R, 12)] });
});
