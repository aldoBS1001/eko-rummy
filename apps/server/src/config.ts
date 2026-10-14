// Configuración desde variables de entorno. Ningún secreto vive en el código.
import { randomBytes } from 'node:crypto';

const env = process.env;
const bool = (v: string | undefined, d = false) => (v === undefined ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  publicUrl: string;
  dbPath: string;
  databaseUrl?: string;
  authSecret: string;
  adminUsers: string[];
  turnSeconds: number;
  reconnectGraceSeconds: number;
  quickMatchBotFillSeconds: number;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripeLiveApproved: boolean;
  tronNetwork: 'mainnet' | 'nile';
  tronApiKey?: string;
  ekokiinContract: string;
  sumsubAppToken?: string;
  sumsubSecretKey?: string;
  sumsubWebhookSecret?: string;
  sumsubLevelName: string;
  sumsubBaseUrl: string;
  sumsubWebsdkUrl: string;
  bettingEnabled: boolean;
  complianceFile: string;
  staticDir: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const nodeEnv = (env.NODE_ENV as Config['env']) ?? 'development';
  const secret = env.AUTH_SECRET ?? (nodeEnv === 'production' ? '' : randomBytes(32).toString('hex'));
  if (nodeEnv === 'production' && (!secret || secret.length < 32)) throw new Error('AUTH_SECRET (≥32 caracteres) es obligatorio en producción');
  const cfg: Config = {
    env: nodeEnv,
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:8080',
    dbPath: env.DB_PATH ?? './data/eko-rummy.sqlite',
    databaseUrl: env.DATABASE_URL,
    authSecret: secret,
    adminUsers: (env.ADMIN_USERS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    turnSeconds: Number(env.TURN_SECONDS ?? 90),
    reconnectGraceSeconds: Number(env.RECONNECT_GRACE_SECONDS ?? 60),
    quickMatchBotFillSeconds: Number(env.QUICK_MATCH_BOT_FILL_SECONDS ?? 30),
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    stripeLiveApproved: bool(env.STRIPE_LIVE_APPROVED),
    tronNetwork: env.TRON_NETWORK === 'nile' ? 'nile' : 'mainnet',
    tronApiKey: env.TRON_API_KEY,
    ekokiinContract: env.EKOKIIN_CONTRACT ?? 'TMNKYEbXGJGFPaZXs8tBER6gMiRvjKtUiU',
    sumsubAppToken: env.SUMSUB_APP_TOKEN,
    sumsubSecretKey: env.SUMSUB_SECRET_KEY,
    sumsubWebhookSecret: env.SUMSUB_WEBHOOK_SECRET,
    sumsubLevelName: env.SUMSUB_LEVEL_NAME ?? 'basic-kyc-level',
    sumsubBaseUrl: env.SUMSUB_BASE_URL ?? 'https://api.sumsub.com',
    sumsubWebsdkUrl: env.SUMSUB_WEBSDK_URL ?? 'https://static.sumsub.com/idensic/static/sns-websdk-builder.js',
    bettingEnabled: bool(env.BETTING_ENABLED),
    complianceFile: env.COMPLIANCE_FILE ?? './compliance/approvals.json',
    staticDir: env.STATIC_DIR ?? new URL('../../web/dist', import.meta.url).pathname,
    ...overrides,
  };
  return cfg;
}
