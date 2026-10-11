import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";
import type { PublicUser } from "../auth/repository.js";
import { AccountError } from "../registration/service.js";
import { parseRegisterNumbers } from "./registerNumber.js";
import type {
  AttendanceInput,
  SaveInput,
  RosterInput,
  ReportFilter,
} from "./validation.js";
import type { z } from "zod";
import type { InstitutionalAuthMode } from "../../config.js";
import { accountEligible, accountEligibilityWhere } from "../auth/account-policy.js";
import type {
  classSchema,
  assignmentSchema,
  offeringSchema,
  linkSchema,
  membershipSchema,
  importSchema,
} from "./validation.js";

type Db = PrismaClient | Prisma.TransactionClient;
const studentInclude = { user: { select: { name: true } } } as const;
const offeringInclude = {
  classGroup: { include: { term: true } },
  subject: true,
} as const;
const deny = () => {
  throw new AccountError(403, "This class or subject is not assigned to you.");
};
function check(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new AccountError(status, message);
}
const studentView = (s: {
  id: string;
  registerNumber: string | null;
  name: string | null;
  userId: string | null;
  user?: { name: string } | null;
}) => ({
  studentId: s.id,
  registerNumber: s.registerNumber,
  name: s.user?.name ?? s.name ?? "Unlinked student",
  linked: !!s.userId,
});
const lockClass = (tx: Prisma.TransactionClient, classId: string) =>
  tx.$queryRaw`SELECT "id" FROM "ClassGroup" WHERE "id" = ${classId} FOR UPDATE`;
export const percentage = (present: number, conducted: number) =>
  conducted ? Math.round((present / conducted) * 10000) / 100 : 0;
export function csv(rows: unknown[][]) {
  // Quote every cell, preserve register numbers, and neutralize spreadsheet formulas.
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            const raw = String(value ?? "");
            const safe = /^[\s]*[=+\-@]/.test(raw) ? "'" + raw : raw;
            return '"' + safe.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}

