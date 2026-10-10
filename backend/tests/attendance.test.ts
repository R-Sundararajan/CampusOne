import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import {
  authRepository,
  type PublicUser,
} from "../src/modules/auth/repository.js";
import { issueToken } from "../src/modules/auth/tokens.js";
import { attendanceService } from "../src/modules/attendance/service.js";
import type { AttendanceInput } from "../src/modules/attendance/validation.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "PostgreSQL attendance, rosters and privacy",
  () => {
    const db = createDatabase(
      process.env.TEST_DATABASE_URL ??
        "postgresql://unused:unused@localhost/unused",
    );
    const service = attendanceService(db);
    const key = "attendance-" + randomUUID();
    const origin = "http://127.0.0.1:5173",
      secret = "attendance-tests-only-secret-at-least-32-characters";
    let app: Awaited<ReturnType<typeof createApp>>;
    const users: Record<string, PublicUser> = {};
    const cookies: Record<string, string> = {};
    let termId: string,
      groupId: string,
      otherGroupId: string,
      offeringId: string,
      otherOfferingId: string,
      secondOfferingId: string,
      prefix: string;
    let sequence = 0;
    const post = (route: string, body: unknown, who = "staff") =>
      request(app)
        .post("/api/attendance" + route)
        .set("Origin", origin)
        .set("Cookie", cookies[who] ?? "")
        .send(body);
    const get = (route: string, who = "staff") =>
      request(app)
        .get("/api/attendance" + route)
        .set("Cookie", cookies[who] ?? "");
    const selection = (
      mode: AttendanceInput["mode"] = "PRESENT",
      input = "62,304",
      period = 1,
    ) => ({ offeringId, date: "2026-10-09", period, mode, input });
    async function save(body = selection(), who = "staff", extra: object = {}) {
      const p = await post("/preview", body, who);
      expect(p.status).toBe(200);
      return post(
        "/sessions",
        {
          ...body,
          rosterVersion: p.body.rosterVersion,
          confirmed: true,
          ...extra,
        },
        who,
      );
    }
    beforeAll(async () => {
      for (const [name, roles] of Object.entries({
        admin: ["ADMIN"],
        staff: ["STAFF"],
        outsider: ["STAFF"],
        student: ["STUDENT"],
        student2: ["STUDENT"],
        unlinked: ["STUDENT"],
        club: ["CLUB_HEAD"],
        multi: ["STUDENT", "STAFF", "CLUB_HEAD"],
      })) {
        const u = await db.user.create({
          data: {
            id: key + name,
            name,
            email: key + name + "@ssn.edu.in",
            passwordHash: "unused",
            roles: roles as PublicUser["roles"],
            department: "IT",
            emailVerifiedAt: new Date(),
          },
        });
        users[name] = u;
        cookies[name] = "campusone_token=" + (await issueToken(u.id, secret));
      }
      app = await createApp({
        config: {
          nodeEnv: "test",
          databaseUrl: process.env.TEST_DATABASE_URL!,
          appOrigin: origin,
          jwtSecret: secret,
          port: 3000,
        },
        auth: authRepository(db),
        checkDatabase: async () => {},
        attendance: service,
      });
    });
    beforeEach(async () => {
      const suffix = key + ++sequence;
      prefix =
        "991" +
        String(sequence).padStart(4, "0") +
        key.replace(/\D/g, "").slice(0, 6);
      const term = await service.createTerm(users.admin, suffix);
      termId = term.id;
      const group = await service.createClass(users.admin, {
        termId,
        department: "IT",
        admissionBatch: "2024",
        name: suffix,
        section: "A",
      });
      groupId = group.id;
      const other = await service.createClass(users.admin, {
        termId,
        department: "CS",
        admissionBatch: "2024",
        name: suffix,
        section: "B",
      });
      otherGroupId = other.id;
      offeringId = (
        await service.createOffering(users.admin, {
          classGroupId: groupId,
          code: suffix + "OS",
          name: "Operating Systems",
        })
      ).id;
      secondOfferingId = (
        await service.createOffering(users.admin, {
          classGroupId: groupId,
          code: suffix + "DB",
          name: "Databases",
        })
      ).id;
      otherOfferingId = (
        await service.createOffering(users.admin, {
          classGroupId: otherGroupId,
          code: suffix + "CN",
          name: "Networks",
        })
      ).id;
      await service.assign(users.admin, {
        offeringId,
        staffId: users.staff.id,
        assigned: true,
      });
      await service.assign(users.admin, {
        offeringId: secondOfferingId,
        staffId: users.staff.id,
        assigned: true,
      });
      await service.assign(users.admin, {
        offeringId: otherOfferingId,
        staffId: users.outsider.id,
        assigned: true,
      });
      await service.importRoster(users.admin, {
        classGroupId: groupId,
        prefix,
        suffixWidth: 3,
        input: "62,63,304",
        names: {},
        confirmed: true,
        rosterVersion: 0,
      });
      await service.link(users.admin, {
        registerNumber: prefix + "062",
        email: users.student.email,
        reason: "Verified test institutional roster",
        confirmed: true,
      });
      await service.link(users.admin, {
        registerNumber: prefix + "063",
        email: users.student2.email,
        reason: "Verified test institutional roster",
        confirmed: true,
      });
    });
    afterEach(async () => {
      const offeringIds = [offeringId, secondOfferingId, otherOfferingId];
      await db.attendanceSession.deleteMany({
        where: { offeringId: { in: offeringIds } },
      });
      await db.teachingAssignment.deleteMany({
        where: { offeringId: { in: offeringIds } },
      });
      await db.classEnrollment.deleteMany({
        where: { classGroupId: { in: [groupId, otherGroupId] } },
      });
      await db.studentIdentity.deleteMany({
        where: {
          OR: [
            { registerNumber: { startsWith: prefix } },
            { userId: { in: Object.values(users).map((u) => u.id) } },
          ],
        },
      });
      await db.courseOffering.deleteMany({
        where: { id: { in: offeringIds } },
      });
      await db.classGroup.deleteMany({
        where: { id: { in: [groupId, otherGroupId] } },
      });
      await db.subject.deleteMany({ where: { code: { startsWith: key } } });
      await db.academicTerm.deleteMany({ where: { id: termId } });
    });
    afterAll(async () => {
      await db.auditLog.deleteMany({
        where: { actorId: { in: Object.values(users).map((u) => u.id) } },
      });
      await db.user.deleteMany({ where: { id: { startsWith: key } } });
      await db.$disconnect();
    });
    it("supports additive, idempotent roster imports and shared subject membership", async () => {
      const input = {
        classGroupId: groupId,
        prefix,
        suffixWidth: 3,
        input: "62,062,305",
        names: {},
      };
      let p = await post("/rosters/preview", input);
      expect(p.body).toMatchObject({
        total: 2,
        existing: 1,
        added: 1,
        duplicates: ["062"],
      });
      expect(p.body.retained).toHaveLength(2);
      expect(
        (
          await post("/rosters/import", {
            ...input,
            confirmed: true,
            rosterVersion: p.body.rosterVersion,
          })
        ).status,
      ).toBe(201);
      p = await post("/rosters/preview", input);
      expect(
        (
          await post("/rosters/import", {
            ...input,
            confirmed: true,
            rosterVersion: p.body.rosterVersion,
          })
        ).status,
      ).toBe(201);
      expect(
        await db.classEnrollment.count({ where: { classGroupId: groupId } }),
      ).toBe(4);
      expect(
        (
          await post("/preview", {
            ...selection(),
            offeringId: secondOfferingId,
          })
        ).body.total,
      ).toBe(4);
      expect(
        (await get("/rosters/" + groupId)).body.rows.filter(
          (r: { linked: boolean }) => !r.linked,
        ),
      ).toHaveLength(2);
    });
    it("requires preview confirmation and rejects invalid roster entries or incompatible prefixes", async () => {
      const input = {
        classGroupId: groupId,
        prefix,
        suffixWidth: 3,
        input: "62,bad",
        names: {},
      };
      const p = await post("/rosters/preview", input);
      expect(p.body.errors.length).toBeGreaterThan(0);
      expect(
        (
          await post("/rosters/import", {
            ...input,
            confirmed: true,
            rosterVersion: p.body.rosterVersion,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post("/rosters/import", {
            ...input,
            input: "62",
            rosterVersion: p.body.rosterVersion,
          })
        ).status,
      ).toBe(400);
      const incompatible = await post("/rosters/preview", {
        ...input,
        input: "62",
        prefix: "999",
      });
      expect(incompatible.body.errors.join(" ")).toContain("does not match");
      expect(
        await db.classEnrollment.count({ where: { classGroupId: groupId } }),
      ).toBe(3);
    });
    it("rejects unassigned roster access and protects every Admin management route", async () => {
      expect((await get("/rosters/" + otherGroupId)).status).toBe(403);
      expect(
        (
          await post("/rosters/preview", {
            classGroupId: otherGroupId,
            prefix,
            suffixWidth: 3,
            input: "62",
          })
        ).status,
      ).toBe(403);
      for (const path of [
        "terms",
        "classes",
        "offerings",
        "assignments",
        "link",
      ])
        expect((await post("/admin/" + path, {}, "staff")).status).toBe(403);
      expect((await get("/admin/staff")).status).toBe(403);
      expect(
        (await get("/catalog")).body.offerings
          .map((o: { id: string }) => o.id)
          .sort(),
      ).toEqual([offeringId, secondOfferingId].sort());
    });
    it("supports present and absent lists and manual preview overrides against the exact roster", async () => {
      expect((await post("/preview", selection())).body).toMatchObject({
        total: 3,
        present: 2,
        absent: 1,
      });
      const p = await post("/preview", selection("ABSENT", "63"));
      expect(p.body).toMatchObject({ present: 2, absent: 1 });
      const student = p.body.rows.find(
        (r: { registerNumber: string }) => r.registerNumber === prefix + "304",
      );
      expect(
        (
          await post("/preview", {
            ...selection("ABSENT", "63"),
            overrides: [{ studentId: student.studentId, status: "ABSENT" }],
          })
        ).body,
      ).toMatchObject({ present: 1, absent: 2 });
      expect((await save(selection("ABSENT", "63"))).status).toBe(200);
      expect(
        await db.attendanceRecord.count({ where: { session: { offeringId } } }),
      ).toBe(3);
    });
    it("blocks empty input, unknown numbers, forged overrides and undeliberate all-class marking", async () => {
      for (const body of [
        selection("PRESENT", ""),
        selection("ABSENT", ""),
        selection("PRESENT", "999"),
      ]) {
        expect(
          (await post("/preview", body)).body.errors.length,
        ).toBeGreaterThan(0);
        expect((await save(body)).status).toBe(400);
      }
      expect((await save(selection("ALL_PRESENT", ""))).status).toBe(400);
      expect((await save(selection("ALL_ABSENT", ""))).status).toBe(400);
      expect((await save(selection("PRESENT", "62,63,304"))).status).toBe(400);
      expect(
        (
          await save(selection(), "staff", {
            overrides: [{ studentId: "forged", status: "PRESENT" }],
          })
        ).status,
      ).toBe(400);
      expect(await db.attendanceSession.count({ where: { offeringId } })).toBe(
        0,
      );
      expect(
        (
          await save(selection("ALL_PRESENT", ""), "staff", {
            allConfirmation: "PRESENT",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await save(selection("ALL_ABSENT", "", 2), "staff", {
            allConfirmation: "ABSENT",
          })
        ).status,
      ).toBe(200);
    });
    it("enforces assigned Staff editing and rejects Students, Club Heads and unassigned multi-role users", async () => {
      for (const who of [
        "student",
        "club",
        "outsider",
        "multi",
        "admin",
        "missing",
      ]) {
        const expected = who === "missing" ? 401 : 403;
        expect((await post("/preview", selection(), who)).status).toBe(
          expected,
        );
        expect(
          (
            await post(
              "/sessions",
              { ...selection(), confirmed: true, rosterVersion: 3 },
              who,
            )
          ).status,
        ).toBe(expected);
      }
      expect(
        (
          await post("/preview", {
            ...selection(),
            offeringId: otherOfferingId,
          })
        ).status,
      ).toBe(403);
      await service.assign(users.admin, {
        offeringId,
        staffId: users.multi.id,
        assigned: true,
      });
      expect((await save(selection(), "multi")).status).toBe(200);
      await service.assign(users.admin, {
        offeringId,
        staffId: users.multi.id,
        assigned: false,
      });
      expect((await post("/preview", selection(), "multi")).status).toBe(403);
    });
    it("prevents concurrent duplicate sessions and rejects creation over previously saved attendance", async () => {
      const p = await post("/preview", selection());
      const payload = {
        ...selection(),
        confirmed: true,
        rosterVersion: p.body.rosterVersion,
      };
      const results = await Promise.all([
        post("/sessions", payload),
        post("/sessions", payload),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await post("/sessions", payload)).status).toBe(409);
      expect(await db.attendanceSession.count({ where: { offeringId } })).toBe(
        1,
      );
      expect(
        await db.attendanceRecord.count({ where: { session: { offeringId } } }),
      ).toBe(3);
    });
    it("retains historical attendance through import, deactivation and new enrollment", async () => {
      expect((await save()).status).toBe(200);
      const roster = await get("/rosters/" + groupId);
      const student = roster.body.rows.find(
        (r: { registerNumber: string }) => r.registerNumber === prefix + "062",
      );
      expect(
        (
          await post("/rosters/" + groupId + "/membership", {
            studentId: student.studentId,
            active: false,
            reason: "Changed enrollment",
            confirmed: true,
            rosterVersion: roster.body.classGroup.rosterVersion,
          })
        ).status,
      ).toBe(204);
      const input = {
        classGroupId: groupId,
        prefix,
        suffixWidth: 3,
        input: "305",
        names: {},
      };
      const p = await post("/rosters/preview", input);
      expect(
        (
          await post("/rosters/import", {
            ...input,
            confirmed: true,
            rosterVersion: p.body.rosterVersion,
          })
        ).status,
      ).toBe(201);
      const old = await post("/preview", selection("EXISTING", ""));
      expect(old.body.total).toBe(3);
      expect(
        old.body.rows.map((r: { registerNumber: string }) => r.registerNumber),
      ).toContain(prefix + "062");
      expect(
        (await post("/preview", selection("ABSENT", "63", 2))).body.total,
      ).toBe(3);
      expect((await get("/student", "student")).body.conducted).toBe(1);
    });
    it("rejects stale roster previews without leaving a session", async () => {
      const p = await post("/preview", selection());
      const r = await service.rosterPreview(users.staff, {
        classGroupId: groupId,
        prefix,
        suffixWidth: 3,
        input: "305",
        names: {},
      });
      await service.importRoster(users.staff, {
        classGroupId: groupId,
        prefix,
        suffixWidth: 3,
        input: "305",
        names: {},
        confirmed: true,
        rosterVersion: r.rosterVersion,
      });
      expect(
        (
          await post("/sessions", {
            ...selection(),
            confirmed: true,
            rosterVersion: p.body.rosterVersion,
          })
        ).status,
      ).toBe(409);
      expect(await db.attendanceSession.count({ where: { offeringId } })).toBe(
        0,
      );
    });
    it("audits actual corrections, requires a reason, prevents stale updates and leaves unrelated sessions unchanged", async () => {
      expect((await save()).status).toBe(200);
      expect((await save(selection("PRESENT", "63", 2))).status).toBe(200);
      const p = await post("/preview", selection("EXISTING", ""));
      const changed = p.body.rows.find(
        (r: { registerNumber: string }) => r.registerNumber === prefix + "063",
      );
      const body = {
        ...selection("EXISTING", ""),
        rosterVersion: p.body.rosterVersion,
        sessionVersion: p.body.sessionVersion,
        confirmed: true,
        overrides: [{ studentId: changed.studentId, status: "PRESENT" }],
        allConfirmation: "PRESENT",
      };
      expect((await post("/sessions", body)).status).toBe(400);
      expect(
        (await post("/sessions", { ...body, reason: "Late arrival confirmed" }))
          .status,
      ).toBe(200);
      expect(
        (await post("/sessions", { ...body, reason: "Stale correction" }))
          .status,
      ).toBe(409);
      const audits = await get("/sessions/" + p.body.sessionId + "/audits");
      expect(audits.body.audits).toHaveLength(1);
      expect(audits.body.audits[0].changes).toMatchObject({
        studentId: changed.studentId,
        previousStatus: "ABSENT",
        newStatus: "PRESENT",
        reason: "Late arrival confirmed",
      });
      expect(audits.body.audits[0].actor.name).toBe("staff");
      const again = await post("/preview", selection("EXISTING", ""));
      expect(
        (
          await post("/sessions", {
            ...selection("EXISTING", ""),
            confirmed: true,
            allConfirmation: "PRESENT",
            reason: "Checked without change",
            rosterVersion: again.body.rosterVersion,
            sessionVersion: again.body.sessionVersion,
          })
        ).body.changed,
      ).toBe(0);
      expect(
        (await get("/sessions/" + p.body.sessionId + "/audits")).body.audits,
      ).toHaveLength(1);
      expect(
        (await post("/preview", selection("EXISTING", "", 2))).body,
      ).toMatchObject({ present: 1, absent: 2 });
      expect(
        (await get("/sessions/" + p.body.sessionId + "/audits", "outsider"))
          .status,
      ).toBe(403);
    });
    it("keeps student identity server-owned and blocks account linkage spoofing", async () => {
      expect((await save()).status).toBe(200);
      const mine = await get("/student", "student");
      expect(mine.body).toMatchObject({
        registerNumber: prefix + "062",
        present: 1,
        conducted: 1,
        percentage: 100,
      });
      expect(
        (await get("/student?studentId=" + users.student2.id, "student"))
          .status,
      ).toBe(400);
      expect(
        (await get("/student/" + users.student2.id, "student")).status,
      ).toBe(403);
      expect((await get("/reports", "student")).status).toBe(403);
      expect(
        (
          await post(
            "/admin/link",
            {
              registerNumber: prefix + "063",
              email: users.student.email,
              reason: "Pretend ownership",
              confirmed: true,
            },
            "student",
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await post(
            "/admin/link",
            {
              registerNumber: prefix + "063",
              email: users.student.email,
              reason: "Wrong verified identity",
              confirmed: true,
            },
            "admin",
          )
        ).status,
      ).toBe(409);
      expect((await get("/student", "student2")).body).toMatchObject({
        present: 0,
        conducted: 1,
        percentage: 0,
      });
    });
    it("rejects linkage to unverified or nonstudent accounts and reconciles legacy identities without discarding history", async () => {
      expect(
        (
          await post(
            "/admin/link",
            {
              registerNumber: prefix + "304",
              email: users.staff.email,
              reason: "Wrong account type",
              confirmed: true,
            },
            "admin",
          )
        ).status,
      ).toBe(400);
      await db.user.update({
        where: { id: users.multi.id },
        data: { emailVerifiedAt: null },
      });
      try {
        expect(
          (
            await post(
              "/admin/link",
              {
                registerNumber: prefix + "304",
                email: users.multi.email,
                reason: "Unverified student",
                confirmed: true,
              },
              "admin",
            )
          ).status,
        ).toBe(400);
      } finally {
        await db.user.update({
          where: { id: users.multi.id },
          data: { emailVerifiedAt: new Date() },
        });
      }
      const legacy = await db.studentIdentity.create({
        data: { userId: users.multi.id, name: "Legacy account" },
      });
      await db.classEnrollment.create({
        data: { studentId: legacy.id, classGroupId: otherGroupId },
      });
      expect(
        (
          await post(
            "/admin/link",
            {
              registerNumber: prefix + "304",
              email: users.multi.email,
              reason: "Verified legacy reconciliation",
              confirmed: true,
            },
            "admin",
          )
        ).status,
      ).toBe(204);
      expect(
        await db.studentIdentity.findUnique({ where: { id: legacy.id } }),
      ).toBeNull();
      const linked = await db.studentIdentity.findUniqueOrThrow({
        where: { userId: users.multi.id },
      });
      expect(linked.registerNumber).toBe(prefix + "304");
      expect(
        await db.classEnrollment.count({ where: { studentId: linked.id } }),
      ).toBe(2);
    });
    it("serializes simultaneous account linkage so a register number cannot be claimed twice", async () => {
      const payload = {
        registerNumber: prefix + "304",
        reason: "Validated test identity evidence",
        confirmed: true,
      };
      const results = await Promise.all([
        post("/admin/link", { ...payload, email: users.multi.email }, "admin"),
        post(
          "/admin/link",
          { ...payload, email: users.unlinked.email },
          "admin",
        ),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
      const identity = await db.studentIdentity.findUniqueOrThrow({
        where: { registerNumber: prefix + "304" },
      });
      expect([users.multi.id, users.unlinked.id]).toContain(identity.userId);
      expect(
        await db.studentIdentity.count({
          where: { userId: { in: [users.multi.id, users.unlinked.id] } },
        }),
      ).toBe(1);
    });
    it("calculates persisted subject/student/class reports, filters dates and excludes unsubmitted sessions", async () => {
      const empty = await get("/student", "student");
      expect(empty.body.subjects).toHaveLength(2);
      expect(empty.body.conducted).toBe(0);
      expect((await save()).status).toBe(200);
      expect((await save(selection("ABSENT", "62", 2))).status).toBe(200);
      await db.attendanceSession.create({
        data: {
          offeringId,
          date: new Date("2026-10-08"),
          period: 1,
          markedById: users.staff.id,
        },
      });
      const identity = await db.studentIdentity.findUniqueOrThrow({
        where: { userId: users.student.id },
      });
      await db.attendanceSession.create({
        data: {
          offeringId,
          date: new Date("2026-10-09"),
          period: 3,
          markedById: users.staff.id,
          submittedAt: new Date(),
          rosterSize: 3,
          records: { create: { studentId: identity.id, status: "PRESENT" } },
        },
      });
      const report = await get("/reports?from=2026-10-09&to=2026-10-09");
      expect(report.body.sessions).toHaveLength(2);
      const incomplete = await post("/preview", selection("EXISTING", "", 3));
      expect(incomplete.body.errors.join(" ")).toContain("incomplete");
      expect(
        report.body.summary.find(
          (r: { offering: { id: string } }) => r.offering.id === offeringId,
        ),
      ).toMatchObject({
        sessions: 2,
        present: 4,
        conducted: 6,
        percentage: 66.67,
      });
      expect(
        report.body.students.find(
          (r: { registerNumber: string }) =>
            r.registerNumber === prefix + "062",
        ),
      ).toMatchObject({ present: 1, conducted: 2, percentage: 50 });
      expect(report.body.classes[0]).toMatchObject({
        sessions: 2,
        present: 4,
        conducted: 6,
        percentage: 66.67,
      });
      expect((await get("/reports?from=2026-10-10")).body.sessions).toEqual([]);
      expect((await get("/reports?from=2026-10-10&to=2026-10-09")).status).toBe(
        400,
      );
      expect((await get("/reports?classGroupId=" + otherGroupId)).status).toBe(
        403,
      );
      expect((await get("/reports?offeringId=" + otherOfferingId)).status).toBe(
        403,
      );
      expect((await get("/student", "student")).body).toMatchObject({
        present: 1,
        conducted: 2,
        percentage: 50,
      });
    });
    it("exports authorized CSV records with correct dates, names and full register numbers", async () => {
      expect((await save()).status).toBe(200);
      const exported = await get("/reports.csv?from=2026-10-09&to=2026-10-09");
      expect(exported.status).toBe(200);
      expect(exported.headers["content-type"]).toContain("text/csv");
      expect(exported.text).toContain('"' + prefix + '062"');
      expect(exported.text).toContain('"2026-10-09","1"');
      expect(exported.text.split("\r\n")).toHaveLength(5);
      expect(
        (await get("/reports.csv?offeringId=" + otherOfferingId)).status,
      ).toBe(403);
      expect((await get("/reports.csv", "student")).status).toBe(403);
      expect((await get("/reports.csv", "club")).status).toBe(403);
      expect((await get("/reports.csv", "outsider")).text).not.toContain(
        prefix + "062",
      );
      expect((await get("/reports", "admin")).body.sessions).toHaveLength(1);
    });
    it("enforces student/session uniqueness in PostgreSQL", async () => {
      expect((await save()).status).toBe(200);
      const record = await db.attendanceRecord.findFirstOrThrow({
        where: { session: { offeringId } },
      });
      await expect(
        db.attendanceRecord.create({
          data: {
            sessionId: record.sessionId,
            studentId: record.studentId,
            status: "ABSENT",
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });
    it("rolls back the entire API save on an injected PostgreSQL record failure", async () => {
      // Fault injection is restricted to this disposable test database and this fixture's student.
      const target = await db.studentIdentity.findUniqueOrThrow({
        where: { registerNumber: prefix + "063" },
      });
      const functionName = "attendance_fail_" + sequence;
      await db.$executeRawUnsafe(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."studentId" = '${target.id}' THEN RAISE EXCEPTION 'test record failure'; END IF; RETURN NEW; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER ${functionName} BEFORE INSERT ON "AttendanceRecord" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      try {
        expect((await save()).status).toBe(500);
        expect(
          await db.attendanceSession.count({ where: { offeringId } }),
        ).toBe(0);
        expect(
          await db.attendanceRecord.count({ where: { studentId: target.id } }),
        ).toBe(0);
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER ${functionName} ON "AttendanceRecord"`,
        );
        await db.$executeRawUnsafe(`DROP FUNCTION ${functionName}()`);
      }
    });
    it("rolls back status changes if correction audit persistence fails", async () => {
      expect((await save()).status).toBe(200);
      const p = await post("/preview", selection("EXISTING", ""));
      const target = p.body.rows.find(
        (r: { registerNumber: string }) => r.registerNumber === prefix + "062",
      );
      const functionName = "attendance_audit_fail_" + sequence;
      await db.$executeRawUnsafe(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId" = '${p.body.sessionId}' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER ${functionName} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      try {
        expect(
          (
            await post("/sessions", {
              ...selection("EXISTING", ""),
              confirmed: true,
              rosterVersion: p.body.rosterVersion,
              sessionVersion: p.body.sessionVersion,
              reason: "Fault injection correction",
              overrides: [{ studentId: target.studentId, status: "ABSENT" }],
            })
          ).status,
        ).toBe(500);
        expect(
          (
            await db.attendanceRecord.findUniqueOrThrow({
              where: {
                sessionId_studentId: {
                  sessionId: p.body.sessionId,
                  studentId: target.studentId,
                },
              },
            })
          ).status,
        ).toBe("PRESENT");
        expect(
          (
            await db.attendanceSession.findUniqueOrThrow({
              where: { id: p.body.sessionId },
            })
          ).version,
        ).toBe(p.body.sessionVersion);
        expect(
          await db.auditLog.count({ where: { entityId: p.body.sessionId } }),
        ).toBe(0);
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER ${functionName} ON "AuditLog"`,
        );
        await db.$executeRawUnsafe(`DROP FUNCTION ${functionName}()`);
      }
    });
  },
);
