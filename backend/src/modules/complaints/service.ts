import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import type { PublicUser } from "../auth/repository.js";
import { AccountError } from "../registration/service.js";
import { imageStorage, validateImage } from "../../services/image-storage.js";
import { currentUser, eligibleSupervisor, requireAdmin, requireSubmitter, supervisorAccounts, type CurrentUser } from "./permissions.js";
import { groups, categories, type Submission, type ComplaintQuery } from "./validation.js";
import type { InstitutionalAuthMode } from "../../config.js";
import { accountEligible } from "../auth/account-policy.js";

const person = { id: true, name: true, email: true, department: true } as const;
const selection = {
  id: true, title: true, description: true, submitterId: true, status: true, version: true,
  studentGroup: true, routingConfirmed: true, routingSource: true, category: true, location: true,
  verifiedAt: true, rejectionReason: true, adminResponse: true, supervisorId: true,
  supervisorGroup: true, assignedAt: true, coordinationStartedAt: true, resolvedAt: true,
  resolutionDetails: true, feedback: true, feedbackAt: true, createdAt: true, updatedAt: true,
  submitter: { select: person }, supervisor: { select: { id: true, name: true } },
  image: { select: { id: true } },
} as const;
type Case = Prisma.ComplaintGetPayload<{ select: typeof selection }>;
type Tx = Prisma.TransactionClient;
const slotSelection = {
  studentGroup: true, userId: true, version: true, updatedAt: true,
  user: { select: { ...person, active: true, emailVerifiedAt: true, roles: true, isDemo: true } },
} as const;
type Slot = Prisma.ComplaintSupervisorAssignmentGetPayload<{ select: typeof slotSelection }>;
type Context = { user: CurrentUser; slots: Slot[]; activeSlots: Slot[] };
const eligible = (s: Slot, allowDemo: boolean, mode: InstitutionalAuthMode) => accountEligible(s.user, mode) && !!s.user?.roles.includes("STAFF") && ((s.user.email.endsWith("@ssn.edu.in") && !s.user.isDemo) || (allowDemo && s.user.isDemo));
const isAdmin = (ctx: Context) => ctx.user.roles.includes("ADMIN");
function assigned(c: Case, ctx: Context) {
  return ctx.activeSlots.some(s => s.studentGroup === c.supervisorGroup && s.userId === c.supervisorId);
}
function isSupervisor(c: Case, ctx: Context) {
  return c.supervisorId === ctx.user.id && assigned(c, ctx);
}
function requireCaseAccess(c: Case, ctx: Context) {
  if (!isAdmin(ctx) && c.submitterId !== ctx.user.id && !isSupervisor(c, ctx))
    throw new AccountError(403, "You do not have access to this complaint.");
}
function card(c: Case, ctx: Context) {
  const { image, submitter, supervisor, submitterId, supervisorId, feedback, feedbackAt, ...rest } = c;
  const admin = isAdmin(ctx), owner = submitterId === ctx.user.id;
  const authorized = assigned(c, ctx);
  return {
    ...rest,
    stage: c.status === "ACCEPTED" ? !authorized ? "Awaiting Supervisor Assignment" : c.coordinationStartedAt ? "Under Coordination" : "Assigned to Supervisor" : c.status === "SUBMITTED" ? "Awaiting Admin Verification" : c.status === "RESOLVED" ? "Resolved" : "Rejected",
    imageUrl: image ? `/api/complaints/${c.id}/image?v=${c.version}` : null,
    ...(admin || isSupervisor(c, ctx) ? { submitter, supervisorId, supervisor } : {}),
    ...(owner || admin ? { feedback, feedbackAt } : {}),
    canReview: admin && c.status === "SUBMITTED",
    canReassign: admin && c.status === "ACCEPTED",
    canProcess: isSupervisor(c, ctx) && c.status === "ACCEPTED",
    canFeedback: owner && ["RESOLVED", "REJECTED"].includes(c.status) && feedback === null,
    canUpload: owner && c.status === "SUBMITTED",
  };
}

