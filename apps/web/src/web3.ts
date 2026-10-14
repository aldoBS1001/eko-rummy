// Integración TronLink (solo lectura + firma en la billetera del usuario si algún día se requiere).
// La app nunca pide ni guarda llaves privadas o frases semilla.

export const EKOKIIN = {
  contract: 'TMNKYEbXGJGFPaZXs8tBER6gMiRvjKtUiU',
  symbol: 'EKOKIIN',
  name: "EKO K'IIN Token",
  decimals: 18,
  supply: '100,000,000',
  explorer: 'https://tronscan.org/#/token20/TMNKYEbXGJGFPaZXs8tBER6gMiRvjKtUiU',
  swap: 'https://sun.io/',
};

declare global { interface Window { tronLink?: any; tronWeb?: any } }

export type WalletState =
  | { status: 'no-wallet' }
  | { status: 'locked' }
  | { status: 'rejected' }
  | { status: 'connected'; address: string; network: 'mainnet' | 'nile' | 'shasta' | 'other' };

export function detectNetwork(tw: any): 'mainnet' | 'nile' | 'shasta' | 'other' {
  const host: string = tw?.fullNode?.host ?? '';
  if (/nile/i.test(host)) return 'nile';
  if (/shasta/i.test(host)) return 'shasta';
  if (/trongrid\.io|tronstack|api\.tron/i.test(host)) return 'mainnet';
  return 'other';
}

export async function connectWallet(): Promise<WalletState> {
  // TronLink inyecta window.tronLink (extensión en escritorio; navegador DApp en la app móvil)
  for (let i = 0; i < 10 && !window.tronLink && !window.tronWeb; i++) await new Promise(r => setTimeout(r, 150));
  const tl = window.tronLink;
  if (!tl && !window.tronWeb) return { status: 'no-wallet' };
  try {
    if (tl?.request) {
      const r = await tl.request({ method: 'tron_requestAccounts' });
      if (r?.code === 4001) return { status: 'rejected' };
    }
  } catch { return { status: 'rejected' }; }
  const tw = tl?.tronWeb || window.tronWeb;
  const address: string | undefined = tw?.defaultAddress?.base58;
  if (!address) return { status: 'locked' };
  return { status: 'connected', address, network: detectNetwork(tw) };
}

export function shortAddr(a: string) { return `${a.slice(0, 5)}…${a.slice(-4)}`; }

export function formatUnits(raw: bigint, decimals = 18): string {
  const s = raw.toString().padStart(decimals + 1, '0');
  const int = s.slice(0, -decimals) || '0';
  const frac = s.slice(-decimals).replace(/0+$/, '').slice(0, 4);
  return (frac ? `${int}.${frac}` : int).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Saldo de EKOKIIN leyendo el contrato a través de TronLink (llamada de solo lectura). */
export async function readBalance(address: string): Promise<string> {
  const tw = window.tronLink?.tronWeb || window.tronWeb;
  if (!tw) throw new Error('Billetera no disponible');
  const c = await tw.contract().at(EKOKIIN.contract);
  const raw = await c.balanceOf(address).call();
  const big = BigInt(raw?._hex ?? raw?.toString?.() ?? raw);
  return formatUnits(big, EKOKIIN.decimals);
}

/** Últimas transferencias del usuario (API pública de TronGrid; también disponible vía el servidor). */
export async function readTransfers(address: string, network: 'mainnet' | 'nile' = 'mainnet') {
  const host = network === 'nile' ? 'https://nile.trongrid.io' : 'https://api.trongrid.io';
  const r = await fetch(`${host}/v1/accounts/${address}/transactions/trc20?limit=20&contract_address=${EKOKIIN.contract}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('No se pudo consultar el historial');
  const j = await r.json();
  return (j.data ?? []).map((t: any) => ({
    txid: t.transaction_id as string, from: t.from as string, to: t.to as string, at: t.block_timestamp as number,
    value: formatUnits(BigInt(t.value ?? 0), Number(t.token_info?.decimals ?? 18)),
  }));
}
