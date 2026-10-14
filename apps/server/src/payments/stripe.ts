// Stripe Checkout + Webhooks, solo para productos cosméticos sin valor de canje.
// Sin SDK: llamadas HTTPS directas a la API de Stripe y verificación de firma de webhooks
// según el esquema oficial (t=timestamp, v1=HMAC-SHA256(secret, `${t}.${payload}`)).
// No se manejan números de tarjeta ni CVV: el pago ocurre en la página alojada por Stripe.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Store } from '../store.ts';
import type { Config } from '../config.ts';

/** Catálogo cosmético. Ninguno da ventaja competitiva ni se convierte en fichas, saldo o apuestas. */
export const PRODUCTS = {
  theme_selva: { name: 'Tema Selva Maya', amount: 4900, currency: 'mxn', kind: 'theme' },
  theme_cenote: { name: 'Tema Cenote', amount: 4900, currency: 'mxn', kind: 'theme' },
  tiles_jade: { name: 'Fichas de Jade', amount: 3900, currency: 'mxn', kind: 'tiles' },
  avatar_pack: { name: 'Paquete de Avatares EKO', amount: 2900, currency: 'mxn', kind: 'avatar' },
  supporter_month: { name: 'Membresía Simpatizante (mensual, solo estética)', amount: 5900, currency: 'mxn', kind: 'subscription' },
} as const;
export type ProductId = keyof typeof PRODUCTS;

export function stripeMode(cfg: Config): 'disabled' | 'test' | 'live' | 'blocked_live' {
  const k = cfg.stripeSecretKey;
  if (!k) return 'disabled';
  if (k.startsWith('sk_test_') || k.startsWith('rk_test_')) return 'test';
  if (k.startsWith('sk_live_') || k.startsWith('rk_live_')) return cfg.stripeLiveApproved ? 'live' : 'blocked_live';
  return 'disabled';
}

async function stripeRequest(cfg: Config, path: string, params: Record<string, string>, idempotencyKey?: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: new URLSearchParams(params),
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(json?.error?.message ?? `Stripe ${res.status}`);
  return json;
}

export async function createCheckout(cfg: Config, store: Store, userId: string, productId: string, requestId: string) {
  const mode = stripeMode(cfg);
  if (mode === 'disabled') throw new Error('Pagos no configurados');
  if (mode === 'blocked_live') throw new Error('Modo producción de Stripe no aprobado (STRIPE_LIVE_APPROVED)');
  const p = PRODUCTS[productId as ProductId];
  if (!p) throw new Error('Producto inexistente');
  const isSub = p.kind === 'subscription';
  const params: Record<string, string> = {
    mode: isSub ? 'subscription' : 'payment',
    success_url: `${cfg.publicUrl}/?compra=ok&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${cfg.publicUrl}/?compra=cancelada`,
    client_reference_id: userId,
    'metadata[user_id]': userId,
    'metadata[product]': productId,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': p.currency,
    'line_items[0][price_data][unit_amount]': String(p.amount),
    'line_items[0][price_data][product_data][name]': p.name,
    ...(isSub ? { 'line_items[0][price_data][recurring][interval]': 'month' } : {}),
  };
  // Idempotency-Key evita sesiones duplicadas si el cliente reintenta la misma solicitud.
  const session = await stripeRequest(cfg, 'checkout/sessions', params, `chk_${userId}_${requestId}`);
  if (!store.purchaseBySession(session.id)) store.createPurchase(userId, productId, p.amount, p.currency, session.id);
  return { url: session.url as string, id: session.id as string };
}

export function verifyStripeSignature(payload: string, header: string | undefined, secret: string, toleranceSec = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map(kv => kv.split('=') as [string, string]).filter(x => x.length === 2));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest();
  const sigs = header.split(',').filter(x => x.startsWith('v1=')).map(x => Buffer.from(x.slice(3), 'hex'));
  return sigs.some(s => s.length === expected.length && timingSafeEqual(s, expected));
}

/** Procesa un webhook ya verificado. Idempotente: un mismo evento nunca se aplica dos veces. */
export function handleStripeEvent(store: Store, event: any): { status: 'ignored_duplicate' | 'processed' | 'ignored'; detail?: string } {
  if (!event?.id || !event?.type) return { status: 'ignored', detail: 'evento inválido' };
  if (store.markStripeEvent(event.id, event.type)) return { status: 'ignored_duplicate' };
  const obj = event.data?.object ?? {};
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const purchase = store.purchaseBySession(obj.id);
      if (!purchase) { store.logError('stripe', `sesión desconocida ${obj.id}`); return { status: 'ignored', detail: 'sesión desconocida' }; }
      if (obj.payment_status !== 'paid' && obj.mode !== 'subscription') return { status: 'ignored', detail: 'pago no confirmado' };
      if (purchase.status === 'paid') return { status: 'ignored', detail: 'ya pagado' };
      if (obj.amount_total != null && obj.amount_total !== purchase.amount) {
        store.logError('stripe', `monto inesperado en ${obj.id}`);
        return { status: 'ignored', detail: 'monto no coincide' };
      }
      store.setPurchaseStatus(obj.id, 'paid', event.id);
      store.addCosmetic(purchase.user_id, purchase.product);
      store.audit('purchase_paid', { session: obj.id, user: purchase.user_id, product: purchase.product, amount: purchase.amount });
      return { status: 'processed' };
    }
    case 'checkout.session.expired': {
      if (store.purchaseBySession(obj.id)) store.setPurchaseStatus(obj.id, 'expired', event.id);
      return { status: 'processed' };
    }
    case 'charge.refunded': {
      const session = obj.metadata?.checkout_session ?? obj.checkout_session;
      const purchase = session ? store.purchaseBySession(session) : null;
      if (purchase) {
        store.setPurchaseStatus(session, 'refunded', event.id);
        store.removeCosmetic(purchase.user_id, purchase.product);
        store.audit('purchase_refunded', { session, user: purchase.user_id });
      }
      return { status: 'processed' };
    }
    default:
      return { status: 'ignored', detail: event.type };
  }
}
