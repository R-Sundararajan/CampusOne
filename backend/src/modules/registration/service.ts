import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";
import { hashPassword } from "../auth/routes.js";
import type { Mailer } from "../../services/mail.js";
import type { Decision, Registration, RequestedRole } from "./validation.js";

export class AccountError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const requestSelection = {
  id: true,
  role: true,
  status: true,
  reason: true,
  createdAt: true,
} as const;
const lockUser = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;

export function registrationService(
  db: PrismaClient,
  mailer: Mailer,
  origin: string,
) {
  async function sendVerification(userId: string) {
    const token = randomBytes(32).toString("hex");
    const user = await db.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.emailVerifiedAt || !user.active || user.isDemo)
        return null;
      const previous = await tx.emailVerification.findUnique({
        where: { userId },
      });
      // Per-account throttle complements the process-local IP rate limit.
      if (previous && previous.createdAt.getTime() > Date.now() - 60_000)
        return null;
      await tx.emailVerification.upsert({
        where: { userId },
        create: {
          userId,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
        update: {
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 30 * 60_000),
          createdAt: new Date(),
        },
      });
      return user;
    });
    if (!user) return;
    try {
      await mailer({
        to: user.email,
        url: origin + "/verify-email#token=" + token,
      });
    } catch {
      // Permit a resend after delivery failure. Keep the account unverified.
      await db.emailVerification.deleteMany({
        where: { userId, tokenHash: tokenHash(token) },
      });
      console.error("Verification delivery failed; check mail configuration");
    }
  }

  return {
    async register(input: Registration) {
      // Hash even for duplicates; never overwrite an existing account or reveal its status.
      const passwordHash = await hashPassword(input.password);
      let userId: string;
      try {
        const user = await db.user.create({
          data: {
            name: input.fullName,
            email: input.email,
            passwordHash,
            department: "",
            roles: [],
            requestedAccountType: input.accountType,
            ...(input.accountType === "STUDENT"
              ? {}
              : { roleRequests: { create: { role: input.accountType } } }),
          },
        });
        userId = user.id;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        )
          return;
        throw error;
      }
      await sendVerification(userId);
    },
    async resend(email: string) {
      const user = await db.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (user) await sendVerification(user.id);
    },
    async verify(token: string) {
      const hash = tokenHash(token);
      return db.$transaction(async (tx) => {
        const verification = await tx.emailVerification.findUnique({
          where: { tokenHash: hash },
        });
        if (!verification)
          throw new AccountError(
            400,
            "Verification link is invalid or expired. Request a new link.",
          );
        await lockUser(tx, verification.userId);
        const user = await tx.user.findUniqueOrThrow({
          where: { id: verification.userId },
        });
        const claimed = await tx.emailVerification.deleteMany({
          where: { tokenHash: hash, expiresAt: { gt: new Date() } },
        });
        if (!claimed.count || user.emailVerifiedAt || !user.active)
          throw new AccountError(
            400,
            "Verification link is invalid or expired. Request a new link.",
          );
        const student = user.requestedAccountType === "STUDENT";
        await tx.user.update({
          where: { id: user.id },
          data: {
            emailVerifiedAt: new Date(),
            ...(student ? { roles: ["STUDENT"] } : {}),
          },
        });
        return { status: student ? "ready" : "pending_approval" };
      });
    },
    mine(userId: string) {
      return db.roleRequest.findMany({
        where: { userId },
        select: requestSelection,
        orderBy: { createdAt: "desc" },
      });
    },
    async requestRole(userId: string, role: RequestedRole) {
      await db.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (!user.active || !user.emailVerifiedAt)
          throw new AccountError(403, "Verified account required");
        if (user.roles.includes(role))
          throw new AccountError(409, "You already have this role");
        const existing = await tx.roleRequest.findUnique({
          where: { userId_role: { userId, role } },
        });
        if (existing?.status === "PENDING")
          throw new AccountError(
            409,
            "This request is already awaiting review",
          );
        await tx.roleRequest.upsert({
          where: { userId_role: { userId, role } },
          create: { userId, role },
          update: {
            status: "PENDING",
            reason: null,
            reviewedAt: null,
            reviewedById: null,
            createdAt: new Date(),
          },
        });
      });
    },
    async inbox() {
      const [requests, clubs, offerings] = await Promise.all([
        db.roleRequest.findMany({
          where: {
            status: "PENDING",
            user: { active: true, emailVerifiedAt: { not: null } },
          },
          select: {
            ...requestSelection,
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        db.club.findMany({
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        db.courseOffering.findMany({
          include: { subject: true, classGroup: true },
        }),
      ]);
      return {
        requests,
        clubs,
        offerings: offerings.map((o) => ({
          id: o.id,
          label: [
            o.subject.code,
            o.subject.name,
            o.classGroup.name,
            o.classGroup.section,
            o.classGroup.academicYear,
          ].join(" · "),
        })),
      };
    },
    async decide(requestId: string, actorId: string, decision: Decision) {
      await db.$transaction(async (tx) => {
        const request = await tx.roleRequest.findUnique({
          where: { id: requestId },
        });
        if (!request) throw new AccountError(404, "Request not found");
        if (request.userId === actorId)
          throw new AccountError(
            403,
            "You cannot approve your own access request",
          );
        await lockUser(tx, request.userId);
        const user = await tx.user.findUniqueOrThrow({
          where: { id: request.userId },
        });
        const actor = await tx.user.findUnique({ where: { id: actorId } });
        if (
          !actor?.active ||
          !actor.emailVerifiedAt ||
          !actor.roles.includes("ADMIN")
        )
          throw new AccountError(403, "Admin access required");
        if (!user.active || !user.emailVerifiedAt)
          throw new AccountError(
            409,
            "Applicant must verify their email first",
          );
        const claimed = await tx.roleRequest.updateMany({
          where: { id: requestId, status: "PENDING" },
          data: {
            status: decision.decision,
            reviewedAt: new Date(),
            reviewedById: actorId,
            reason: decision.decision === "REJECTED" ? decision.reason : null,
          },
        });
        if (!claimed.count)
          throw new AccountError(409, "This request has already been reviewed");
        if (decision.decision === "APPROVED") {
          if (request.role === "CLUB_HEAD") {
            if (!decision.clubId || decision.offeringIds.length)
              throw new AccountError(
                400,
                "Select a club for Club Head approval",
              );
            if (!(await tx.club.findUnique({ where: { id: decision.clubId } })))
              throw new AccountError(400, "Club not found");
            await tx.clubAssignment.upsert({
              where: {
                userId_clubId: { userId: user.id, clubId: decision.clubId },
              },
              update: {},
              create: { userId: user.id, clubId: decision.clubId },
            });
          } else if (request.role === "STAFF") {
            if (decision.clubId)
              throw new AccountError(
                400,
                "Staff approval cannot grant club access",
              );
            const ids = [...new Set(decision.offeringIds)];
            if (
              (await tx.courseOffering.count({
                where: { id: { in: ids } },
              })) !== ids.length
            )
              throw new AccountError(400, "Teaching assignment not found");
            await tx.teachingAssignment.createMany({
              data: ids.map((offeringId) => ({ staffId: user.id, offeringId })),
              skipDuplicates: true,
            });
          } else {
            throw new AccountError(
              400,
              "This role cannot be approved publicly",
            );
          }
          if (!user.roles.includes(request.role))
            await tx.user.update({
              where: { id: user.id },
              data: { roles: { push: request.role } },
            });
        }
        await tx.auditLog.create({
          data: {
            actorId,
            action: "ROLE_REQUEST_" + decision.decision,
            entityType: "RoleRequest",
            entityId: requestId,
            changes: { userId: user.id, role: request.role, ...decision },
          },
        });
      });
    },
  };
}
export type RegistrationService = ReturnType<typeof registrationService>;
