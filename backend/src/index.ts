import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { authRepository } from "./modules/auth/repository.js";
import { registrationService } from "./modules/registration/service.js";
import { createMailer } from "./services/mail.js";

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const app = await createApp({
  config,
  auth: authRepository(db, config.nodeEnv !== "production"),
  registration: registrationService(db, createMailer(config), config.appOrigin),
  checkDatabase: async () => {
    await db.$queryRaw`SELECT 1`;
  },
});
const server = app.listen(
  config.port,
  config.host ?? (config.nodeEnv === "production" ? "0.0.0.0" : "127.0.0.1"),
  () => {
    console.log(`CampusOne listening on port ${config.port}`);
  },
);

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
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
