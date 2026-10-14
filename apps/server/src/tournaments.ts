// Torneos gratuitos de eliminación directa (4 u 8 jugadores, duelos 1 vs 1).
// No hay inscripción pagada ni premios económicos. Si un jugador no se presenta, la IA ocupa su lugar.

import { randomUUID } from 'node:crypto';
import type { RoomManager, Room } from './rooms.ts';

interface Entrant { userId: string; name: string; registered: boolean }
interface Match { id: string; round: number; a: Entrant | null; b: Entrant | null; winner: Entrant | null; roomCode: string | null }

export interface Tournament {
  id: string;
  name: string;
  size: 4 | 8;
  createdAt: number;
  status: 'registration' | 'running' | 'finished';
  entrants: Entrant[];
  matches: Match[];
  champion: Entrant | null;
}

export class TournamentManager {
  list = new Map<string, Tournament>();
  private rooms: RoomManager;
  private notify: (userId: string, msg: unknown) => void;
  constructor(rooms: RoomManager, notify: (userId: string, msg: unknown) => void) { this.rooms = rooms; this.notify = notify; }

  create(name: string, size: number): Tournament {
    const t: Tournament = {
      id: randomUUID(), name: String(name || 'Torneo EKO').slice(0, 40), size: size === 8 ? 8 : 4, createdAt: Date.now(),
      status: 'registration', entrants: [], matches: [], champion: null,
    };
    this.list.set(t.id, t);
    return t;
  }

  join(id: string, e: Entrant): string | null {
    const t = this.list.get(id);
    if (!t) return 'Torneo no encontrado';
    if (t.status !== 'registration') return 'Las inscripciones están cerradas';
    if (t.entrants.some(x => x.userId === e.userId)) return null;
    if (t.entrants.length >= t.size) return 'Torneo lleno';
    t.entrants.push(e);
    if (t.entrants.length === t.size) this.begin(t);
    return null;
  }

  leave(id: string, userId: string) {
    const t = this.list.get(id);
    if (t?.status === 'registration') t.entrants = t.entrants.filter(e => e.userId !== userId);
  }

  private begin(t: Tournament) {
    t.status = 'running';
    const seeded = [...t.entrants].sort(() => Math.random() - 0.5);
    for (let i = 0; i < seeded.length; i += 2)
      t.matches.push({ id: randomUUID(), round: 1, a: seeded[i], b: seeded[i + 1], winner: null, roomCode: null });
    for (const m of t.matches) this.launch(t, m);
  }

  private launch(t: Tournament, m: Match) {
    const room: Room = this.rooms.create('tournament', 2, false, undefined, 1, t.id);
    for (const e of [m.a!, m.b!]) room.reserve(e.userId, e.name, e.registered);
    m.roomCode = room.code;
    room.onFinish = (_r, winnerSeat) => this.report(t.id, m.id, winnerSeat === 0 ? m.a! : m.b!);
    // Los ausentes quedan desconectados y la IA los reemplaza tras el período de gracia.
    room.start(null);
    for (let i = 0; i < 2; i++) room.seats[i].disconnectedAt = Date.now();
    for (const e of [m.a!, m.b!]) this.notify(e.userId, { t: 'tournament_match', tournament: t.id, code: room.code, round: m.round });
    // programar reemplazo de quien no se conecte
    setTimeout(() => {
      room.seats.forEach((s, i) => { if (!s.conn && !s.isBot && room.game && room.game.status !== 'finished') room.botTakeover(i, 'no se presentó'); });
    }, this.rooms.cfg.reconnectGraceSeconds * 1000).unref?.();
  }

  report(tid: string, mid: string, winner: Entrant) {
    const t = this.list.get(tid);
    if (!t) return;
    const m = t.matches.find(x => x.id === mid);
    if (!m || m.winner) return;
    m.winner = winner;
    const round = m.round;
    const roundMatches = t.matches.filter(x => x.round === round);
    if (roundMatches.some(x => !x.winner)) return;
    if (roundMatches.length === 1) { t.status = 'finished'; t.champion = winner; return; }
    for (let i = 0; i < roundMatches.length; i += 2) {
      const nm: Match = { id: randomUUID(), round: round + 1, a: roundMatches[i].winner, b: roundMatches[i + 1].winner, winner: null, roomCode: null };
      t.matches.push(nm);
      this.launch(t, nm);
    }
  }

  public summary() {
    return [...this.list.values()].filter(t => Date.now() - t.createdAt < 7 * 86400000).map(t => ({
      id: t.id, name: t.name, size: t.size, status: t.status, entrants: t.entrants.map(e => e.name), champion: t.champion?.name ?? null,
      matches: t.matches.map(m => ({ round: m.round, a: m.a?.name, b: m.b?.name, winner: m.winner?.name ?? null, code: m.roomCode })),
    }));
  }
}
