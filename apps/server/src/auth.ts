// Autenticación: contraseñas con scrypt (sal por usuario, comparación en tiempo constante)
// y tokens firmados HMAC-SHA256 con expiración. Los invitados reciben un token sin cuenta.

import { scryptSync, randomBytes, timingSafeEqual, createHmac, randomUUID } from 'node:crypto';

export interface TokenPayload { sub: string; name: string; role: 'guest' | 'player' | 'admin'; exp: number; jti: string }

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const expected = Buffer.from(h, 'base64');
  const got = scryptSync(pw.normalize('NFKC'), Buffer.from(s, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, got);
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signToken(p: Omit<TokenPayload, 'exp' | 'jti'>, secret: string, ttlSeconds = 60 * 60 * 24 * 7): string {
  const payload: TokenPayload = { ...p, exp: Math.floor(Date.now() / 1000) + ttlSeconds, jti: randomUUID() };
  const body = b64(JSON.stringify(payload));
  const sig = b64(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token: unknown, secret: string): TokenPayload | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    if (typeof p.exp !== 'number' || p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}

export const USERNAME_RE = /^[a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ]{3,20}$/;

export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) return 'Usuario de 3 a 20 caracteres (letras, números o _)';
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return 'La contraseña debe tener entre 8 y 128 caracteres';
  return null;
}

/** Limitador de ritmo por clave (IP, usuario, conexión): cubeta de fichas. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private capacity: number;
  private refillPerSec: number;
  constructor(capacity: number, refillPerSec: number) { this.capacity = capacity; this.refillPerSec = refillPerSec; }
  take(key: string, cost = 1): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSec);
    b.at = now;
    if (b.tokens < cost) { this.buckets.set(key, b); return false; }
    b.tokens -= cost;
    this.buckets.set(key, b);
    if (this.buckets.size > 50000) this.buckets.clear();
    return true;
  }
}
