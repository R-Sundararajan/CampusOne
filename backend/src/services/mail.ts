import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import nodemailer from "nodemailer";
import { z } from "zod";
import type { Config } from "../config.js";

export type VerificationMail = { to: string; url: string };
export type Mailer = (mail: VerificationMail) => Promise<void>;

export function createMailer(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): Mailer {
  // Never validate SMTP or create a transport in the explicitly configured demo mode.
  if (config.institutionalAuthMode === "domain-only-demo") return async () => {};
  const mode =
    env.MAIL_MODE ?? (config.nodeEnv === "production" ? "smtp" : "development");
  if (mode === "development") {
    if (
      config.nodeEnv === "production" ||
      !["localhost", "127.0.0.1"].includes(new URL(config.appOrigin).hostname)
    ) {
      throw new Error(
        "Development mail requires a local, non-production application",
      );
    }
    return async (mail) => {
      const directory = path.resolve("../.local-mail");
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, randomUUID() + ".txt"),
        "DEVELOPMENT ONLY — not sent by email.\nTo: " +
          mail.to +
          "\n\nVerify your CampusOne email (expires in 30 minutes):\n" +
          mail.url +
          "\n",
        { mode: 0o600 },
      );
    };
  }
  if (mode !== "smtp") throw new Error("MAIL_MODE must be smtp or development");
  const result = z
    .object({
      SMTP_HOST: z.string().min(1),
      SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
      SMTP_USER: z.string().min(1),
      SMTP_PASSWORD: z.string().min(1),
      SMTP_FROM: z.email(),
    })
    .safeParse(env);
  if (!result.success)
    throw new Error(
      "SMTP configuration is incomplete: " +
        result.error.issues.map((i) => i.path.join(".")).join(", "),
    );
  const value = result.data;
  const transport = nodemailer.createTransport({
    host: value.SMTP_HOST,
    port: value.SMTP_PORT,
    secure: value.SMTP_PORT === 465,
    requireTLS: true,
    auth: { user: value.SMTP_USER, pass: value.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return async (mail) => {
    await transport.sendMail({
      from: value.SMTP_FROM,
      to: mail.to,
      subject: "Verify your CampusOne email",
      text:
        "Verify your institutional email to continue with CampusOne. This link expires in 30 minutes and works once.\n\n" +
        mail.url +
        "\n\nIf you did not request this, ignore this email.",
    });
  };
}
