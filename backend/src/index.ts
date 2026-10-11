import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { authRepository } from "./modules/auth/repository.js";
import { registrationService } from "./modules/registration/service.js";
import { createMailer } from "./services/mail.js";
import { attendanceService } from "./modules/attendance/service.js";

import { eventsService } from "./modules/events/service.js";
import { complaintsService } from "./modules/complaints/service.js";

if (process.env.STORAGE_MODE && process.env.STORAGE_MODE !== "database")
  throw new Error("Only STORAGE_MODE=database is supported.");
const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const app = await createApp({
  config,
  auth: authRepository(db, config.nodeEnv !== "production", config.institutionalAuthMode),
  registration: registrationService(db, createMailer(config), config.appOrigin, config.institutionalAuthMode, config.nodeEnv !== "production"),
  attendance: attendanceService(db, config.institutionalAuthMode, config.nodeEnv !== "production"),
  events: eventsService(db, undefined, config.institutionalAuthMode),
  complaints: complaintsService(db, config.nodeEnv !== "production", config.institutionalAuthMode),
  checkDatabase: async () => {
    await db.$queryRaw`SELECT 1`;
  },
});
if (config.institutionalAuthMode === "domain-only-demo")
  console.warn("INSECURE academic demo: email domain eligibility does not verify mailbox ownership or institutional identity. Admins must verify identity out of band.");
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
