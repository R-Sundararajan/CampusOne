import type { Prisma } from "../../generated/prisma/client.js";
import type { PublicUser } from "../auth/repository.js";
import { AccountError } from "../registration/service.js";
export async function currentUser(tx: Prisma.TransactionClient, user: PublicUser) {
  const u = await tx.user.findUnique({ where: { id: user.id }, select: { id: true, roles: true, active: true, emailVerifiedAt: true } });
  if (!u?.active || !u.emailVerifiedAt || !u.roles.length) throw new AccountError(403, "Active verified account required.");
  return u;
}
export type CurrentUser = Awaited<ReturnType<typeof currentUser>>;
export function requireAdmin(user: CurrentUser) {
  if (!user.roles.includes("ADMIN")) throw new AccountError(403, "Admin access required.");
}
export function requireSubmitter(user: CurrentUser) {
  if (!user.roles.some(r => r === "STUDENT" || r === "STAFF")) throw new AccountError(403, "Student or approved Staff access required.");
}
export async function authorizedGroups(tx: Prisma.TransactionClient, user: CurrentUser) {
  if (!user.roles.includes("STAFF")) return [];
  return (await tx.complaintSupervisorAssignment.findMany({ where: { userId: user.id }, select: { studentGroup: true } })).map(a => a.studentGroup);
}
export function supervisorAccounts(allowDemo = false) {
  return { active: true, emailVerifiedAt: { not: null }, roles: { has: "STAFF" as const }, OR: [{ email: { endsWith: "@ssn.edu.in" }, isDemo: false }, ...(allowDemo ? [{ isDemo: true }] : [])] };
}
export async function eligibleSupervisor(tx: Prisma.TransactionClient, userId: string, allowDemo = false) {
  const u = await tx.user.findFirst({ where: { id: userId, ...supervisorAccounts(allowDemo) }, select: { id: true, name: true, email: true } });
  if (!u) throw new AccountError(400, "Choose an active, verified, approved Staff account.");
  return u;
}