export function attendanceService(db: PrismaClient, mode: InstitutionalAuthMode = "email-verification", allowDemo = true) {
  function confirmIdentity(input: { identityConfirmed?: boolean; syntheticIdentityAttested?: boolean }, evidence: string | undefined) {
    if (input.syntheticIdentityAttested) {
      check(mode === "domain-only-demo", "Synthetic fixture attestation is only available in domain-only-demo mode.");
      check(input.identityConfirmed !== true, "Synthetic fixture attestation must not claim institutional identity.");
      check(!!evidence && evidence.trim().length >= 10 && evidence.trim().length <= 500, "Record the operator authorization and synthetic fixture evidence.");
    } else if (mode === "domain-only-demo") {
      check(input.identityConfirmed === true, "Verify institutional identity out of band or explicitly attest an authorized synthetic fixture.");
    }
  }
  async function current(tx: Db, user: PublicUser, role: "ADMIN" | "STAFF") {
    const u = await tx.user.findUnique({
      where: { id: user.id },
      select: { roles: true, active: true, emailVerifiedAt: true, email: true, isDemo: true },
    });
    if (!accountEligible(u, mode, allowDemo) || !u?.roles.includes(role)) deny();
  }
  async function classAccess(tx: Db, user: PublicUser, classId: string) {
    const group = await tx.classGroup.findUnique({
      where: { id: classId },
      include: { term: true },
    });
    if (!group) throw new AccountError(404, "Class not found.");
    if (user.roles.includes("ADMIN")) {
      await current(tx, user, "ADMIN");
      return group;
    }
    await current(tx, user, "STAFF");
    if (
      !(await tx.teachingAssignment.findFirst({
        where: { staffId: user.id, offering: { classGroupId: classId } },
      }))
    )
      deny();
    return group;
  }
  async function offeringAccess(
    tx: Db,
    user: PublicUser,
    offeringId: string,
    edit = false,
  ) {
    const offering = await tx.courseOffering.findUnique({
      where: { id: offeringId },
      include: offeringInclude,
    });
    if (!offering) throw new AccountError(404, "Subject offering not found.");
    if (!edit && user.roles.includes("ADMIN")) {
      await current(tx, user, "ADMIN");
      return offering;
    }
    await current(tx, user, "STAFF");
    if (
      !(await tx.teachingAssignment.findUnique({
        where: { staffId_offeringId: { staffId: user.id, offeringId } },
      }))
    )
      deny();
    return offering;
  }
  async function rosterPreview(tx: Db, user: PublicUser, input: RosterInput) {
    const group = await classAccess(tx, user, input.classGroupId);
    const parsed = parseRegisterNumbers(
      input.input,
      input.prefix,
      input.suffixWidth,
    );
    const enrolled = await tx.classEnrollment.findMany({
      where: { classGroupId: group.id },
      include: { student: { include: studentInclude } },
    });
    const identities = await tx.studentIdentity.findMany({
      where: { registerNumber: { in: parsed.registerNumbers } },
      include: studentInclude,
    });
    const rows = parsed.registerNumbers.map((registerNumber) => {
      const identity = identities.find(
        (s) => s.registerNumber === registerNumber,
      );
      const existing = enrolled.find(
        (e) => e.student.registerNumber === registerNumber,
      );
      return {
        registerNumber,
        name:
          input.names[registerNumber] ??
          identity?.user?.name ??
          identity?.name ??
          "",
        linked: !!identity?.userId,
        existing: !!existing?.active,
        inactive: !!existing && !existing.active,
      };
    });
    const retained = enrolled
      .filter(
        (e) =>
          e.active &&
          !parsed.registerNumbers.includes(e.student.registerNumber ?? ""),
      )
      .map((e) => studentView(e.student));
    const incompatible = enrolled.filter(
      (e) =>
        e.active &&
        e.student.registerNumber &&
        (!e.student.registerNumber.startsWith(input.prefix) ||
          e.student.registerNumber.length !==
            input.prefix.length + input.suffixWidth),
    );
    const errors = [...parsed.errors];
    if (!parsed.registerNumbers.length)
      errors.push("Enter at least one suffix.");
    if (incompatible.length)
      errors.push(
        "The proposed prefix/width does not match existing members. Keep the current register format or explicitly deactivate affected memberships first.",
      );
    if (
      enrolled.filter((e) => e.active).length +
        rows.filter((r) => !r.existing && !r.inactive).length >
      1000
    )
      errors.push(
        "A class roster supports up to 1,000 active students. Split larger groups into sections.",
      );
    return {
      ...parsed,
      errors,
      rows,
      retained,
      total: rows.length,
      added: rows.filter((r) => !r.existing && !r.inactive).length,
      existing: rows.filter((r) => r.existing).length,
      unlinked: rows.filter((r) => !r.linked).length,
      rosterVersion: group.rosterVersion,
      classGroup: group,
    };
  }
  async function attendancePreview(
    tx: Db,
    user: PublicUser,
    input: AttendanceInput,
  ) {
    const offering = await offeringAccess(tx, user, input.offeringId, true);
    const session = await tx.attendanceSession.findUnique({
      where: {
        offeringId_date_period: {
          offeringId: offering.id,
          date: new Date(input.date),
          period: input.period,
        },
      },
      include: {
        records: { include: { student: { include: studentInclude } } },
      },
    });
    // Corrections use the exact submitted membership, even after roster changes.
    const students = session
      ? session.records.map((r) => r.student)
      : (
          await tx.classEnrollment.findMany({
            where: { classGroupId: offering.classGroupId, active: true },
            include: { student: { include: studentInclude } },
          })
        ).map((e) => e.student);
    const group = offering.classGroup;
    const parsed = parseRegisterNumbers(
      input.input,
      group.registerPrefix,
      group.suffixWidth,
    );
    const errors = [...parsed.errors];
    const unknown = parsed.registerNumbers.filter(
      (number) => !students.some((s) => s.registerNumber === number),
    );
    if (unknown.length)
      errors.push(
        "Unknown register numbers: " +
          unknown.join(", ") +
          ". Correct them before saving.",
      );
    if (!students.length) errors.push("This class has no enrolled students.");
    if (students.some((s) => !s.registerNumber))
      errors.push(
        "A roster member has no register number. Ask an Admin to reconcile the student identity.",
      );
    if (
      ["PRESENT", "ABSENT"].includes(input.mode) &&
      !parsed.registerNumbers.length
    )
      errors.push(
        "Empty bulk input cannot mark a class. Enter suffixes or use an explicit Mark all action.",
      );
    if (input.mode === "EXISTING" && !session)
      errors.push("No saved attendance exists for this selection.");
    if (
      session &&
      (!session.submittedAt ||
        session.rosterSize <= 0 ||
        session.records.length !== session.rosterSize)
    )
      errors.push(
        "This saved session is incomplete or unsubmitted and is excluded from reports. It requires administrative data reconciliation before correction.",
      );
    const overrides = new Map(
      input.overrides.map((o) => [o.studentId, o.status]),
    );
    if (
      overrides.size !== input.overrides.length ||
      input.overrides.some((o) => !students.some((s) => s.id === o.studentId))
    )
      errors.push(
        "Manual corrections must refer to unique students in this roster.",
      );
    const rows = students
      .map((s) => {
        const listed = parsed.registerNumbers.includes(s.registerNumber ?? "");
        const status =
          overrides.get(s.id) ??
          (input.mode === "EXISTING"
            ? (session?.records.find((r) => r.studentId === s.id)?.status ??
              "ABSENT")
            : input.mode === "ALL_PRESENT"
              ? "PRESENT"
              : input.mode === "ALL_ABSENT"
                ? "ABSENT"
                : input.mode === "PRESENT"
                  ? listed
                    ? "PRESENT"
                    : "ABSENT"
                  : listed
                    ? "ABSENT"
                    : "PRESENT");
        return { ...studentView(s), status };
      })
      .sort((a, b) =>
        (a.registerNumber ?? "").localeCompare(b.registerNumber ?? ""),
      );
    return {
      offering,
      date: input.date,
      period: input.period,
      mode: input.mode,
      rows,
      total: rows.length,
      present: rows.filter((r) => r.status === "PRESENT").length,
      absent: rows.filter((r) => r.status === "ABSENT").length,
      errors,
      unknown,
      duplicates: parsed.duplicates,
      valid: parsed.suffixes.length,
      rosterVersion: group.rosterVersion,
      sessionId: session?.id ?? null,
      sessionVersion: session?.version ?? null,
      updatedAt: session?.updatedAt ?? null,
    };
  }
  async function write<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await db.$transaction(run, { timeout: 15000 });
    } catch (e) {
      if (
        typeof e === "object" &&
        e &&
        "code" in e &&
        ["P2002", "P2034"].includes(String(e.code))
      )
        throw new AccountError(
          409,
          "This data changed or already exists. Reload the preview and try again.",
        );
      throw e;
    }
  }
  const audit = (
    tx: Prisma.TransactionClient,
    user: PublicUser,
    action: string,
    entityType: string,
    entityId: string,
    changes: Prisma.InputJsonValue,
  ) =>
    tx.auditLog.create({
      data: { actorId: user.id, action, entityType, entityId, changes },
    });

  return {
    async catalog(user: PublicUser) {
      const admin = user.roles.includes("ADMIN");
      const offerings = await db.courseOffering.findMany({
        where: admin ? {} : { assignments: { some: { staffId: user.id } } },
        include: {
          ...offeringInclude,
          assignments: {
            include: { staff: { select: { id: true, name: true } } },
          },
        },
        orderBy: { subject: { code: "asc" } },
      });
      return {
        institutionalAuthMode: mode,
        offerings,
        classes: await db.classGroup.findMany({
          where: admin
            ? {}
            : {
                offerings: {
                  some: { assignments: { some: { staffId: user.id } } },
                },
              },
          include: { term: true },
          orderBy: { name: "asc" },
        }),
        terms: await db.academicTerm.findMany({
          where: admin
            ? {}
            : {
                classes: {
                  some: {
                    offerings: {
                      some: { assignments: { some: { staffId: user.id } } },
                    },
                  },
                },
              },
          orderBy: { name: "desc" },
        }),
      };
    },
    async adminAccounts(user: PublicUser) {
      await current(db, user, "ADMIN");
      return db.user.findMany({
        where: {
          ...accountEligibilityWhere(mode, allowDemo),
          roles: { has: "STAFF" },
        },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      });
    },
    async createTerm(user: PublicUser, name: string) {
      await current(db, user, "ADMIN");
      return db.academicTerm.upsert({
        where: { name },
        create: { name },
        update: {},
      });
    },
    async createClass(user: PublicUser, input: z.infer<typeof classSchema>) {
      return write(async (tx) => {
        await current(tx, user, "ADMIN");
        const term = await tx.academicTerm.findUnique({
          where: { id: input.termId },
        });
        check(term, "Select an existing academic term.");
        const group = await tx.classGroup.upsert({
          where: {
            department_admissionBatch_name_section_academicYear: {
              department: input.department,
              admissionBatch: input.admissionBatch,
              name: input.name,
              section: input.section,
              academicYear: term.name,
            },
          },
          create: { ...input, academicYear: term.name },
          update: {},
        });
        return group;
      });
    },
    async createOffering(
      user: PublicUser,
      input: z.infer<typeof offeringSchema>,
    ) {
      return write(async (tx) => {
        await current(tx, user, "ADMIN");
        await lockClass(tx, input.classGroupId);
        await classAccess(tx, user, input.classGroupId);
        const subject = await tx.subject.upsert({
          where: { code: input.code },
          create: { code: input.code, name: input.name },
          update: {},
        });
        check(
          subject.name === input.name,
          "This subject code already has a different name. Use the existing subject name.",
        );
        return tx.courseOffering.upsert({
          where: {
            classGroupId_subjectId: {
              classGroupId: input.classGroupId,
              subjectId: subject.id,
            },
          },
          create: { classGroupId: input.classGroupId, subjectId: subject.id },
          update: {},
        });
      });
    },
    async assign(user: PublicUser, input: z.infer<typeof assignmentSchema>) {
      return write(async (tx) => {
        await current(tx, user, "ADMIN");
        const offering = await offeringAccess(tx, user, input.offeringId);
        await lockClass(tx, offering.classGroupId);
        const staff = await tx.user.findUnique({
          where: { id: input.staffId },
        });
        check(
          accountEligible(staff, mode, allowDemo) && staff?.roles.includes("STAFF"),
          "Choose an eligible, active Staff account.",
        );
        const where = { staffId: input.staffId, offeringId: input.offeringId };
        if (input.assigned) confirmIdentity(input, input.identityEvidence);
        if (input.assigned)
          await tx.teachingAssignment.upsert({
            where: { staffId_offeringId: where },
            create: where,
            update: {},
          });
        else await tx.teachingAssignment.deleteMany({ where });
        await audit(
          tx,
          user,
          "TEACHING_ASSIGNMENT",
          "CourseOffering",
          offering.id,
          input,
        );
      });
    },
    rosterPreview: (user: PublicUser, input: RosterInput) =>
      rosterPreview(db, user, input),
    async importRoster(user: PublicUser, input: z.infer<typeof importSchema>) {
      return write(async (tx) => {
        await lockClass(tx, input.classGroupId);
        const preview = await rosterPreview(tx, user, input);
        check(
          preview.rosterVersion === input.rosterVersion,
          "The roster changed. Preview again before importing.",
          409,
        );
        check(!preview.errors.length, preview.errors.join(" "));
        for (const row of preview.rows) {
          const identity = await tx.studentIdentity.upsert({
            where: { registerNumber: row.registerNumber },
            create: {
              registerNumber: row.registerNumber,
              name: row.name || null,
            },
            update: {},
          });
          if (input.names[row.registerNumber] !== undefined && !identity.userId)
            await tx.studentIdentity.update({
              where: { id: identity.id },
              data: { name: input.names[row.registerNumber] || null },
            });
          // Imports are additive. Inactive memberships need deliberate reactivation.
          await tx.classEnrollment.upsert({
            where: {
              studentId_classGroupId: {
                studentId: identity.id,
                classGroupId: input.classGroupId,
              },
            },
            create: {
              studentId: identity.id,
              classGroupId: input.classGroupId,
            },
            update: {},
          });
        }
        await tx.classGroup.update({
          where: { id: input.classGroupId },
          data: {
            registerPrefix: input.prefix,
            suffixWidth: input.suffixWidth,
            rosterVersion: { increment: 1 },
          },
        });
        await audit(
          tx,
          user,
          "ROSTER_IMPORT",
          "ClassGroup",
          input.classGroupId,
          {
            registerNumbers: preview.registerNumbers,
            retained: preview.retained.map((s) => s.studentId),
            prefix: input.prefix,
            suffixWidth: input.suffixWidth,
          },
        );
        return { added: preview.added, retained: preview.retained.length };
      });
    },
    async roster(user: PublicUser, classId: string) {
      const group = await classAccess(db, user, classId);
      const entries = await db.classEnrollment.findMany({
        where: { classGroupId: classId },
        include: { student: { include: studentInclude } },
        orderBy: { student: { registerNumber: "asc" } },
      });
      return {
        classGroup: group,
        rows: entries.map((e) => ({
          ...studentView(e.student),
          active: e.active,
        })),
      };
    },
    async membership(
      user: PublicUser,
      classId: string,
      input: z.infer<typeof membershipSchema>,
    ) {
      return write(async (tx) => {
        await lockClass(tx, classId);
        const group = await classAccess(tx, user, classId);
        check(
          group.rosterVersion === input.rosterVersion,
          "The roster changed. Reload it before changing membership.",
          409,
        );
        const entry = await tx.classEnrollment.findUnique({
          where: {
            studentId_classGroupId: {
              studentId: input.studentId,
              classGroupId: classId,
            },
          },
          include: { student: true },
        });
        check(entry, "This student is not enrolled in this class.");
        if (entry.active === input.active) return;
        if (input.active) {
          check(
            entry.student.registerNumber?.startsWith(group.registerPrefix) &&
              entry.student.registerNumber.length ===
                group.registerPrefix.length + group.suffixWidth,
            "Reactivation requires a register number matching this class prefix and suffix width.",
          );
          check(
            (await tx.classEnrollment.count({
              where: { classGroupId: classId, active: true },
            })) < 1000,
            "A class roster supports up to 1,000 active students.",
          );
        }
        await tx.classEnrollment.update({
          where: {
            studentId_classGroupId: {
              studentId: input.studentId,
              classGroupId: classId,
            },
          },
          data: { active: input.active },
        });
        await tx.classGroup.update({
          where: { id: classId },
          data: { rosterVersion: { increment: 1 } },
        });
        await audit(tx, user, "ROSTER_MEMBERSHIP", "ClassGroup", classId, {
          ...input,
          previousActive: entry.active,
        });
      });
    },
    async link(user: PublicUser, input: z.infer<typeof linkSchema>) {
      return write(async (tx) => {
        await current(tx, user, "ADMIN");
        confirmIdentity(input, input.reason);
        const candidate = await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        check(candidate, "Select an eligible, active Student account.");
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const account = await tx.user.findUnique({
          where: { id: candidate.id },
        });
        check(
          accountEligible(account, mode, allowDemo) && account?.roles.includes("STUDENT"),
          "Select an eligible, active Student account.",
        );
        await tx.$queryRaw`SELECT "id" FROM "StudentIdentity" WHERE "registerNumber" = ${input.registerNumber} FOR UPDATE`;
        const identity = await tx.studentIdentity.findUnique({
          where: { registerNumber: input.registerNumber },
        });
        check(identity, "Import this register number into a roster first.");
        check(
          !identity.userId || identity.userId === account.id,
          "This register number is already linked to a different account.",
          409,
        );
        const previous = await tx.studentIdentity.findUnique({
          where: { userId: account.id },
        });
        check(
          !previous?.registerNumber || previous.id === identity.id,
          "This account is already linked to another register number.",
          409,
        );
        const classes = await tx.classEnrollment.findMany({
          where: {
            studentId: {
              in: [identity.id, ...(previous ? [previous.id] : [])],
            },
          },
          select: { classGroupId: true },
        });
        for (const classId of [
          ...new Set(classes.map((e) => e.classGroupId)),
        ].sort()) {
          await lockClass(tx, classId);
          await tx.classGroup.update({
            where: { id: classId },
            data: { rosterVersion: { increment: 1 } },
          });
        }
        if (previous && previous.id !== identity.id) {
          const oldRecords = await tx.attendanceRecord.findMany({
            where: { studentId: previous.id },
            select: { sessionId: true },
          });
          check(
            !(await tx.attendanceRecord.count({
              where: {
                studentId: identity.id,
                sessionId: { in: oldRecords.map((r) => r.sessionId) },
              },
            })),
            "These identities have overlapping historical attendance. Resolve the duplicate identity before linking.",
            409,
          );
          const oldEnrollments = await tx.classEnrollment.findMany({
            where: { studentId: previous.id },
          });
          await tx.classEnrollment.createMany({
            data: oldEnrollments.map((e) => ({
              studentId: identity.id,
              classGroupId: e.classGroupId,
              active: e.active,
              createdAt: e.createdAt,
            })),
            skipDuplicates: true,
          });
          await tx.attendanceRecord.updateMany({
            where: { studentId: previous.id },
            data: { studentId: identity.id },
          });
          await tx.classEnrollment.deleteMany({
            where: { studentId: previous.id },
          });
          await tx.studentIdentity.delete({ where: { id: previous.id } });
        }
        await tx.studentIdentity.update({
          where: { id: identity.id },
          data: { userId: account.id },
        });
        await audit(
          tx,
          user,
          "STUDENT_IDENTITY_LINK",
          "StudentIdentity",
          identity.id,
          {
            userId: account.id,
            registerNumber: input.registerNumber,
            reason: input.reason,
            reconciledIdentityId: previous?.id ?? null,
            identityConfirmed: input.identityConfirmed === true,
            syntheticIdentityAttested: input.syntheticIdentityAttested === true,
          },
        );
      });
    },
    preview: (user: PublicUser, input: AttendanceInput) =>
      attendancePreview(db, user, input),
    async save(user: PublicUser, input: SaveInput) {
      return write(async (tx) => {
        const offering = await tx.courseOffering.findUnique({
          where: { id: input.offeringId },
        });
        if (!offering)
          throw new AccountError(404, "Subject offering not found.");
        await lockClass(tx, offering.classGroupId);
        const preview = await attendancePreview(tx, user, input);
        check(
          preview.rosterVersion === input.rosterVersion,
          "The roster changed. Reload the preview before saving.",
          409,
        );
        check(!preview.errors.length, preview.errors.join(" "));
        if (
          preview.present === preview.total ||
          preview.absent === preview.total
        )
          check(
            input.allConfirmation ===
              (preview.present === preview.total ? "PRESENT" : "ABSENT"),
            "Explicitly confirm marking every student " +
              (preview.present === preview.total ? "present." : "absent."),
          );
        const key = {
          offeringId: input.offeringId,
          date: new Date(input.date),
          period: input.period,
        };
        if (preview.sessionId) {
          check(
            input.sessionVersion === preview.sessionVersion,
            "Attendance already exists or changed. Reopen the saved session before correcting it.",
            409,
          );
          check(
            input.reason && input.reason.trim().length >= 5,
            "Provide a correction reason of at least 5 characters.",
          );
          const old = await tx.attendanceRecord.findMany({
            where: { sessionId: preview.sessionId },
          });
          const changed = preview.rows.filter(
            (row) =>
              old.find((r) => r.studentId === row.studentId)?.status !==
              row.status,
          );
          for (const row of changed) {
            await tx.attendanceRecord.update({
              where: {
                sessionId_studentId: {
                  sessionId: preview.sessionId,
                  studentId: row.studentId,
                },
              },
              data: { status: row.status },
            });
            await audit(
              tx,
              user,
              "ATTENDANCE_CORRECTION",
              "AttendanceSession",
              preview.sessionId,
              {
                studentId: row.studentId,
                previousStatus: old.find((r) => r.studentId === row.studentId)!
                  .status,
                newStatus: row.status,
                reason: input.reason!,
              },
            );
          }
          if (changed.length)
            await tx.attendanceSession.update({
              where: { id: preview.sessionId },
              data: { version: { increment: 1 } },
            });
          return { sessionId: preview.sessionId, changed: changed.length };
        }
        check(
          input.sessionVersion === undefined,
          "This session no longer exists. Reload attendance.",
          409,
        );
        const session = await tx.attendanceSession.create({
          data: {
            ...key,
            markedById: user.id,
            submittedAt: new Date(),
            rosterSize: preview.total,
            records: {
              create: preview.rows.map((row) => ({
                studentId: row.studentId,
                status: row.status,
              })),
            },
          },
        });
        return { sessionId: session.id, changed: preview.total };
      });
    },
    async reports(user: PublicUser, filter: ReportFilter) {
      if (filter.offeringId) await offeringAccess(db, user, filter.offeringId);
      if (filter.classGroupId) await classAccess(db, user, filter.classGroupId);
      const scope: Prisma.CourseOfferingWhereInput = {
        ...(user.roles.includes("ADMIN")
          ? {}
          : { assignments: { some: { staffId: user.id } } }),
        ...(filter.offeringId ? { id: filter.offeringId } : {}),
        ...(filter.classGroupId ? { classGroupId: filter.classGroupId } : {}),
        classGroup: {
          ...(filter.termId ? { termId: filter.termId } : {}),
          ...(filter.section ? { section: filter.section } : {}),
        },
      };
      const offerings = await db.courseOffering.findMany({
        where: scope,
        include: offeringInclude,
      });
      const savedSessions = await db.attendanceSession.findMany({
        where: {
          offeringId: { in: offerings.map((o) => o.id) },
          submittedAt: { not: null },
          ...(filter.from || filter.to
            ? {
                date: {
                  ...(filter.from ? { gte: new Date(filter.from) } : {}),
                  ...(filter.to ? { lte: new Date(filter.to) } : {}),
                },
              }
            : {}),
        },
        include: {
          records: { include: { student: { include: studentInclude } } },
        },
        orderBy: [{ date: "desc" }, { period: "desc" }],
      });
      const sessions = savedSessions.filter(
        (s) => s.rosterSize > 0 && s.records.length === s.rosterSize,
      );
      const students = new Map<
        string,
        {
          studentId: string;
          registerNumber: string | null;
          name: string;
          linked: boolean;
          offeringId: string;
          present: number;
          conducted: number;
        }
      >();
      const memberships = await db.classEnrollment.findMany({
        where: {
          active: true,
          classGroupId: { in: offerings.map((o) => o.classGroupId) },
        },
        include: { student: { include: studentInclude } },
      });
      for (const offering of offerings)
        for (const enrollment of memberships.filter(
          (e) => e.classGroupId === offering.classGroupId,
        )) {
          students.set(offering.id + ":" + enrollment.studentId, {
            ...studentView(enrollment.student),
            offeringId: offering.id,
            present: 0,
            conducted: 0,
          });
        }
      for (const session of sessions)
        for (const record of session.records) {
          const key = session.offeringId + ":" + record.studentId;
          const row = students.get(key) ?? {
            ...studentView(record.student),
            offeringId: session.offeringId,
            present: 0,
            conducted: 0,
          };
          row.conducted++;
          if (record.status === "PRESENT") row.present++;
          students.set(key, row);
        }
      const summary = offerings.map((o) => {
        const related = sessions.filter((s) => s.offeringId === o.id);
        const records = related.flatMap((s) => s.records);
        const present = records.filter((r) => r.status === "PRESENT").length;
        return {
          offering: o,
          sessions: related.length,
          present,
          conducted: records.length,
          percentage: percentage(present, records.length),
        };
      });
      const classes = [...new Set(offerings.map((o) => o.classGroupId))].map(
        (classId) => {
          const rows = summary.filter(
            (r) => r.offering.classGroupId === classId,
          );
          const present = rows.reduce((sum, r) => sum + r.present, 0),
            conducted = rows.reduce((sum, r) => sum + r.conducted, 0);
          return {
            classGroup: offerings.find((o) => o.classGroupId === classId)!
              .classGroup,
            sessions: rows.reduce((sum, r) => sum + r.sessions, 0),
            present,
            conducted,
            percentage: percentage(present, conducted),
          };
        },
      );
      return {
        offerings,
        sessions: sessions.map((s) => ({
          id: s.id,
          offeringId: s.offeringId,
          date: s.date,
          period: s.period,
          version: s.version,
          total: s.records.length,
          present: s.records.filter((r) => r.status === "PRESENT").length,
          markedById: s.markedById,
        })),
        students: [...students.values()].map((s) => ({
          ...s,
          percentage: percentage(s.present, s.conducted),
        })),
        summary,
        classes,
        records: sessions.flatMap((s) =>
          s.records.map((r) => ({
            ...studentView(r.student),
            offeringId: s.offeringId,
            date: s.date.toISOString().slice(0, 10),
            period: s.period,
            status: r.status,
          })),
        ),
      };
    },
    async student(user: PublicUser) {
      // User-supplied IDs never participate in this query.
      const identity = await db.studentIdentity.findUnique({
        where: { userId: user.id },
      });
      if (!identity)
        return {
          linked: false,
          subjects: [],
          history: [],
          present: 0,
          conducted: 0,
          percentage: 0,
        };
      const memberships = await db.classEnrollment.findMany({
        where: { studentId: identity.id, active: true },
        select: { classGroupId: true },
      });
      const savedRecords = await db.attendanceRecord.findMany({
        where: {
          studentId: identity.id,
          session: { submittedAt: { not: null } },
        },
        include: {
          session: {
            include: {
              offering: { include: offeringInclude },
              _count: { select: { records: true } },
            },
          },
        },
        orderBy: [
          { session: { date: "desc" } },
          { session: { period: "desc" } },
        ],
      });
      const records = savedRecords.filter(
        (r) =>
          r.session.rosterSize > 0 &&
          r.session._count.records === r.session.rosterSize,
      );
      const offerings = await db.courseOffering.findMany({
        where: {
          OR: [
            { classGroupId: { in: memberships.map((m) => m.classGroupId) } },
            { id: { in: records.map((r) => r.session.offeringId) } },
          ],
        },
        include: offeringInclude,
      });
      const subjects = offerings.map((offering) => {
        const mine = records.filter(
          (r) => r.session.offeringId === offering.id,
        );
        const present = mine.filter((r) => r.status === "PRESENT").length;
        return {
          offering,
          present,
          conducted: mine.length,
          percentage: percentage(present, mine.length),
        };
      });
      const present = records.filter((r) => r.status === "PRESENT").length;
      return {
        linked: !!identity.registerNumber,
        registerNumber: identity.registerNumber,
        subjects,
        history: records.map((r) => ({
          offeringId: r.session.offeringId,
          date: r.session.date.toISOString().slice(0, 10),
          period: r.session.period,
          status: r.status,
        })),
        present,
        conducted: records.length,
        percentage: percentage(present, records.length),
      };
    },
    async audits(user: PublicUser, sessionId: string) {
      const session = await db.attendanceSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) throw new AccountError(404, "Session not found.");
      await offeringAccess(db, user, session.offeringId);
      return db.auditLog.findMany({
        where: {
          entityType: "AttendanceSession",
          entityId: sessionId,
          action: "ATTENDANCE_CORRECTION",
        },
        include: { actor: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
    },
  };
}
export type AttendanceService = ReturnType<typeof attendanceService>;
