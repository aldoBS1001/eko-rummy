import { loadConfig } from './config.ts';
import { createApp } from './app.ts';

const cfg = loadConfig();
const app = createApp(cfg);
const port = await app.listen();
console.log(`EKO RUMMY escuchando en http://${cfg.host}:${port} (${cfg.env})`);

const stop = async (sig: string) => {
  console.log(`${sig}: cerrando…`);
  await app.close();
  app.store.db.close();
  process.exit(0);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('uncaughtException', e => { console.error(e); app.store.logError('uncaught', String(e.stack ?? e)); });
process.on('unhandledRejection', e => { console.error(e); app.store.logError('unhandled', String(e)); });
