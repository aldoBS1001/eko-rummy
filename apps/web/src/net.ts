// Comunicación con el servidor: API REST y sesión.
import { settings, lsGet, lsSet, lsDel } from './util.ts';

export interface Session { token: string; user: { id: string; name: string; role: 'guest' | 'player' | 'admin' } }

declare const __DEFAULT_SERVER__: string;
/** Servidor fijado al compilar (apps instaladas). Vacío = mismo sitio. */
const DEFAULT_SERVER = typeof __DEFAULT_SERVER__ !== 'undefined' ? __DEFAULT_SERVER__ : '';
export const IS_DESKTOP_APP = location.hostname === '127.0.0.1' && location.port === '47831';

export function apiBase(): string {
  if (settings.serverUrl) return settings.serverUrl.replace(/\/$/, '');
  if (DEFAULT_SERVER) return DEFAULT_SERVER.replace(/\/$/, '');
  if (IS_DESKTOP_APP) return '';
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return '';
}
export function wsUrl(): string {
  const b = apiBase();
  return b.replace(/^http/, 'ws') + '/ws';
}

export let session: Session | null = (() => { try { return JSON.parse(lsGet('eko.session') ?? 'null'); } catch { return null; } })();
export function setSession(s: Session | null) { session = s; if (s) lsSet('eko.session', JSON.stringify(s)); else lsDel('eko.session'); }

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const base = apiBase();
  if (!base) throw new Error('Servidor no configurado');
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch { throw new Error('No hay conexión con el servidor de EKO RUMMY'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session) setSession(null);
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data as T;
}

let online: boolean | null = null;
/** ¿Hay servidor de partidas disponible? (en la vista previa publicada no lo hay) */
export async function serverAvailable(): Promise<boolean> {
  if (online !== null) return online;
  try { const r = await api('GET', '/api/health'); online = !!r.ok; } catch { online = false; }
  setTimeout(() => (online = null), 15000);
  return online;
}

export async function ensureSession(): Promise<Session> {
  if (session) return session;
  const r = await api<Session>('POST', '/api/auth/guest', { name: settings.name || undefined });
  setSession(r);
  return r;
}