export function complaintsService(db: PrismaClient, allowDemo = false, mode: InstitutionalAuthMode = "email-verification") {
  const storage = imageStorage();
  // One short-lived module lock serializes configuration and case mutations. Reads use
  // its shared counterpart so reassignment cannot interleave with authorization/bytes.
  async function transaction<T>(user: PublicUser, write: boolean, fn: (tx: Tx, ctx: Context) => Promise<T>) {
    return db.$transaction(async tx => {
      if (write) await tx.$queryRaw`SELECT pg_advisory_xact_lock(731004)::text`;
      else await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(731004)::text`;
      const u = await currentUser(tx, user, mode);
      const slots = await tx.complaintSupervisorAssignment.findMany({ select: slotSelection, orderBy: { studentGroup: "asc" } });
      return fn(tx, { user: u, slots, activeSlots: slots.filter(s => eligible(s, allowDemo, mode)) });
    }, { maxWait: 10000, timeout: 15000 });
  }
  async function find(tx: Tx, id: string, lock = false) {
    if (lock) await tx.$queryRaw`SELECT "id" FROM "Complaint" WHERE "id" = ${id} FOR UPDATE`;
    const c = await tx.complaint.findUnique({ where: { id }, select: selection });
    if (!c) throw new AccountError(404, "Complaint not found.");
    return c;
  }
  async function audit(tx: Tx, actorId: string, id: string, action: string, changes: Prisma.InputJsonValue) {
    await tx.auditLog.create({ data: { actorId, entityType: "Complaint", entityId: id, action: "COMPLAINT_" + action, changes } });
  }
  async function detail(tx: Tx, c: Case, ctx: Context) {
    requireCaseAccess(c, ctx);
    const internal = isAdmin(ctx) || isSupervisor(c, ctx);
    const history = await tx.auditLog.findMany({
      where: { entityType: "Complaint", entityId: c.id, ...(internal ? {} : { action: { not: "COMPLAINT_PROGRESS" } }) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, action: true, createdAt: true, changes: true, actor: { select: { name: true } } },
    });
    return {
      ...card(c, ctx),
      history: history.map(h => internal ? h : { id: h.id, action: h.action, createdAt: h.createdAt }),
      ...(internal ? { internalNotes: await tx.complaintNote.findMany({ where: { complaintId: c.id }, orderBy: { createdAt: "asc" }, select: { id: true, text: true, wardenContact: true, createdAt: true, author: { select: { name: true } } } }) } : {}),
    };
  }
  async function mutate<T>(user: PublicUser, id: string, version: number, fn: (tx: Tx, c: Case, ctx: Context) => Promise<T>) {
    return transaction(user, true, async (tx, ctx) => {
      const c = await find(tx, id, true);
      requireCaseAccess(c, ctx);
      if (c.version !== version) throw new AccountError(409, "This complaint changed. Reload before saving.");
      return fn(tx, c, ctx);
    });
  }
  function accepted(c: Case) {
    if (c.status !== "ACCEPTED") throw new AccountError(409, "Only accepted complaints can be processed.");
  }
  return {
    catalog(user: PublicUser) {
      return transaction(user, false, async (tx, ctx) => ({
        groups, categories,
        canSubmit: ctx.user.roles.some(r => r === "STUDENT" || r === "STAFF"),
        canAdmin: isAdmin(ctx),
        supervisorGroups: ctx.activeSlots.filter(s => s.userId === user.id).map(s => s.studentGroup),
        provisionalSelectionAllowed: ctx.user.roles.includes("STUDENT") && !ctx.user.roles.includes("STAFF"),
        routingExplanation: "Academic terms and rosters do not record a reliable current study year. Student selections are provisional; Admin must confirm routing. Staff complaints use manual routing.",
        ...(isAdmin(ctx) ? {
          assignments: ctx.slots.map(s => ({ studentGroup: s.studentGroup, userId: s.userId, version: s.version, updatedAt: s.updatedAt, eligible: eligible(s, allowDemo, mode), user: s.user ? { id: s.user.id, name: s.user.name, email: s.user.email } : null })),
          candidates: await tx.user.findMany({ where: supervisorAccounts(allowDemo, mode), select: person, orderBy: { name: "asc" } }),
        } : {}),
      }));
    },
    create(user: PublicUser, input: Submission) {
      return transaction(user, true, async (tx, ctx) => {
        requireSubmitter(ctx.user);
        const staff = ctx.user.roles.includes("STAFF");
        if (staff && input.studentGroup) throw new AccountError(400, "Staff complaints require manual Admin routing; do not select a student year.");
        const c = await tx.complaint.create({ data: { ...input, location: input.location || null, studentGroup: input.studentGroup ?? null, submitterId: ctx.user.id, routingSource: staff ? "MANUAL" : "PROVISIONAL" }, select: selection });
        await audit(tx, ctx.user.id, c.id, "SUBMITTED", { status: "SUBMITTED", studentGroup: c.studentGroup, routingSource: c.routingSource });
        return detail(tx, c, ctx);
      });
    },
    list(user: PublicUser, q: ComplaintQuery) {
      return transaction(user, false, async (tx, ctx) => {
        const where: Prisma.ComplaintWhereInput = {};
        if (q.scope === "admin") requireAdmin(ctx.user);
        else if (q.scope === "supervisor") {
          const slots = ctx.activeSlots.filter(s => s.userId === ctx.user.id);
          if (!slots.length) throw new AccountError(403, "Current Supervisor assignment required.");
          where.supervisorId = ctx.user.id;
          where.supervisorGroup = { in: slots.map(s => s.studentGroup) };
          where.status = { in: ["ACCEPTED", "RESOLVED"] };
        } else where.submitterId = ctx.user.id;
        const filters: Prisma.ComplaintWhereInput = {
          ...(q.status ? { status: q.status } : {}), ...(q.studentGroup ? { studentGroup: q.studentGroup } : {}),
          ...(q.supervisorId ? { supervisorId: q.supervisorId } : {}), ...(q.category ? { category: q.category } : {}),
          ...(q.location ? { location: { contains: q.location, mode: "insensitive" } } : {}),
          ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
        };
        const scoped = { AND: [where, filters] };
        const total = await tx.complaint.count({ where: scoped });
        const cases = await tx.complaint.findMany({ where: scoped, select: selection, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize });
        return { complaints: cases.map(c => card(c, ctx)), total, page: q.page, pageSize: q.pageSize };
      });
    },
    statistics(user: PublicUser) {
      return transaction(user, false, async (tx, ctx) => {
        requireAdmin(ctx.user);
        const assignedWhere: Prisma.ComplaintWhereInput = { OR: ctx.activeSlots.map(s => ({ supervisorGroup: s.studentGroup, supervisorId: s.userId! })) };
        const count = (where: Prisma.ComplaintWhereInput) => tx.complaint.count({ where });
        const [submitted, unassigned, pending, resolved, rejected] = await Promise.all([
          count({ status: "SUBMITTED" }), count({ status: "ACCEPTED", NOT: assignedWhere }),
          count({ status: "ACCEPTED", ...assignedWhere }), count({ status: "RESOLVED" }), count({ status: "REJECTED" }),
        ]);
        return { submitted, unassigned, pending, resolved, rejected };
      });
    },
    detail(user: PublicUser, id: string) {
      return transaction(user, false, async (tx, ctx) => detail(tx, await find(tx, id), ctx));
    },
    accept(user: PublicUser, id: string, version: number, studentGroup: typeof groups[number]) {
      return mutate(user, id, version, async (tx, c, ctx) => {
        requireAdmin(ctx.user);
        if (c.status !== "SUBMITTED") throw new AccountError(409, "This complaint has already been verified.");
        const slot = ctx.activeSlots.find(s => s.studentGroup === studentGroup);
        const now = new Date();
        const updated = await tx.complaint.update({ where: { id }, data: { status: "ACCEPTED", studentGroup, routingConfirmed: true, verifiedById: user.id, verifiedAt: now, supervisorGroup: studentGroup, supervisorId: slot?.userId ?? null, assignedAt: slot ? now : null, version: { increment: 1 } }, select: selection });
        await audit(tx, user.id, id, "ACCEPTED", { from: "SUBMITTED", to: "ACCEPTED", previousGroup: c.studentGroup, studentGroup, confirmedRouting: true });
        if (slot) await audit(tx, user.id, id, "ASSIGNED", { supervisorId: slot.userId, supervisorGroup: studentGroup });
        return detail(tx, updated, ctx);
      });
    },
    reject(user: PublicUser, id: string, version: number, reason: string) {
      return mutate(user, id, version, async (tx, c, ctx) => {
        requireAdmin(ctx.user);
        if (c.status !== "SUBMITTED") throw new AccountError(409, "This complaint has already been verified.");
        const updated = await tx.complaint.update({ where: { id }, data: { status: "REJECTED", rejectionReason: reason, adminResponse: reason, verifiedById: user.id, verifiedAt: new Date(), version: { increment: 1 } }, select: selection });
        await audit(tx, user.id, id, "REJECTED", { from: "SUBMITTED", to: "REJECTED", reason });
        return detail(tx, updated, ctx);
      });
    },
    configure(user: PublicUser, studentGroup: typeof groups[number], version: number, userId: string | null, reason: string, identityConfirmed?: boolean) {
      return transaction(user, true, async (tx, ctx) => {
        requireAdmin(ctx.user);
        const slot = ctx.slots.find(s => s.studentGroup === studentGroup);
        if (!slot || slot.version !== version) throw new AccountError(409, "This assignment changed. Reload before saving.");
        if (slot.userId === userId) throw new AccountError(400, "Choose a different Supervisor or revoke the assignment.");
        if (userId && mode === "domain-only-demo" && identityConfirmed !== true)
          throw new AccountError(400, "Verify the Staff identity out of band and confirm before designating a Supervisor.");
        if (userId) await eligibleSupervisor(tx, userId, allowDemo, mode);
        await tx.complaintSupervisorAssignment.update({ where: { studentGroup }, data: { userId, assignedById: user.id, version: { increment: 1 } } });
        const cases = await tx.complaint.findMany({ where: { status: "ACCEPTED", supervisorGroup: studentGroup }, select: { id: true, supervisorId: true } });
        for (const c of cases) {
          await tx.complaint.update({ where: { id: c.id }, data: { supervisorId: userId, assignedAt: userId ? new Date() : null, version: { increment: 1 } } });
          await audit(tx, user.id, c.id, c.supervisorId ? "REASSIGNED" : "ASSIGNED", { previousSupervisorId: c.supervisorId, supervisorId: userId, supervisorGroup: studentGroup, reason });
        }
        await tx.auditLog.create({ data: { actorId: user.id, entityType: "ComplaintSupervisorAssignment", entityId: studentGroup, action: "COMPLAINT_SUPERVISOR_CHANGED", changes: { previousUserId: slot.userId, userId, reason, identityConfirmed: identityConfirmed === true, transferredCases: cases.length } } });
        return { studentGroup, userId, transferredCases: cases.length };
      });
    },
    reassign(user: PublicUser, id: string, version: number, supervisorGroup: typeof groups[number], reason: string) {
      return mutate(user, id, version, async (tx, c, ctx) => {
        requireAdmin(ctx.user); accepted(c);
        const slot = ctx.activeSlots.find(s => s.studentGroup === supervisorGroup);
        if (!slot) throw new AccountError(400, "Configure an eligible Supervisor for the selected group first.");
        if (c.supervisorId === slot.userId && c.supervisorGroup === supervisorGroup) throw new AccountError(400, "This Supervisor already owns the complaint.");
        const updated = await tx.complaint.update({ where: { id }, data: { supervisorId: slot.userId, supervisorGroup, assignedAt: new Date(), version: { increment: 1 } }, select: selection });
        await audit(tx, user.id, id, c.supervisorId ? "REASSIGNED" : "ASSIGNED", { previousSupervisorId: c.supervisorId, supervisorId: slot.userId, supervisorGroup, reason });
        return detail(tx, updated, ctx);
      });
    },
    note(user: PublicUser, id: string, version: number, text: string, wardenContact?: string) {
      return mutate(user, id, version, async (tx, c, ctx) => {
        accepted(c);
        if (!isSupervisor(c, ctx)) throw new AccountError(403, "Only the currently assigned Supervisor can record coordination.");
        const note = await tx.complaintNote.create({ data: { complaintId: id, authorId: user.id, text, wardenContact: wardenContact || null } });
        const updated = await tx.complaint.update({ where: { id }, data: { coordinationStartedAt: c.coordinationStartedAt ?? new Date(), version: { increment: 1 } }, select: selection });
        await audit(tx, user.id, id, "PROGRESS", { noteId: note.id });
        return detail(tx, updated, ctx);
      });
    },
    resolve(user: PublicUser, id: string, version: number, resolutionDetails: string) {
      return mutate(user, id, version, async (tx, c, ctx) => {
        accepted(c);
        if (!isSupervisor(c, ctx)) throw new AccountError(403, "Only the currently assigned Supervisor can resolve this complaint.");
        const updated = await tx.complaint.update({ where: { id }, data: { status: "RESOLVED", resolutionDetails, resolvedAt: new Date(), version: { increment: 1 } }, select: selection });
        await audit(tx, user.id, id, "RESOLVED", { from: "ACCEPTED", to: "RESOLVED", resolutionDetails });
        return detail(tx, updated, ctx);
      });
    },
    feedback(user: PublicUser, id: string, version: number, feedback: string) {
      return mutate(user, id, version, async (tx, c, ctx) => {
        if (c.submitterId !== user.id) throw new AccountError(403, "Only the original submitter can provide feedback.");
        if (!["RESOLVED", "REJECTED"].includes(c.status)) throw new AccountError(409, "Feedback is available after closure.");
        if (c.feedback !== null) throw new AccountError(409, "Feedback has already been submitted.");
        const updated = await tx.complaint.update({ where: { id }, data: { feedback, feedbackAt: new Date(), version: { increment: 1 } }, select: selection });
        await audit(tx, user.id, id, "FEEDBACK", { feedbackSubmitted: true });
        return detail(tx, updated, ctx);
      });
    },
    async saveImage(user: PublicUser, id: string, version: number, bytes: Buffer, mime: string, filename?: string) {
      const image = await validateImage(bytes, mime, filename);
      return mutate(user, id, version, async (tx, c, ctx) => {
        if (c.submitterId !== user.id || c.status !== "SUBMITTED") throw new AccountError(403, "Only the submitter can attach an image before verification.");
        await storage.replace(tx, { complaintId: id }, image);
        const updated = await tx.complaint.update({ where: { id }, data: { version: { increment: 1 } }, select: selection });
        await audit(tx, user.id, id, "IMAGE_ATTACHED", { mimeType: image.mimeType, sizeBytes: image.bytes.length });
        return detail(tx, updated, ctx);
      });
    },
    image(user: PublicUser, id: string) {
      return transaction(user, false, async (tx, ctx) => {
        const c = await find(tx, id); requireCaseAccess(c, ctx);
        const image = await tx.image.findUnique({ where: { complaintId: id }, select: { mimeType: true, bytes: true } });
        if (!image?.bytes) throw new AccountError(404, "Complaint image not found.");
        return image;
      });
    },
  };
}
export type ComplaintsService = ReturnType<typeof complaintsService>;
