// Lectura del token EKOKIIN (TRC-20) en TRON. Solo lectura: el servidor nunca firma, nunca guarda
// llaves privadas y nunca mueve fondos. Las firmas, si algún día hacen falta, ocurren en TronLink.

import { createHash } from 'node:crypto';
import type { Config } from '../config.ts';

const NODES = { mainnet: 'https://api.trongrid.io', nile: 'https://nile.trongrid.io' } as const;
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Datos verificados en TronScan el 14-oct-2026 (ver docs/WEB3.md). */
export const EKOKIIN_VERIFIED = {
  contract: 'TMNKYEbXGJGFPaZXs8tBER6gMiRvjKtUiU',
  name: "EKO K'IIN Token",
  symbol: 'EKOKIIN',
  decimals: 18,
  totalSupplyTokens: '100000000',
  issuer: 'TAguowZSZgJpLt3ZXYfFAbV5NktLzPcGqC',
  issuedAt: '2026-09-26 15:24:51',
  verifiedAt: '2026-10-14',
  marketPrice: null, // TronScan no reporta precio de mercado; la app no muestra ni promete precio.
  // Validación del contrato (14-oct-2026, TronGrid getcontract + TronScan)
  contractName: 'EKOKiinTestToken', // nombre interno del contrato desplegado
  sourceVerified: false, // código fuente no verificado en TronScan
  compiler: 'Solidity 0.8.20',
  functions: ['name', 'symbol', 'decimals', 'totalSupply', 'INITIAL_SUPPLY', 'balanceOf', 'allowance', 'transfer', 'approve', 'transferFrom'],
  fixedSupply: true, // sin mint; todo el suministro se emitió al desplegar
  adminFunctions: false, // sin owner, pausa, lista negra, quema ni comisiones
  holdersAtValidation: 10,
};

export function isTronAddress(a: unknown): a is string {
  if (typeof a !== 'string' || a.length !== 34 || a[0] !== 'T') return false;
  for (const ch of a) if (!ALPHABET.includes(ch)) return false;
  return base58ToHex(a) !== null;
}

/** Base58Check → hex (41 + 20 bytes), con verificación del checksum doble SHA-256. */
export function base58ToHex(addr: string): string | null {
  let n = 0n;
  for (const ch of addr) { const i = ALPHABET.indexOf(ch); if (i < 0) return null; n = n * 58n + BigInt(i); }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length !== 25) return null;
  const payload = bytes.subarray(0, 21), check = bytes.subarray(21);
  const h = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest();
  if (!h.subarray(0, 4).equals(check)) return null;
  return payload.toString('hex');
}

export function formatUnits(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, '0');
  const int = s.slice(0, -decimals) || '0';
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

async function constantCall(cfg: Config, owner: string, selector: string, parameter = '') {
  const res = await fetch(`${NODES[cfg.tronNetwork]}/wallet/triggerconstantcontract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.tronApiKey ? { 'TRON-PRO-API-KEY': cfg.tronApiKey } : {}) },
    body: JSON.stringify({ owner_address: owner, contract_address: cfg.ekokiinContract, function_selector: selector, parameter, visible: true }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`TronGrid ${res.status}`);
  const j = (await res.json()) as any;
  if (!j?.result?.result || !j.constant_result?.[0]) throw new Error('Respuesta de contrato inválida');
  return j.constant_result[0] as string;
}

let cache: { at: number; data: unknown } | null = null;

/** Lee decimales y suministro en cadena (con caché de 5 min). */
export async function tokenInfo(cfg: Config) {
  if (cache && Date.now() - cache.at < 300000) return cache.data;
  const owner = cfg.ekokiinContract;
  const [dec, supply] = await Promise.all([constantCall(cfg, owner, 'decimals()'), constantCall(cfg, owner, 'totalSupply()')]);
  const decimals = Number(BigInt('0x' + dec));
  const data = { network: cfg.tronNetwork, contract: cfg.ekokiinContract, decimals, totalSupply: formatUnits(BigInt('0x' + supply), decimals), source: 'on-chain' };
  cache = { at: Date.now(), data };
  return data;
}

export async function balanceOf(cfg: Config, address: string) {
  if (!isTronAddress(address)) throw new Error('Dirección TRON inválida');
  const hex = base58ToHex(address)!.slice(2).padStart(64, '0');
  const raw = await constantCall(cfg, address, 'balanceOf(address)', hex);
  return formatUnits(BigInt('0x' + raw), EKOKIIN_VERIFIED.decimals);
}

/** Historial de transferencias TRC-20 de EKOKIIN para una dirección (lectura pública). */
export async function transfers(cfg: Config, address: string, limit = 20) {
  if (!isTronAddress(address)) throw new Error('Dirección TRON inválida');
  const url = `${NODES[cfg.tronNetwork]}/v1/accounts/${address}/transactions/trc20?limit=${Math.min(50, limit)}&contract_address=${cfg.ekokiinContract}`;
  const res = await fetch(url, { headers: cfg.tronApiKey ? { 'TRON-PRO-API-KEY': cfg.tronApiKey } : {}, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`TronGrid ${res.status}`);
  const j = (await res.json()) as any;
  return (j.data ?? []).map((t: any) => ({
    txid: t.transaction_id, from: t.from, to: t.to, value: formatUnits(BigInt(t.value ?? 0), Number(t.token_info?.decimals ?? 18)),
    at: t.block_timestamp, explorer: `https://tronscan.org/#/transaction/${t.transaction_id}`,
  }));
}
