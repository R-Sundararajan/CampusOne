import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
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
  router.get("/auth/policy", (_req, res) => res.json({ institutionalAuthMode: config.institutionalAuthMode ?? "email-verification" }));
  router.post("/auth/register", registrationLimit, async (req, res) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Use a valid @ssn.edu.in email, a full name, an allowed account type and matching passwords of 12–128 characters.",
      });
      return;
    }
    await service.register(parsed.data);
    res.status(202).json(accepted);
  });
  router.post(
    "/auth/verification/resend",
    registrationLimit,
    async (req, res) => {
      const parsed = z
        .object({ email: institutionalEmail })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Enter a valid @ssn.edu.in email." });
        return;
      }
      await service.resend(parsed.data.email);
      res.status(202).json(accepted);
    },
  );
  router.post("/auth/verify", verificationLimit, async (req, res) => {
    const parsed = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Verification link is invalid or expired. Request a new link.",
      });
      return;
    }
    res.json(await service.verify(parsed.data.token));
  });
  router.get("/auth/role-requests", authenticate, async (req, res) =>
    res.json({ requests: await service.mine(req.user!.id) }),
  );
  router.post(
    "/auth/role-requests",
    authenticate,
    registrationLimit,
    async (req, res) => {
      const parsed = z
        .object({ role: requestableRole })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Request Staff or Club Head access only." });
        return;
      }
      await service.requestRole(req.user!.id, parsed.data.role);
      res.status(201).json({ message: "Request submitted for review" });
    },
  );
  router.get(
    "/admin/role-requests",
    authenticate,
    requireRoles("ADMIN"),
    async (_req, res) => res.json(await service.inbox()),
  );
  router.post(
    "/admin/role-requests/:id/decision",
    authenticate,
    requireRoles("ADMIN"),
    async (req, res) => {
      const parsed = decisionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error:
            "Provide an allowed decision, valid assignments, and a reason for rejection.",
        });
        return;
      }
      await service.decide(String(req.params.id), req.user!.id, parsed.data);
      res.status(204).end();
    },
  );
  router.get(
    "/admin/club-access",
    authenticate,
    requireRoles("ADMIN"),
    async (_req, res) => res.json(await service.clubAccess()),
  );
  router.post(
    "/admin/club-access",
    authenticate,
    requireRoles("ADMIN"),
    async (req, res) => {
      const input = z
        .object({
          userId: z.string().min(1).max(100),
          clubId: z.string().min(1).max(100),
          active: z.boolean(),
          reason: z.string().trim().min(3).max(500),
          identityConfirmed: z.boolean().optional(),
        })
        .strict()
        .safeParse(req.body);
      if (!input.success) {
        res
          .status(400)
          .json({
            error:
              "Select a Club Head and club, and give a reason for this access change.",
          });
        return;
      }
      await service.changeClubAccess(req.user!.id, input.data);
      res.status(204).end();
    },
  );
  return router;
}
