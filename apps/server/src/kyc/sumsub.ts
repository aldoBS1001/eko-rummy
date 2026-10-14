// Verificación de identidad y edad (KYC) con Sumsub.
//
// Flujo:
//  1. La app pide /api/kyc/start (cuenta registrada que declaró ser mayor de edad) y recibe un enlace
//     de un solo uso a /kyc.html (válido 15 min). Se abre en el navegador del sistema para tener cámara.
//  2. kyc.html canjea el código por un token de acceso de Sumsub (/api/kyc/token) y lanza el WebSDK.
//  3. Sumsub avisa el resultado por webhook firmado (/api/kyc/webhook). También se puede consultar
//     el estado directamente (/api/kyc/refresh) por si el webhook se retrasa.
//  4. Solo las cuentas "approved" pueden participar en funciones con valor económico.
//
// No guardamos documentos ni fotos: quedan en Sumsub. Aquí solo el id del solicitante y el estado.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.ts';

export type KycStatus = 'none' | 'started' | 'pending' | 'approved' | 'retry' | 'rejected' | 'on_hold';

export function kycEnabled(cfg: Config) {
  return !!(cfg.sumsubAppToken && cfg.sumsubSecretKey && cfg.sumsubWebhookSecret);
}

/** Firma oficial de Sumsub: hex(HMAC_SHA256(secret, ts + MÉTODO + ruta_con_query + cuerpo)). */
export function signSumsub(secret: string, ts: number, method: string, pathWithQuery: string, body = ''): string {
  return createHmac('sha256', secret).update(String(ts) + method.toUpperCase() + pathWithQuery + body).digest('hex');
}

async function sumsubRequest(cfg: Config, method: 'GET' | 'POST', path: string, body = '') {
  const ts = Math.floor(Date.now() / 1000);
  const res = await fetch(cfg.sumsubBaseUrl + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'X-App-Token': cfg.sumsubAppToken!,
      'X-App-Access-Ts': String(ts),
      'X-App-Access-Sig': signSumsub(cfg.sumsubSecretKey!, ts, method, path, body),
    },
    body: body || undefined,
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const err = new Error(json?.description ?? `Sumsub ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json;
}

/** Token de acceso para el WebSDK, ligado a nuestro id de usuario (externalUserId en Sumsub). */
export async function createAccessToken(cfg: Config, userId: string): Promise<string> {
  const q = new URLSearchParams({ userId, levelName: cfg.sumsubLevelName, ttlInSecs: '1200' });
  const r = await sumsubRequest(cfg, 'POST', `/resources/accessTokens?${q}`);
  if (typeof r.token !== 'string') throw new Error('Sumsub no devolvió token');
  return r.token;
}

/** Traduce la revisión de Sumsub a nuestro estado. */
export function mapReview(reviewStatus: string | undefined, reviewAnswer: string | undefined, rejectType: string | undefined): KycStatus {
  if (reviewAnswer === 'GREEN') return 'approved';
  if (reviewAnswer === 'RED') return rejectType === 'RETRY' ? 'retry' : 'rejected';
  if (reviewStatus === 'onHold') return 'on_hold';
  if (reviewStatus === 'pending' || reviewStatus === 'queued' || reviewStatus === 'prechecked') return 'pending';
  return 'started';
}

/** Consulta directa del solicitante por nuestro id (respaldo si el webhook no llegó). */
export async function fetchApplicantStatus(cfg: Config, userId: string): Promise<{ status: KycStatus; applicantId?: string; labels?: string[] } | null> {
  try {
    const a = await sumsubRequest(cfg, 'GET', `/resources/applicants/-;externalUserId=${encodeURIComponent(userId)}/one`);
    const rr = a?.review?.reviewResult ?? {};
    return { status: mapReview(a?.review?.reviewStatus, rr.reviewAnswer, rr.reviewRejectType), applicantId: a?.id, labels: rr.rejectLabels };
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null; // aún no existe el solicitante
    throw e;
  }
}

/** Verifica la firma del webhook (X-Payload-Digest + X-Payload-Digest-Alg) sobre el cuerpo crudo. */
export function verifyWebhook(raw: string, digest: string | undefined, alg: string | undefined, secret: string): boolean {
  if (!digest) return false;
  const algo = { HMAC_SHA1_HEX: 'sha1', HMAC_SHA256_HEX: 'sha256', HMAC_SHA512_HEX: 'sha512' }[alg ?? 'HMAC_SHA256_HEX'];
  if (!algo) return false;
  const expected = createHmac(algo, secret).update(raw).digest();
  const got = Buffer.from(digest, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Interpreta un evento del webhook. Devuelve null para eventos que no cambian el estado. */
export function parseWebhook(evt: any): { userId: string; applicantId?: string; status: KycStatus; labels?: string[]; type: string } | null {
  const userId = evt?.externalUserId;
  if (typeof userId !== 'string' || !userId) return null;
  const rr = evt.reviewResult ?? {};
  switch (evt.type) {
    case 'applicantCreated': return { userId, applicantId: evt.applicantId, status: 'started', type: evt.type };
    case 'applicantPending': return { userId, applicantId: evt.applicantId, status: 'pending', type: evt.type };
    case 'applicantOnHold': return { userId, applicantId: evt.applicantId, status: 'on_hold', type: evt.type };
    case 'applicantReset': return { userId, applicantId: evt.applicantId, status: 'started', type: evt.type };
    case 'applicantReviewed':
      return { userId, applicantId: evt.applicantId, status: mapReview('completed', rr.reviewAnswer, rr.reviewRejectType), labels: rr.rejectLabels, type: evt.type };
    default: return null;
  }
}

// ---- códigos de un solo uso para abrir kyc.html desde las apps

interface Launch { userId: string; exp: number; used: boolean; refreshKey: string }
const launches = new Map<string, Launch>();

export function createLaunchCode(userId: string): string {
  const now = Date.now();
  for (const [k, v] of launches) if (v.exp < now) launches.delete(k);
  const code = randomBytes(24).toString('base64url');
  launches.set(code, { userId, exp: now + 15 * 60 * 1000, used: false, refreshKey: randomBytes(24).toString('base64url') });
  return code;
}

/** Canjea el código (una sola vez). Devuelve el usuario y una llave para renovar el token durante la sesión. */
export function redeemLaunchCode(code: unknown): { userId: string; refreshKey: string } | null {
  if (typeof code !== 'string') return null;
  const l = launches.get(code);
  if (!l || l.used || l.exp < Date.now()) return null;
  l.used = true;
  return { userId: l.userId, refreshKey: l.refreshKey };
}

export function userForRefreshKey(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  for (const l of launches.values()) if (l.refreshKey === key && l.exp > Date.now() - 45 * 60 * 1000) return l.userId;
  return null;
}
