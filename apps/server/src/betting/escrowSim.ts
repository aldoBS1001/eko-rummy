// SIMULADOR de custodia (escrow) para partidas con participación económica.
// Opera con un libro contable en memoria y unidades ficticias de testnet. No toca dinero, tokens
// reales ni la red. Sirve para validar la lógica antes de escribir y auditar un contrato real.

export interface SimConfig {
  feeBps: number; // comisión transparente en puntos base (100 = 1 %)
  minStake: bigint;
  maxStake: bigint;
  dailyLimit: bigint; // límite de participación diaria por jugador
}

export interface SimPlayer { id: string; ageVerified: boolean; kycPassed: boolean; jurisdictionAllowed: boolean; selfExcludedUntil?: number }

type MatchState = 'open' | 'locked' | 'settled' | 'refunded';
interface SimMatch { id: string; stake: bigint; seats: string[]; teams: boolean; deposits: Map<string, bigint>; state: MatchState; acceptedTerms: Set<string> }

export class EscrowSimulator {
  balances = new Map<string, bigint>();
  matches = new Map<string, SimMatch>();
  feesCollected = 0n;
  ledger: { at: number; type: string; match?: string; player?: string; amount: bigint }[] = [];
  private spentToday = new Map<string, bigint>();
  private players = new Map<string, SimPlayer>();

  cfg: SimConfig;
  constructor(cfg: SimConfig) { this.cfg = cfg; }

  registerPlayer(p: SimPlayer, faucet: bigint) { this.players.set(p.id, p); this.balances.set(p.id, faucet); }
  selfExclude(id: string, days: number) { const p = this.players.get(id); if (p) p.selfExcludedUntil = Date.now() + days * 86400000; }

  private eligible(id: string): string | null {
    const p = this.players.get(id);
    if (!p) return 'Jugador no registrado';
    if (!p.ageVerified) return 'Edad no verificada';
    if (!p.kycPassed) return 'KYC pendiente';
    if (!p.jurisdictionAllowed) return 'Jurisdicción no habilitada';
    if (p.selfExcludedUntil && p.selfExcludedUntil > Date.now()) return 'Jugador autoexcluido';
    return null;
  }

  createMatch(id: string, stake: bigint, seats: string[], teams = false) {
    if (stake < this.cfg.minStake || stake > this.cfg.maxStake) throw new Error('Monto fuera de límites');
    if (seats.length < 2 || seats.length > 4 || new Set(seats).size !== seats.length) throw new Error('Asientos inválidos');
    if (teams && seats.length !== 4) throw new Error('Equipos requiere 4 jugadores');
    this.matches.set(id, { id, stake, seats, teams, deposits: new Map(), state: 'open', acceptedTerms: new Set() });
  }

  acceptTerms(matchId: string, player: string) { this.matches.get(matchId)?.acceptedTerms.add(player); }

  deposit(matchId: string, player: string) {
    const m = this.matches.get(matchId);
    if (!m || m.state !== 'open') throw new Error('Partida no abierta');
    if (!m.seats.includes(player)) throw new Error('No pertenece a la partida');
    if (!m.acceptedTerms.has(player)) throw new Error('Debe aceptar las condiciones antes de participar');
    const e = this.eligible(player); if (e) throw new Error(e);
    if (m.deposits.has(player)) throw new Error('Depósito duplicado');
    const spent = (this.spentToday.get(player) ?? 0n) + m.stake;
    if (spent > this.cfg.dailyLimit) throw new Error('Límite diario alcanzado');
    const bal = this.balances.get(player) ?? 0n;
    if (bal < m.stake) throw new Error('Saldo insuficiente');
    this.balances.set(player, bal - m.stake);
    this.spentToday.set(player, spent);
    m.deposits.set(player, m.stake);
    this.ledger.push({ at: Date.now(), type: 'deposit', match: matchId, player, amount: m.stake });
    if (m.deposits.size === m.seats.length) m.state = 'locked';
  }

  /** Liquida: el pozo menos la comisión se reparte entre los ganadores (empate o equipo → partes iguales). */
  settle(matchId: string, winners: string[]) {
    const m = this.matches.get(matchId);
    if (!m || m.state !== 'locked') throw new Error('La partida no está bloqueada');
    if (!winners.length || winners.some(w => !m.seats.includes(w))) throw new Error('Ganadores inválidos');
    const pot = m.stake * BigInt(m.seats.length);
    const fee = (pot * BigInt(this.cfg.feeBps)) / 10000n;
    const net = pot - fee;
    const share = net / BigInt(winners.length);
    const dust = net - share * BigInt(winners.length);
    this.feesCollected += fee + dust;
    for (const w of winners) {
      this.balances.set(w, (this.balances.get(w) ?? 0n) + share);
      this.ledger.push({ at: Date.now(), type: 'payout', match: matchId, player: w, amount: share });
    }
    this.ledger.push({ at: Date.now(), type: 'fee', match: matchId, amount: fee + dust });
    m.state = 'settled';
    return { pot, fee: fee + dust, share };
  }

  /** Cancelación válida: devuelve cada depósito íntegro. */
  refund(matchId: string) {
    const m = this.matches.get(matchId);
    if (!m || (m.state !== 'open' && m.state !== 'locked')) throw new Error('No se puede reembolsar');
    for (const [p, amt] of m.deposits) {
      this.balances.set(p, (this.balances.get(p) ?? 0n) + amt);
      this.spentToday.set(p, (this.spentToday.get(p) ?? 0n) - amt);
      this.ledger.push({ at: Date.now(), type: 'refund', match: matchId, player: p, amount: amt });
    }
    m.state = 'refunded';
  }

  /** Invariante contable: lo depositado = saldos + comisiones + custodia pendiente. */
  totalSupply(): bigint {
    let s = this.feesCollected;
    for (const b of this.balances.values()) s += b;
    for (const m of this.matches.values()) if (m.state === 'open' || m.state === 'locked') for (const d of m.deposits.values()) s += d;
    return s;
  }
}
