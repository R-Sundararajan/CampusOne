import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import argon2 from "argon2";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { AuthRepository, PublicUser } from "./repository.js";
import { issueToken, tokenLifetimeSeconds, verifyToken } from "./tokens.js";

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export const authCookie = "campusone_token";
const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
export const hashPassword = (password: string) =>
  argon2.hash(password, passwordOptions);
const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(1).max(128),
  })
  .strict();

export function authentication(repo: AuthRepository, secret: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[authCookie];
    if (typeof token !== "string") {
      res.status(401).json({ error: "Login required" });
      return;
    }
    let userId: string;
    try {
      userId = await verifyToken(token, secret);
    } catch {
      res.status(401).json({ error: "Login expired or invalid" });
      return;
    }
    // Database errors propagate as 500, rather than being misreported as an expired login.
    const user = await repo.findActiveUser(userId);
    if (!user) {
      res.status(401).json({ error: "Account unavailable" });
      return;
    }
    req.user = user;
    next();
  };
}

export function requireRoles(...roles: PublicUser["roles"]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Login required" });
      return;
    }
    if (!roles.some((role) => req.user!.roles.includes(role))) {
      res.status(403).json({ error: "You do not have access to this feature" });
      return;
    }
    next();
  };
}

export async function authRoutes(repo: AuthRepository, config: Config) {
  const router = Router();
  const authenticate = authentication(repo, config.jwtSecret);
  const cookieOptions = {
    httpOnly: true,
    secure: new URL(config.appOrigin).protocol === "https:",
    sameSite: "lax" as const,
    path: "/api",
  };
  // Verify a hash even for unknown emails to avoid an obvious account-existence timing leak.
  const dummyHash = await hashPassword(randomBytes(32).toString("hex"));
  router.post(
    "/login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      message: {
        error: "Too many failed login attempts. Try again in 15 minutes.",
      },
    }),
    async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Enter a valid email and password" });
        return;
      }
      const user = await repo.findForLogin(parsed.data.email);
      const validPassword = await argon2.verify(
        user?.passwordHash ?? dummyHash,
        parsed.data.password,
      );
      if (!user || !validPassword) {
        res
          .status(401)
          .json({
            error:
              "Unable to sign in. Check your email and password, verify your email, and ensure any required approval is complete.",
          });
        return;
      }
      const token = await issueToken(user.id, config.jwtSecret);
      res.cookie(authCookie, token, {
        ...cookieOptions,
        maxAge: tokenLifetimeSeconds * 1000,
      });
      const { passwordHash: _, ...publicUser } = user;
      res.json({ user: publicUser });
    },
  );
  router.post("/logout", (_req, res) => {
    res.clearCookie(authCookie, cookieOptions);
    res.status(204).end();
  });
  router.get("/me", authenticate, (req, res) => res.json({ user: req.user }));
  router.get("/admin-check", authenticate, requireRoles("ADMIN"), (_req, res) =>
    res.json({ allowed: true }),
  );
  return router;
}
