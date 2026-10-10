import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { PublicUser } from "../auth/repository.js";
import { AccountError } from "../registration/service.js";
type DB = PrismaClient | Prisma.TransactionClient;
import type { InstitutionalAuthMode } from "../../config.js";
import { accountEligible } from "../auth/account-policy.js";
export async function currentUser(db: DB, user: PublicUser, mode: InstitutionalAuthMode = "email-verification") {
  const found = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, roles: true, active: true, emailVerifiedAt: true, email: true, isDemo: true },
  });
  if (!accountEligible(found, mode) || !found)
    throw new AccountError(403, "Eligible active account required.");
  return found;
}
export async function managedClubs(db: DB, user: PublicUser, mode: InstitutionalAuthMode = "email-verification") {
  const u = await currentUser(db, user, mode);
  if (u.roles.includes("ADMIN"))
    return db.club.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  if (!u.roles.includes("CLUB_HEAD")) return [];
  return db.club.findMany({
    where: { assignments: { some: { userId: u.id } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
export async function requireClub(db: DB, user: PublicUser, clubId: string, mode: InstitutionalAuthMode = "email-verification") {
  const u = await currentUser(db, user, mode);
  if (u.roles.includes("ADMIN")) return;
  if (
    !u.roles.includes("CLUB_HEAD") ||
    !(await db.clubAssignment.findUnique({
      where: { userId_clubId: { userId: u.id, clubId } },
    }))
  )
    throw new AccountError(
      403,
      "You no longer have access to manage this club.",
    );
}
export async function canManage(db: DB, user: PublicUser, clubId: string, mode: InstitutionalAuthMode = "email-verification") {
  const u = await currentUser(db, user, mode);
  return (
    u.roles.includes("ADMIN") ||
    (u.roles.includes("CLUB_HEAD") &&
      !!(await db.clubAssignment.findUnique({
        where: { userId_clubId: { userId: u.id, clubId } },
      })))
  );
}
