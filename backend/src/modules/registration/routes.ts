import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { textField } from "../../validation/text.js";
import { parseInput } from "../../validation/parse.js";
import { emptyQuerySchema } from "../../validation/query.js";
import type { Config } from "../../config.js";
import type { AuthRepository } from "../auth/repository.js";
import { authentication, requireRoles } from "../auth/routes.js";
import type { RegistrationService } from "./service.js";
import {
  decisionSchema,
  institutionalEmail,
  registrationSchema,
  requestableRole,
} from "./validation.js";

export function registrationRoutes(
  service: RegistrationService,
  repo: AuthRepository,
  config: Config,
) {
  const router = Router();
  const authenticate = authentication(repo, config.jwtSecret);
  const registrationLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Try again in 15 minutes." },
  });
  const verificationLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many verification attempts. Try again in 15 minutes.",
    },
  });
  const accepted = {
    message:
      config.institutionalAuthMode === "domain-only-demo"
        ? "If this address is new and eligible, Student access is ready to sign in. Staff and Club Head requests require Admin approval. No verification email is sent."
        : "If this address is eligible, check its inbox for a verification link.",
  };
  router.get("/auth/policy", (req, res) => { parseInput(emptyQuerySchema, req.query); res.json({ institutionalAuthMode: config.institutionalAuthMode ?? "email-verification" }); });
  router.post("/auth/register", registrationLimit, async (req, res) => {
    await service.register(parseInput(registrationSchema, req.body));
    res.status(202).json(accepted);
  });
  router.post(
    "/auth/verification/resend",
    registrationLimit,
    async (req, res) => {
      const input = parseInput(z
        .object({ email: institutionalEmail })
        .strict(), req.body);
      await service.resend(input.email);
      res.status(202).json(accepted);
    },
  );
  router.post("/auth/verify", verificationLimit, async (req, res) => {
    const input = parseInput(z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict(), req.body);
    res.json(await service.verify(input.token));
  });
  router.get("/auth/role-requests", authenticate, async (req, res) => {
    parseInput(emptyQuerySchema, req.query);
    res.json({ requests: await service.mine(req.user!.id) });
  });
  router.post(
    "/auth/role-requests",
    authenticate,
    registrationLimit,
    async (req, res) => {
      const input = parseInput(z
        .object({ role: requestableRole })
        .strict(), req.body);
      await service.requestRole(req.user!.id, input.role);
      res.status(201).json({ message: "Request submitted for review" });
    },
  );
  router.get(
    "/admin/role-requests",
    authenticate,
    requireRoles("ADMIN"),
    async (req, res) => { parseInput(emptyQuerySchema, req.query); res.json(await service.inbox()); },
  );
  router.post(
    "/admin/role-requests/:id/decision",
    authenticate,
    requireRoles("ADMIN"),
    async (req, res) => {
      await service.decide(String(req.params.id), req.user!.id, parseInput(decisionSchema, req.body));
      res.status(204).end();
    },
  );
  router.get(
    "/admin/club-access",
    authenticate,
    requireRoles("ADMIN"),
    async (req, res) => { parseInput(emptyQuerySchema, req.query); res.json(await service.clubAccess()); },
  );
  router.post("/admin/clubs", authenticate, requireRoles("ADMIN"), async (req, res) => {
    const input = parseInput(z.object({ name: textField({ min: 3, max: 100 }) }).strict(), req.body);
    res.status(201).json(await service.createClub(req.user!.id, input.name));
  });
  router.post(
    "/admin/club-access",
    authenticate,
    requireRoles("ADMIN"),
    async (req, res) => {
      const input = parseInput(z
        .object({
          userId: textField({ min: 1, max: 100 }),
          clubId: textField({ min: 1, max: 100 }),
          active: z.boolean(),
          reason: textField({ min: 3, max: 500, multiline: true }),
          identityConfirmed: z.boolean().optional(),
          syntheticIdentityAttested: z.boolean().optional(),
        }).strict()
        .superRefine((value, ctx) => {
          if (value.identityConfirmed && value.syntheticIdentityAttested)
            ctx.addIssue({ code: "custom", path: ["syntheticIdentityAttested"], message: "Choose one identity basis." });
          if (!value.active && (value.identityConfirmed || value.syntheticIdentityAttested))
            ctx.addIssue({ code: "custom", path: ["active"], message: "Identity confirmation applies only when granting access." });
        }), req.body);
      await service.changeClubAccess(req.user!.id, input);
      res.status(204).end();
    },
  );
  return router;
}
