import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createDatabase } from "../src/db.js";
import { hashPassword } from "../src/modules/auth/routes.js";

// Only a disposable database explicitly supplied by the operator/CI is accepted.
const url = process.env.TEST_DATABASE_URL;
if (!url || !/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must name an isolated test database");
const db = createDatabase(url), key = "upgrade-" + randomUUID();
const migrate = () => execFileSync(process.execPath, ["../node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe", timeout: 60000 });
const bytes = new Uint8Array([10, 20, 30, 40]);
try {
  // Phase 5 deliberately keeps the Phase 4 schema and all seven migration checksums.
  // Populate that schema with representative synthetic data before reapplying deployment migrations.
  const passwordHash = await hashPassword("UpgradeSynthetic!2026");
  await db.$transaction(async tx => {
    for (const [suffix, roles] of [["student", ["STUDENT", "CLUB_HEAD"]], ["staff", ["STAFF", "ADMIN"]]] as const)
      await tx.user.create({ data: { id: key + suffix, name: suffix, email: `${key}${suffix}@ssn.edu.in`, passwordHash, department: "Synthetic", roles: [...roles], emailVerifiedAt: new Date() } });
    await tx.classGroup.create({ data: { id: key, name: key, section: "A", academicYear: "2026" } });
    await tx.subject.create({ data: { id: key, code: key, name: "Synthetic subject" } });
    await tx.courseOffering.create({ data: { id: key, classGroupId: key, subjectId: key } });
    await tx.studentIdentity.create({ data: { id: key, registerNumber: "991" + Date.now(), userId: key + "student" } });
    await tx.classEnrollment.create({ data: { studentId: key, classGroupId: key } });
    await tx.teachingAssignment.create({ data: { staffId: key + "staff", offeringId: key } });
    await tx.attendanceSession.create({ data: { id: key, offeringId: key, date: new Date("2026-10-09"), period: 1, markedById: key + "staff", submittedAt: new Date(), rosterSize: 1 } });
    await tx.attendanceRecord.create({ data: { sessionId: key, studentId: key, status: "PRESENT" } });
    await tx.club.create({ data: { id: key, name: key } });
    await tx.clubAssignment.create({ data: { clubId: key, userId: key + "student" } });
    await tx.event.create({ data: { id: key, name: key, clubId: key, creatorId: key + "student", status: "PUBLISHED", startsAt: new Date("2026-12-01"), registrationEndsAt: new Date("2026-11-30") } });
    await tx.eventRegistration.create({ data: { eventId: key, studentId: key + "student" } });
    await tx.complaint.create({ data: { id: key, title: key, description: "Synthetic complaint", submitterId: key + "student", supervisorId: key + "staff", supervisorGroup: "PG", assignedAt: new Date(), status: "ACCEPTED", studentGroup: "PG", routingConfirmed: true, routingSource: "CONFIRMED", verifiedById: key + "staff", verifiedAt: new Date() } });
    await tx.complaintNote.create({ data: { complaintId: key, authorId: key + "staff", text: "Synthetic private coordination" } });
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(731003)::text`;
    await tx.image.create({ data: { eventId: key, bytes, mimeType: "image/png", sizeBytes: bytes.length } });
    await tx.imageBudget.upsert({ where: { id: 1 }, create: { id: 1, usedBytes: bytes.length }, update: { usedBytes: { increment: bytes.length } } });
  });
  const priorSlot = await db.complaintSupervisorAssignment.findUniqueOrThrow({ where: { studentGroup: "PG" } });
  await db.complaintSupervisorAssignment.update({ where: { studentGroup: "PG" }, data: { userId: key + "staff", assignedById: key + "staff" } });
  async function snapshot() {
    const values = await Promise.all([
      db.user.findMany({ where: { id: { startsWith: key } }, orderBy: { id: "asc" } }),
      db.attendanceSession.findUnique({ where: { id: key }, include: { records: true } }),
      db.event.findUnique({ where: { id: key }, include: { registrations: true, image: true } }),
      db.complaint.findUnique({ where: { id: key }, include: { notes: true } }),
      db.complaintSupervisorAssignment.findUnique({ where: { studentGroup: "PG" } }),
      db.imageBudget.findUnique({ where: { id: 1 } }),
      db.classEnrollment.findMany({ where: { classGroupId: key } }),
      db.studentIdentity.findUnique({ where: { id: key } }),
      db.teachingAssignment.findMany({ where: { offeringId: key } }),
      db.clubAssignment.findMany({ where: { clubId: key } }),
      db.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`,
    ]);
    return JSON.stringify(values);
  }
  const before = await snapshot();
  try {
    migrate(); assert.equal(await snapshot(), before, "Upgrade changed representative Phase 4 data");
    migrate(); assert.equal(await snapshot(), before, "Repeated migration changed representative data");
    const chain = await db.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`;
    assert.equal(chain.length, 7);
    for (const migration of chain) {
      assert.ok(migration.finished_at); assert.equal(migration.rolled_back_at, null);
      const sql = readFileSync(`prisma/migrations/${migration.migration_name}/migration.sql`);
      assert.equal(migration.checksum, createHash("sha256").update(sql).digest("hex"));
    }
    const sum = await db.image.aggregate({ _sum: { sizeBytes: true } });
    assert.equal((await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })).usedBytes, sum._sum.sizeBytes ?? 0);
    console.log("PASS: 7 migration checksums; Phase 4 users, hashes, roles, attendance, event registrations, complaints, Supervisor assignment, private notes, image bytes and quota survive two migrate-deploy runs.");
  } finally {
    await db.complaintSupervisorAssignment.update({ where: { studentGroup: "PG" }, data: { userId: priorSlot.userId, assignedById: priorSlot.assignedById, version: priorSlot.version, updatedAt: priorSlot.updatedAt } });
  }
} finally {
  await db.$transaction(async tx => {
    const total = await tx.image.aggregate({ where: { eventId: key }, _sum: { sizeBytes: true } });
    await tx.image.deleteMany({ where: { eventId: key } });
    await tx.imageBudget.updateMany({ where: { id: 1 }, data: { usedBytes: { decrement: total._sum.sizeBytes ?? 0 } } });
    await tx.complaintNote.deleteMany({ where: { complaintId: key } });
    await tx.complaint.deleteMany({ where: { id: key } });
    await tx.complaintSupervisorAssignment.updateMany({ where: { userId: key + "staff" }, data: { userId: null, assignedById: null } });
    await tx.eventRegistration.deleteMany({ where: { eventId: key } });
    await tx.event.deleteMany({ where: { id: key } });
    await tx.clubAssignment.deleteMany({ where: { clubId: key } });
    await tx.club.deleteMany({ where: { id: key } });
    await tx.attendanceSession.deleteMany({ where: { id: key } });
    await tx.teachingAssignment.deleteMany({ where: { offeringId: key } });
    await tx.courseOffering.deleteMany({ where: { id: key } });
    await tx.classEnrollment.deleteMany({ where: { classGroupId: key } });
    await tx.studentIdentity.deleteMany({ where: { id: key } });
    await tx.subject.deleteMany({ where: { id: key } });
    await tx.classGroup.deleteMany({ where: { id: key } });
    await tx.user.deleteMany({ where: { id: { startsWith: key } } });
  });
  await db.$disconnect();
}
