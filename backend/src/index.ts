import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { authRepository } from './modules/auth/repository.js';

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const app = await createApp({
  config, auth: authRepository(db),
  checkDatabase: async () => { await db.$queryRaw`SELECT 1`; },
});
const server = app.listen(config.port, config.nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`CampusOne listening on port ${config.port}`);
});

let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    await db.$disconnect();
    clearTimeout(timeout);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
