import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { createDatabase } from "../src/db.js";
import { hashPassword } from "../src/modules/auth/routes.js";
import { institutionalEmail } from "../src/modules/registration/validation.js";
loadEnv({ path: [".env", "../.env"], quiet: true });

// Trusted operator command, never an HTTP route. Verify identity out of band first.
const result = z
  .object({
    DATABASE_URL: z.string().min(1),
    ADMIN_EMAIL: institutionalEmail,
    ADMIN_NAME: z.string().trim().min(2).max(100),
    ADMIN_PASSWORD: z.string().min(12).max(128),
    INSTITUTIONAL_AUTH_MODE: z.enum(["email-verification", "domain-only-demo"]).default("email-verification"),
  })
  .safeParse(process.env);
if (!result.success)
  throw new Error(
    "Bootstrap requires DATABASE_URL, ADMIN_EMAIL (@ssn.edu.in), ADMIN_NAME and ADMIN_PASSWORD (12–128 characters)",
  );
const env = result.data;
const db = createDatabase(env.DATABASE_URL);
try {
  // Refuse to elevate or reset a pre-existing public account by accident.
  if (await db.user.findUnique({ where: { email: env.ADMIN_EMAIL } }))
    throw new Error("Account already exists; bootstrap will not modify it");
  await db.user.create({
    data: {
      name: env.ADMIN_NAME,
      email: env.ADMIN_EMAIL,
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      roles: ["ADMIN"],
      department: "",
      // In demo mode, trusted identity review must not be recorded as mailbox verification.
      emailVerifiedAt: env.INSTITUTIONAL_AUTH_MODE === "domain-only-demo" ? null : new Date(),
    },
  });
  console.log(
    "Admin created by trusted bootstrap. Remove bootstrap credentials from the environment.",
  );
} finally {
  await db.$disconnect();
}
