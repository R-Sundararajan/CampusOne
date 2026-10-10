import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import { authRepository } from "../src/modules/auth/repository.js";
import { hashPassword } from "../src/modules/auth/routes.js";
import { issueToken } from "../src/modules/auth/tokens.js";
import { registrationSchema } from "../src/modules/registration/validation.js";
import { registrationService } from "../src/modules/registration/service.js";
import { createMailer, type VerificationMail } from "../src/services/mail.js";
import type { Config } from "../src/config.js";

const origin = "http://127.0.0.1:5173";
const secret = "registration-test-only-secret-at-least-32-characters";
const password = "RegistrationTest!2026";
const config: Config = {
  nodeEnv: "test",
  port: 3000,
  appOrigin: origin,
  jwtSecret: secret,
  databaseUrl:
    process.env.TEST_DATABASE_URL ??
    "postgresql://unused:unused@localhost/unused",
};
const input = (email: string, accountType = "STUDENT") => ({
  fullName: "Registration Test",
  email,
  accountType,
  password,
  confirmPassword: password,
});

describe("Registration input and production mail boundaries", () => {
  it("normalizes exact institutional addresses and rejects lookalikes and injected privileges", () => {
    expect(
      registrationSchema.parse(input("  STUDENT@SSN.EDU.IN  ")).email,
    ).toBe("student@ssn.edu.in");
    for (const email of [
      "s@gmail.com",
      "s@fake-ssn.edu.in",
      "s@ssn.edu.in.attacker.com",
      "s@sub.ssn.edu.in",
      "s@ssn.edu.in@attacker.com",
      "s@ssn.edu.іn",
    ]) {
      expect(registrationSchema.safeParse(input(email)).success).toBe(false);
    }
    expect(
      registrationSchema.safeParse(input("s@ssn.edu.in", "ADMIN")).success,
    ).toBe(false);
    expect(
      registrationSchema.safeParse({
        ...input("s@ssn.edu.in"),
        roles: ["ADMIN"],
        active: true,
        emailVerifiedAt: new Date(),
      }).success,
    ).toBe(false);
    expect(
      registrationSchema.safeParse({
        ...input("s@ssn.edu.in"),
        confirmPassword: "mismatch",
      }).success,
    ).toBe(false);
  });
  it("never falls back to development verification in production or at a public origin", () => {
    expect(() =>
      createMailer(
        { ...config, nodeEnv: "production" },
        { MAIL_MODE: "development" },
      ),
    ).toThrow("non-production");
    expect(() =>
      createMailer(
        { ...config, appOrigin: "https://campus.example" },
        { MAIL_MODE: "development" },
      ),
    ).toThrow("local");
    expect(() =>
      createMailer({ ...config, nodeEnv: "production" }, {}),
    ).toThrow("SMTP configuration");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "PostgreSQL registration and approval",
  () => {
    const db = createDatabase(config.databaseUrl);
    const prefix = "registration-" + randomUUID();
    const adminId = prefix + "-admin";
    const studentId = prefix + "-student";
    const clubId = prefix + "-club";
    const offeringId = prefix + "-offering";
    let app: Awaited<ReturnType<typeof createApp>>;
    let sent: VerificationMail[] = [];
    let adminCookie: string;
    let studentCookie: string;
    let count = 0;
    const nextEmail = () => prefix + "-" + ++count + "@ssn.edu.in";
    const post = (route: string, body: unknown, cookie?: string) =>
      request(app)
        .post("/api" + route)
        .set("Origin", origin)
        .set("Cookie", cookie ?? "")
        .send(body);
    const tokenFor = (email: string) =>
      new URL(sent.findLast((m) => m.to === email)!.url).hash.split("=")[1];
    const register = async (type = "STUDENT") => {
      const email = nextEmail();
      expect((await post("/auth/register", input(email, type))).status).toBe(
        202,
      );
      return {
        email,
        user: await db.user.findUniqueOrThrow({ where: { email } }),
        token: tokenFor(email),
      };
    };
    beforeAll(async () => {
      const passwordHash = await hashPassword(password);
      await db.user.createMany({
        data: [
          {
            id: adminId,
            name: "Test Admin",
            email: adminId + "@ssn.edu.in",
            passwordHash,
            roles: ["ADMIN"],
            department: "",
            emailVerifiedAt: new Date(),
          },
          {
            id: studentId,
            name: "Test Student",
            email: studentId + "@ssn.edu.in",
            passwordHash,
            roles: ["STUDENT"],
            department: "",
            emailVerifiedAt: new Date(),
          },
        ],
      });
      await db.club.create({ data: { id: clubId, name: clubId } });
      await db.classGroup.create({
        data: {
          id: offeringId,
          name: offeringId,
          section: "A",
          academicYear: "2026",
        },
      });
      await db.subject.create({
        data: { id: offeringId, code: offeringId, name: "Testing" },
      });
      await db.courseOffering.create({
        data: {
          id: offeringId,
          classGroupId: offeringId,
          subjectId: offeringId,
        },
      });
      adminCookie = "campusone_token=" + (await issueToken(adminId, secret));
      studentCookie =
        "campusone_token=" + (await issueToken(studentId, secret));
    });
    beforeEach(async () => {
      sent = [];
      app = await createApp({
        config,
        auth: authRepository(db),
        checkDatabase: async () => {},
        registration: registrationService(
          db,
          async (mail) => {
            sent.push(mail);
          },
          origin,
        ),
      });
    });
    afterAll(async () => {
      const ids = (
        await db.user.findMany({
          where: { email: { startsWith: prefix } },
          select: { id: true },
        })
      ).map((u) => u.id);
      await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
      await db.clubAssignment.deleteMany({ where: { userId: { in: ids } } });
      await db.teachingAssignment.deleteMany({
        where: { staffId: { in: ids } },
      });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await db.club.delete({ where: { id: clubId } });
      await db.courseOffering.delete({ where: { id: offeringId } });
      await db.subject.delete({ where: { id: offeringId } });
      await db.classGroup.delete({ where: { id: offeringId } });
      await db.$disconnect();
    });
    it("blocks access before verification, hashes the token, and activates only Student after single use", async () => {
      const { email, user, token } = await register();
      expect(user.roles).toEqual([]);
      expect(user.emailVerifiedAt).toBeNull();
      const stored = await db.emailVerification.findUniqueOrThrow({
        where: { userId: user.id },
      });
      expect(stored.tokenHash).not.toBe(token);
      expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
        30 * 60_000,
      );
      expect((await post("/auth/login", { email, password })).status).toBe(401);
      const forged = "campusone_token=" + (await issueToken(user.id, secret));
      expect(
        (await request(app).get("/api/auth/me").set("Cookie", forged)).status,
      ).toBe(401);
      const results = await Promise.all([
        post("/auth/verify", { token }),
        post("/auth/verify", { token }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      expect(
        (await post("/auth/login", { email: email.toUpperCase(), password }))
          .body.user.roles,
      ).toEqual(["STUDENT"]);
    });
    it("preserves an existing account on duplicate normalized registration", async () => {
      const { email, user } = await register();
      const duplicate = await post("/auth/register", {
        ...input(email.toUpperCase(), "STAFF"),
        password: "DifferentPassword!2026",
        confirmPassword: "DifferentPassword!2026",
      });
      const unknown = await post("/auth/verification/resend", {
        email: nextEmail(),
      });
      expect(duplicate.status).toBe(202);
      expect(duplicate.body).toEqual(unknown.body);
      expect(await db.user.count({ where: { email } })).toBe(1);
      expect(
        (await db.user.findUniqueOrThrow({ where: { email } })).passwordHash,
      ).toBe(user.passwordHash);
      expect(sent).toHaveLength(1);
    });
    it("rejects expired links; resend replaces the old token", async () => {
      const { email, user, token } = await register();
      await db.emailVerification.update({
        where: { userId: user.id },
        data: { expiresAt: new Date(0), createdAt: new Date(0) },
      });
      expect((await post("/auth/verify", { token })).status).toBe(400);
      await post("/auth/verification/resend", { email });
      const replacement = tokenFor(email);
      expect(replacement).not.toBe(token);
      expect((await post("/auth/verify", { token })).status).toBe(400);
      expect((await post("/auth/verify", { token: replacement })).status).toBe(
        200,
      );
    });
    it("rejects non-institutional domains and privilege injection through the API", async () => {
      for (const body of [
        input("u@ssn.edu.in.attacker.com"),
        input(nextEmail(), "ADMIN"),
        { ...input(nextEmail()), roles: ["ADMIN"] },
        { ...input(nextEmail()), active: true },
      ]) {
        expect((await post("/auth/register", body)).status).toBe(400);
      }
      expect(
        (await request(app).post("/api/auth/register").send(input(nextEmail())))
          .status,
      ).toBe(403);
    });
    it("requires email verification and Admin permission before approving Staff, then grants only selected assignments", async () => {
      const { email, user, token } = await register("STAFF");
      const roleRequest = await db.roleRequest.findFirstOrThrow({
        where: { userId: user.id },
      });
      const route = "/admin/role-requests/" + roleRequest.id + "/decision";
      const decision = { decision: "APPROVED", offeringIds: [offeringId] };
      expect((await post(route, decision, adminCookie)).status).toBe(409);
      expect((await post("/auth/verify", { token })).body.status).toBe(
        "pending_approval",
      );
      expect((await post("/auth/login", { email, password })).status).toBe(401);
      expect((await post(route, decision, studentCookie)).status).toBe(403);
      expect((await post(route, decision)).status).toBe(401);
      expect(
        (await post(route, { ...decision, roles: ["ADMIN"] }, adminCookie))
          .status,
      ).toBe(400);
      const results = await Promise.all([
        post(route, decision, adminCookie),
        post(route, decision, adminCookie),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
      expect(
        (await post("/auth/login", { email, password })).body.user.roles,
      ).toEqual(["STAFF"]);
      expect(
        await db.teachingAssignment.findMany({ where: { staffId: user.id } }),
      ).toEqual([{ staffId: user.id, offeringId }]);
      expect(
        await db.clubAssignment.count({ where: { userId: user.id } }),
      ).toBe(0);
      expect(
        await db.auditLog.count({ where: { entityId: roleRequest.id } }),
      ).toBe(1);
    });
    it("preserves Student when granting Club Head and rolls back missing or invalid club assignments", async () => {
      expect(
        (await post("/auth/role-requests", { role: "ADMIN" }, studentCookie))
          .status,
      ).toBe(400);
      expect(
        (
          await post(
            "/auth/role-requests",
            { role: "CLUB_HEAD" },
            studentCookie,
          )
        ).status,
      ).toBe(201);
      expect(
        (
          await post(
            "/auth/role-requests",
            { role: "CLUB_HEAD" },
            studentCookie,
          )
        ).status,
      ).toBe(409);
      const r = await db.roleRequest.findFirstOrThrow({
        where: { userId: studentId, role: "CLUB_HEAD" },
      });
      const route = "/admin/role-requests/" + r.id + "/decision";
      for (const body of [
        { decision: "APPROVED" },
        { decision: "APPROVED", clubId: "missing" },
      ])
        expect((await post(route, body, adminCookie)).status).toBe(400);
      expect(
        (await db.roleRequest.findUniqueOrThrow({ where: { id: r.id } }))
          .status,
      ).toBe("PENDING");
      expect(
        (await post(route, { decision: "APPROVED", clubId }, adminCookie))
          .status,
      ).toBe(204);
      expect(
        (await request(app).get("/api/auth/me").set("Cookie", studentCookie))
          .body.user.roles,
      ).toEqual(["STUDENT", "CLUB_HEAD"]);
      expect(
        await db.clubAssignment.findMany({ where: { userId: studentId } }),
      ).toEqual([{ userId: studentId, clubId }]);
    });
    it("requires a rejection reason and grants no privileges when rejected", async () => {
      const { user, token } = await register("CLUB_HEAD");
      await post("/auth/verify", { token });
      const r = await db.roleRequest.findFirstOrThrow({
        where: { userId: user.id },
      });
      const route = "/admin/role-requests/" + r.id + "/decision";
      expect(
        (await post(route, { decision: "REJECTED", reason: " " }, adminCookie))
          .status,
      ).toBe(400);
      expect(
        (
          await post(
            route,
            {
              decision: "REJECTED",
              reason: "Club responsibility not confirmed",
            },
            adminCookie,
          )
        ).status,
      ).toBe(204);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: user.id } })).roles,
      ).toEqual([]);
      expect(
        await db.clubAssignment.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
    it("keeps request data private and limits signup and verification attempts", async () => {
      expect(
        (
          await request(app)
            .get("/api/admin/role-requests")
            .set("Cookie", studentCookie)
        ).status,
      ).toBe(403);
      const mine = await request(app)
        .get("/api/auth/role-requests")
        .set("Cookie", studentCookie);
      expect(
        mine.body.requests.every(
          (r: { role: string }) => r.role === "CLUB_HEAD",
        ),
      ).toBe(true);
      for (let i = 0; i < 10; i++)
        expect((await post("/auth/register", {})).status).toBe(400);
      expect((await post("/auth/register", {})).status).toBe(429);
      for (let i = 0; i < 20; i++)
        expect(
          (await post("/auth/verify", { token: "0".repeat(64) })).status,
        ).toBe(400);
      expect(
        (await post("/auth/verify", { token: "0".repeat(64) })).status,
      ).toBe(429);
    });
    it("keeps accounts inactive after mail failure and permits delivery retry", async () => {
      const email = nextEmail();
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const service = registrationService(
          db,
          async () => {
            throw new Error("Offline");
          },
          origin,
        );
        await service.register(registrationSchema.parse(input(email)));
        const user = await db.user.findUniqueOrThrow({ where: { email } });
        expect(user.emailVerifiedAt).toBeNull();
        expect(
          await db.emailVerification.count({ where: { userId: user.id } }),
        ).toBe(0);
        await post("/auth/verification/resend", { email });
        expect(sent).toHaveLength(1);
      } finally {
        errorLog.mockRestore();
      }
    });
    it("allows synthetic accounts only in the explicit development repository", async () => {
      const email = nextEmail();
      const user = await db.user.create({
        data: {
          email,
          name: "Demo",
          passwordHash: await hashPassword(password),
          roles: ["STUDENT"],
          department: "",
          isDemo: true,
          emailVerifiedAt: new Date(),
        },
      });
      expect(await authRepository(db).findActiveUser(user.id)).toBeNull();
      expect(await authRepository(db).findForLogin(email)).toBeNull();
      expect((await authRepository(db, true).findForLogin(email))?.id).toBe(
        user.id,
      );
    });
  },
);
