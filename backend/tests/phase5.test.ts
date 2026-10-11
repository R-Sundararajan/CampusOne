import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import request from "supertest";
import sharp from "sharp";
import argon2 from "argon2";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { createDatabase } from "../src/db.js";
import { authRepository, type PublicUser } from "../src/modules/auth/repository.js";
import { hashPassword } from "../src/modules/auth/routes.js";
import { issueToken } from "../src/modules/auth/tokens.js";
import { registrationService } from "../src/modules/registration/service.js";
import { attendanceService } from "../src/modules/attendance/service.js";
import { eventsService } from "../src/modules/events/service.js";
import { complaintsService } from "../src/modules/complaints/service.js";
import { groups } from "../src/modules/complaints/validation.js";
import { createMailer } from "../src/services/mail.js";
import { MAX_STORED_BYTES, validateImage } from "../src/services/image-storage.js";

const mode = "domain-only-demo" as const;
const origin = "https://campusone-test.example";
const password = "PhaseFiveSynthetic!2026";
const secret = "phase-five-test-only-secret-at-least-32-characters";
const url = process.env.TEST_DATABASE_URL ?? "postgresql://unused:unused@localhost/unused";
const config: Config = { nodeEnv: "production", appOrigin: origin, databaseUrl: url, jwtSecret: secret, port: 3000, institutionalAuthMode: mode };
const input = (email: string, accountType = "STUDENT") => ({ fullName: "Synthetic Person", email, accountType, password, confirmPassword: password });

describe("Explicit institutional demo configuration", () => {
  it("permits production without any SMTP settings and rejects unknown modes", async () => {
    const env = { NODE_ENV: "production", APP_ORIGIN: origin, DATABASE_URL: url, JWT_SECRET: secret, INSTITUTIONAL_AUTH_MODE: mode };
    const loaded = loadConfig(env);
    expect(loaded.institutionalAuthMode).toBe(mode);
    await expect(createMailer(loaded, {})({ to: "test@ssn.edu.in", url: origin })).resolves.toBeUndefined();
    expect(() => loadConfig({ ...env, INSTITUTIONAL_AUTH_MODE: "trust-all" })).toThrow("INSTITUTIONAL_AUTH_MODE");
    expect(loadConfig({ ...env, INSTITUTIONAL_AUTH_MODE: undefined }).institutionalAuthMode).toBe("email-verification");
    expect(() => createMailer({ ...loaded, institutionalAuthMode: "email-verification" }, {})).toThrow("SMTP");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("Integrated production demo registration and module boundaries", () => {
  const db = createDatabase(url), key = "phase5-" + randomUUID();
  const users: Record<string, PublicUser> = {}, cookies: Record<string, string> = {};
  const sent = vi.fn(async () => {});
  const registration = registrationService(db, sent, origin, mode, false);
  const attendance = attendanceService(db, mode, false);
  const events = eventsService(db, () => new Date("2026-10-10T08:00:00Z"), mode);
  const complaints = complaintsService(db, false, mode);
  let app: Awaited<ReturnType<typeof createApp>>, clubId: string, classId: string, offeringId: string;
  let sequence = 0;
  const email = () => `${key}-${++sequence}@ssn.edu.in`;
  const get = (path: string, who = "student") => request(app).get("/api" + path).set("Cookie", cookies[who] ?? "");
  const post = (path: string, body: unknown, who = "student") => request(app).post("/api" + path).set("Origin", origin).set("Cookie", cookies[who] ?? "").send(body);
  async function register(type = "STUDENT") {
    const address = email();
    const result = await post("/auth/register", input(address, type));
    expect(result.status, JSON.stringify(result.body)).toBe(202);
    return { address, user: await db.user.findUniqueOrThrow({ where: { email: address } }), result };
  }
  async function event() {
    const created = await post("/events", { clubId, name: "Integrated event", description: "Synthetic integration workshop", venue: "Test hall", startsAt: "2026-10-15T10:00:00Z", registrationEndsAt: "2026-10-14T10:00:00Z" }, "head");
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body as { id: string; version: number };
  }
  async function complaint(who = "student") {
    const result = await post("/complaints", { title: "Synthetic facilities issue", description: "For integration tests only", ...(who !== "staff" ? { studentGroup: "UG_I" } : {}) }, who);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body as { id: string; version: number };
  }
  const png = () => sharp({ create: { width: 20, height: 30, channels: 3, background: "#365a45" } }).png().toBuffer();
  const upload = (path: string, bytes: Buffer, who: string) => request(app).post("/api" + path).set("Origin", origin).set("Cookie", cookies[who]).set("Content-Type", "image/png").send(bytes);
  beforeAll(async () => {
    if (!/test/i.test(new URL(url).pathname)) throw new Error("Phase 5 requires a disposable named test database");
    const passwordHash = await hashPassword(password);
    for (const [name, roles] of Object.entries({ admin: ["ADMIN"], student: ["STUDENT"], other: ["STUDENT"], head: ["STUDENT", "CLUB_HEAD"], staff: ["STAFF"], replacement: ["STAFF"] })) {
      users[name] = await db.user.create({ data: { name, email: `${key}-${name}@ssn.edu.in`, passwordHash, department: "Synthetic", roles: roles as PublicUser["roles"] } });
      cookies[name] = "campusone_token=" + await issueToken(users[name].id, secret);
    }
    clubId = (await db.club.create({ data: { name: key } })).id;
    await db.clubAssignment.create({ data: { clubId, userId: users.head.id } });
    const term = await attendance.createTerm(users.admin, key);
    const group = await attendance.createClass(users.admin, { termId: term.id, name: key, section: "A", admissionBatch: "2026", department: "Test" });
    classId = group.id;
    offeringId = (await attendance.createOffering(users.admin, { classGroupId: classId, code: key, name: "Integration" })).id;
    await attendance.assign(users.admin, { staffId: users.staff.id, offeringId, assigned: true, identityConfirmed: true });
    const roster = { classGroupId: classId, prefix: "995510", suffixWidth: 3, input: "1,2", names: {} };
    const preview = await attendance.rosterPreview(users.admin, roster);
    await attendance.importRoster(users.admin, { ...roster, confirmed: true, rosterVersion: preview.rosterVersion });
    await attendance.link(users.admin, { registerNumber: "995510001", email: users.head.email, reason: "Synthetic fixture identity review", confirmed: true, identityConfirmed: true });
  });
  beforeEach(async () => {
    vi.restoreAllMocks(); sent.mockClear();
    app = await createApp({ config, auth: authRepository(db, false, mode), registration, attendance, events, complaints, checkDatabase: async () => { await db.$queryRaw`SELECT 1`; } });
    await db.complaintSupervisorAssignment.updateMany({ data: { userId: null, assignedById: null, version: 1 } });
  });
  afterAll(async () => {
    const ids = (await db.user.findMany({ where: { email: { startsWith: key } }, select: { id: true } })).map(u => u.id);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(731003)::text`;
      const where = { OR: [{ event: { clubId } }, { complaint: { submitterId: { in: ids } } }] };
      const total = await tx.image.aggregate({ where, _sum: { sizeBytes: true } });
      await tx.image.deleteMany({ where });
      await tx.imageBudget.updateMany({ data: { usedBytes: { decrement: total._sum.sizeBytes ?? 0 } } });
      await tx.complaintNote.deleteMany({ where: { authorId: { in: ids } } });
      await tx.complaint.deleteMany({ where: { submitterId: { in: ids } } });
      await tx.complaintSupervisorAssignment.updateMany({ data: { userId: null, assignedById: null, version: 1 } });
      await tx.eventRegistration.deleteMany({ where: { event: { clubId } } });
      await tx.event.deleteMany({ where: { clubId } });
      await tx.clubAssignment.deleteMany({ where: { clubId } });
      await tx.club.delete({ where: { id: clubId } });
      await tx.attendanceSession.deleteMany({ where: { offeringId } });
      await tx.teachingAssignment.deleteMany({ where: { offeringId } });
      await tx.courseOffering.delete({ where: { id: offeringId } });
      await tx.classEnrollment.deleteMany({ where: { classGroupId: classId } });
      await tx.studentIdentity.deleteMany({ where: { OR: [{ userId: { in: ids } }, { registerNumber: { startsWith: "995510" } }] } });
      await tx.classGroup.delete({ where: { id: classId } });
      await tx.academicTerm.deleteMany({ where: { name: key } });
      await tx.subject.deleteMany({ where: { code: key } });
      await tx.auditLog.deleteMany({ where: { actorId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    });
    await db.$disconnect();
  });

  it("registers an active Student with a secure hash, no ownership timestamp, token or mail, and persistent login", async () => {
    const { address, user } = await register();
    expect(user.active).toBe(true); expect(user.roles).toEqual(["STUDENT"]); expect(user.emailVerifiedAt).toBeNull();
    expect(await argon2.verify(user.passwordHash, password)).toBe(true);
    expect(user.passwordHash).toContain("$argon2id$"); expect(sent).not.toHaveBeenCalled();
    expect(await db.emailVerification.count({ where: { userId: user.id } })).toBe(0);
    const login = await post("/auth/login", { email: ` ${address.toUpperCase()} `, password });
    expect(login.status).toBe(200); expect(login.headers["set-cookie"][0]).toContain("Secure");
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).body.user.id).toBe(user.id);
    const logout = await request(app).post("/api/auth/logout").set("Origin", origin).set("Cookie", cookie);
    expect(logout.status).toBe(204); expect(logout.headers["set-cookie"][0]).toContain("campusone_token=;");
    await post("/auth/verification/resend", { email: address }); expect(sent).not.toHaveBeenCalled();
    expect((await get("/auth/policy")).body.institutionalAuthMode).toBe(mode);
  });
  it("creates clubs only through Admin access, audits once, and preserves exact-name retries", async () => {
    const name = key + "-admin-created";
    const path = "/admin/clubs";
    expect((await post(path, { name }, "")).status).toBe(401);
    for (const who of ["student", "staff", "head"])
      expect((await post(path, { name }, who)).status).toBe(403);
    for (const body of [{ name: "  " }, { name: "a".repeat(101) }, { name, userId: users.head.id }])
      expect((await post(path, body, "admin")).status).toBe(400);
    try {
      const results = await Promise.all([
        post(path, { name: " " + name + " " }, "admin"),
        post(path, { name }, "admin"),
      ]);
      expect(results.map(r => r.status)).toEqual([201, 201]);
      expect(results[0].body).toEqual(results[1].body);
      const created = results[0].body;
      expect(created.name).toBe(name);
      expect(await db.clubAssignment.count({ where: { clubId: created.id } })).toBe(0);
      const audit = await db.auditLog.findMany({ where: { entityId: created.id, action: "CLUB_CREATED" } });
      expect(audit).toHaveLength(1);
      expect(audit[0].actorId).toBe(users.admin.id);
      expect(audit[0].changes).toEqual({ name });
      expect((await get("/admin/role-requests", "admin")).body.clubs).toContainEqual(created);
      expect((await get("/admin/club-access", "admin")).body.clubs).toContainEqual(created);
    } finally {
      await db.club.deleteMany({ where: { name } });
    }
  });
  it("rejects exact-domain lookalikes and all public Admin or Supervisor privilege injection", async () => {
    for (const address of ["u@fake-ssn.edu.in", "u@sub.ssn.edu.in", "u@ssn.edu.in.evil.test", "u@ssn.edu.іn"]) expect((await post("/auth/register", input(address))).status).toBe(400);
    for (const type of ["ADMIN", "SUPERVISOR"]) expect((await post("/auth/register", input(email(), type))).status).toBe(400);
    for (const extra of [{ roles: ["ADMIN"] }, { active: true }, { emailVerifiedAt: new Date() }]) expect((await post("/auth/register", { ...input(email()), ...extra })).status).toBe(400);
    expect((await post("/auth/role-requests", { role: "ADMIN" })).status).toBe(400);
  });
  it("normalizes concurrent duplicate accounts without changing password, roles or generic response", async () => {
    const address = email();
    const results = await Promise.all([post("/auth/register", input(address)), post("/auth/register", input(` ${address.toUpperCase()} `))]);
    expect(results.map(r => r.status)).toEqual([202, 202]); expect(results[0].body).toEqual(results[1].body);
    const before = await db.user.findUniqueOrThrow({ where: { email: address } });
    expect((await post("/auth/register", { ...input(address, "STAFF"), password: "DifferentTest!2026", confirmPassword: "DifferentTest!2026" })).body).toEqual(results[0].body);
    expect(await db.user.findUniqueOrThrow({ where: { email: address } })).toEqual(before);
    expect(await db.user.count({ where: { email: address } })).toBe(1);
  });
  it.each(["STAFF", "CLUB_HEAD"])("requires an Admin identity confirmation before approving unverified %s", async type => {
    const { user, address } = await register(type);
    expect(user.roles).toEqual([]); expect((await post("/auth/login", { email: address, password })).status).toBe(401);
    const roleRequest = await db.roleRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect((await get("/admin/role-requests", "admin")).body.requests.some((r: { id: string }) => r.id === roleRequest.id)).toBe(true);
    const path = `/admin/role-requests/${roleRequest.id}/decision`, decision = { decision: "APPROVED", ...(type === "CLUB_HEAD" ? { clubId } : { offeringIds: [offeringId] }) };
    expect((await post(path, decision, "student")).status).toBe(403);
    expect((await post(path, decision, "admin")).status).toBe(400);
    expect((await db.roleRequest.findUniqueOrThrow({ where: { id: roleRequest.id } })).status).toBe("PENDING");
    expect((await post(path, { ...decision, identityConfirmed: true }, "admin")).status).toBe(204);
    expect((await post("/auth/login", { email: address, password })).body.user.roles).toEqual([type]);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
    expect(await db.complaintSupervisorAssignment.count({ where: { userId: user.id } })).toBe(0);
  });
  it("adds Club Head to a Student without dropping Student access and rolls back invalid assignments", async () => {
    const { user } = await register(); const cookie = "campusone_token=" + await issueToken(user.id, secret);
    expect((await request(app).post("/api/auth/role-requests").set("Origin", origin).set("Cookie", cookie).send({ role: "CLUB_HEAD" })).status).toBe(201);
    const r = await db.roleRequest.findFirstOrThrow({ where: { userId: user.id } });
    const route = `/admin/role-requests/${r.id}/decision`;
    expect((await post(route, { decision: "APPROVED", clubId: "missing", identityConfirmed: true }, "admin")).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).roles).toEqual(["STUDENT"]);
    expect((await post(route, { decision: "APPROVED", clubId, identityConfirmed: true }, "admin")).status).toBe(204);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).body.user.roles).toEqual(["STUDENT", "CLUB_HEAD"]);
  });
  it.each(["STAFF", "CLUB_HEAD"])("audits explicit synthetic %s approval without asserting institutional identity or email ownership", async type => {
    const { user } = await register(type);
    const r = await db.roleRequest.findFirstOrThrow({ where: { userId: user.id } });
    const path = `/admin/role-requests/${r.id}/decision`;
    const body = { decision: "APPROVED", syntheticIdentityAttested: true,
      identityEvidence: "Operator authorized this controlled synthetic test fixture out of band; no mailbox ownership claim.",
      ...(type === "CLUB_HEAD" ? { clubId } : { offeringIds: [offeringId] }) };
    expect((await post(path, body, "student")).status).toBe(403);
    for (const invalid of [{ ...body, identityEvidence: undefined }, { ...body, identityEvidence: "short" }, { ...body, identityConfirmed: true }]) {
      expect((await post(path, invalid, "admin")).status).toBe(400);
      expect((await db.roleRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).roles).toEqual([]);
    }
    expect((await post(path, body, "admin")).status).toBe(204);
    const approved = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(approved.roles).toEqual([type]);
    expect(approved.emailVerifiedAt).toBeNull();
    expect(approved.isDemo).toBe(false); // Local-only seed accounts remain excluded from production.
    expect(await db.emailVerification.count({ where: { userId: user.id } })).toBe(0);
    expect(sent).not.toHaveBeenCalled();
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "ROLE_REQUEST_APPROVED" } });
    expect(audit.actorId).toBe(users.admin.id);
    expect(audit.changes).toMatchObject({ userId: user.id, role: type, ...body });
    if (type === "STAFF") {
      expect(await db.teachingAssignment.count({ where: { staffId: user.id, offeringId } })).toBe(1);
      expect((await get("/complaints/catalog", "admin")).body.candidates).toContainEqual({ id: approved.id, name: approved.name, email: approved.email, department: approved.department });
    } else expect(await db.clubAssignment.count({ where: { userId: user.id, clubId } })).toBe(1);
  });
  it("refuses synthetic attestation in legacy mode and rejects public attestation injection", async () => {
    expect((await post("/auth/register", { ...input(email(), "STAFF"), syntheticIdentityAttested: true, identityEvidence: "Public self attestation is forbidden" })).status).toBe(400);
    const { user } = await register("STAFF");
    const verifiedAdmin = await db.user.create({ data: { name: "Verified test Admin", email: email(), passwordHash: await hashPassword(password), roles: ["ADMIN"], emailVerifiedAt: new Date(), department: "Test" } });
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    const r = await db.roleRequest.findFirstOrThrow({ where: { userId: user.id } });
    const legacy = registrationService(db, sent, origin, "email-verification", false);
    await expect(legacy.decide(r.id, verifiedAdmin.id, { decision: "APPROVED", offeringIds: [], syntheticIdentityAttested: true, identityEvidence: "Operator-authorized synthetic fixture; not institutional identity" })).rejects.toThrow("only available in domain-only-demo");
    expect((await db.roleRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).roles).toEqual([]);
  });
  it("requires out-of-band Admin confirmation for roster linkage and teaching grants", async () => {
    const roster = { classGroupId: classId, prefix: "995510", suffixWidth: 3, input: "1,2", names: {} };
    const preview = await attendance.rosterPreview(users.admin, roster);
    await attendance.importRoster(users.admin, { ...roster, confirmed: true, rosterVersion: preview.rosterVersion });
    const body = { registerNumber: "995510001", email: users.head.email, reason: "Synthetic out-of-band identity review", confirmed: true };
    expect((await post("/attendance/admin/link", body, "head")).status).toBe(403);
    expect((await post("/attendance/admin/link", body, "admin")).status).toBe(400);
    expect((await post("/attendance/admin/link", { ...body, identityConfirmed: true }, "admin")).status).toBe(204);
    const grant = { staffId: users.replacement.id, offeringId, assigned: true };
    expect((await post("/attendance/admin/assignments", grant, "admin")).status).toBe(400);
    expect((await post("/attendance/admin/assignments", { ...grant, identityConfirmed: true }, "admin")).status).toBe(204);
  });
  it("audits synthetic academic authorization without claiming identity or mailbox ownership", async () => {
    const grant = { staffId: users.replacement.id, offeringId, assigned: true, syntheticIdentityAttested: true };
    expect((await post("/attendance/admin/assignments", grant, "admin")).status).toBe(400);
    const identityEvidence = "Operator-authorized controlled synthetic Staff fixture; no institutional identity claim.";
    expect((await post("/attendance/admin/assignments", { ...grant, identityEvidence, identityConfirmed: true }, "admin")).status).toBe(400);
    expect((await post("/attendance/admin/assignments", { ...grant, identityEvidence }, "student")).status).toBe(403);
    expect((await post("/attendance/admin/assignments", { ...grant, identityEvidence }, "admin")).status).toBe(204);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "TEACHING_ASSIGNMENT", entityId: offeringId, actorId: users.admin.id }, orderBy: { createdAt: "desc" } });
    expect(audit.changes).toMatchObject({ ...grant, identityEvidence });
    const body = { registerNumber: "995510002", email: users.student.email, reason: "Operator authorized this synthetic Student and synthetic register number for QA; no mailbox ownership claim.", confirmed: true, syntheticIdentityAttested: true };
    expect((await post("/attendance/admin/link", { ...body, identityConfirmed: true }, "admin")).status).toBe(400);
    expect((await post("/attendance/admin/link", body, "student")).status).toBe(403);
    expect((await post("/attendance/admin/link", body, "admin")).status).toBe(204);
    const linked = await db.studentIdentity.findUniqueOrThrow({ where: { registerNumber: body.registerNumber } });
    const linkAudit = await db.auditLog.findFirstOrThrow({ where: { action: "STUDENT_IDENTITY_LINK", entityId: linked.id }, orderBy: { createdAt: "desc" } });
    expect(linkAudit.changes).toMatchObject({ syntheticIdentityAttested: true, identityConfirmed: false, reason: body.reason });
    expect((await db.user.findUniqueOrThrow({ where: { id: users.student.id } })).emailVerifiedAt).toBeNull();
    const legacy = attendanceService(db, "email-verification", false);
    await db.user.updateMany({ where: { id: { in: [users.admin.id, users.replacement.id] } }, data: { emailVerifiedAt: new Date() } });
    try {
      await expect(legacy.assign(users.admin, { ...grant, identityEvidence })).rejects.toThrow("only available in domain-only-demo");
      await expect(legacy.link(users.admin, { ...body, confirmed: true })).rejects.toThrow("only available in domain-only-demo");
    } finally {
      await db.user.updateMany({ where: { id: { in: [users.admin.id, users.replacement.id] } }, data: { emailVerifiedAt: null } });
    }
  });
  it("uses Student plus Club Head attendance and event access while keeping other Students private", async () => {
    const selection = { offeringId, date: "2026-10-10", period: 1, mode: "PRESENT" as const, input: "1", overrides: [] };
    const preview = await attendance.preview(users.staff, selection);
    await attendance.save(users.staff, { ...selection, confirmed: true, rosterVersion: preview.rosterVersion });
    const own = await get("/attendance/student", "head"); expect(own.status).toBe(200); expect(JSON.stringify(own.body)).toContain("995510001");
    expect(JSON.stringify((await get("/attendance/student", "other")).body)).not.toContain("995510001");
    expect((await get("/attendance/student?userId=" + users.head.id, "other")).status).toBe(400);
    const draft = await event(), published = await post(`/events/${draft.id}/action`, { version: draft.version, action: "publish" }, "head");
    expect(published.status).toBe(200);
    expect((await post(`/events/${draft.id}/register`, {}, "head")).status).toBe(200);
    expect((await post(`/events/${draft.id}/register`, {}, "head")).status).toBe(200);
    expect(await db.eventRegistration.count({ where: { eventId: draft.id, studentId: users.head.id } })).toBe(1);
    expect((await get(`/events/${draft.id}/registrations`, "other")).status).toBe(403);
  });
  it("keeps synthetic Supervisor and club grants explicit, audited and Admin-only", async () => {
    const reason = "Operator-authorized controlled synthetic fixture; reviewed Admin role attestation. No institutional identity or mailbox ownership claim.";
    for (const group of groups) {
      const grant = { version: 1, userId: users.staff.id, reason, syntheticIdentityAttested: true, identityConfirmed: false };
      expect((await post('/complaints/supervisors/' + group, { ...grant, reason: 'demo' }, 'admin')).status).toBe(400);
      expect((await post('/complaints/supervisors/' + group, { ...grant, identityConfirmed: true }, 'admin')).status).toBe(400);
      expect((await post('/complaints/supervisors/' + group, grant, 'student')).status).toBe(403);
      expect((await post('/complaints/supervisors/' + group, grant, 'admin')).status).toBe(200);
      const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: users.admin.id, entityId: group, action: 'COMPLAINT_SUPERVISOR_CHANGED' }, orderBy: { createdAt: 'desc' } });
      expect(audit.changes).toMatchObject({ syntheticIdentityAttested: true, identityConfirmed: false, reason });
    }
    const club = { userId: users.head.id, clubId, active: true, reason, syntheticIdentityAttested: true, identityConfirmed: false };
    expect((await post('/admin/club-access', { ...club, reason: 'demo' }, 'admin')).status).toBe(400);
    expect((await post('/admin/club-access', { ...club, identityConfirmed: true }, 'admin')).status).toBe(400);
    expect((await post('/admin/club-access', club, 'head')).status).toBe(403);
    expect((await post('/admin/club-access', club, 'admin')).status).toBe(204);
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: users.admin.id, action: 'CLUB_ACCESS_GRANTED' }, orderBy: { createdAt: 'desc' } });
    expect(audit.changes).toMatchObject(club);
    await db.user.updateMany({ where: { id: { in: [users.admin.id, users.head.id] } }, data: { emailVerifiedAt: new Date() } });
    try {
      await expect(registrationService(db, sent, origin, 'email-verification', false).changeClubAccess(users.admin.id, club)).rejects.toThrow('only available in domain-only-demo');
      await expect(complaintsService(db, false, 'email-verification').configure(users.admin, 'UG_I', 2, users.replacement.id, reason, false, true)).rejects.toThrow('only available in domain-only-demo');
    } finally {
      await db.user.updateMany({ where: { id: { in: [users.admin.id, users.head.id] } }, data: { emailVerifiedAt: null } });
    }
  });
  it("combines Staff teaching and assigned Supervisor access without creating club permissions", async () => {
    expect((await get("/attendance/catalog", "staff")).body.offerings.some((o: { id: string }) => o.id === offeringId)).toBe(true);
    const body = { version: 1, userId: users.staff.id, reason: "Synthetic verified identity" };
    expect((await post("/complaints/supervisors/UG_I", body, "admin")).status).toBe(400);
    expect((await post("/complaints/supervisors/UG_I", { ...body, identityConfirmed: true }, "student")).status).toBe(403);
    expect((await post("/complaints/supervisors/UG_I", { ...body, identityConfirmed: true }, "admin")).status).toBe(200);
    expect((await get("/complaints/catalog", "staff")).body.supervisorGroups).toEqual(["UG_I"]);
    expect((await post("/events", { clubId, name: "Unauthorized" }, "staff")).status).toBe(403);
    expect((await complaint("staff")).id).toBeTruthy();
    expect((await get("/attendance/catalog", "staff")).status).toBe(200);
  });
  it("enforces all five Supervisor groups and current-only internal note and image access through resolution", async () => {
    for (const group of groups) expect((await post("/complaints/supervisors/" + group, { version: 1, userId: users.staff.id, reason: "Synthetic identity review", identityConfirmed: true }, "admin")).status).toBe(200);
    const c = await complaint(), bytes = await png();
    const uploaded = await upload(`/complaints/${c.id}/image?version=${c.version}`, bytes, "student"); expect(uploaded.status).toBe(200);
    let result = await post(`/complaints/${c.id}/accept`, { version: uploaded.body.version, studentGroup: "UG_I", confirmRouting: true }, "admin"); expect(result.status).toBe(200);
    result = await post(`/complaints/${c.id}/notes`, { version: result.body.version, text: "Internal synthetic coordination", wardenContact: "Synthetic Warden" }, "staff"); expect(result.status).toBe(200);
    expect((await get(`/complaints/${c.id}`, "staff")).body.internalNotes).toHaveLength(1);
    expect((await get(`/complaints/${c.id}`, "student")).body.internalNotes).toBeUndefined();
    expect((await get(`/complaints/${c.id}`, "other")).status).toBe(403);
    expect((await get(`/complaints/${c.id}/image`, "staff")).status).toBe(200);
    expect((await post("/complaints/supervisors/UG_I", { version: 2, userId: users.replacement.id, reason: "Replace after identity review", identityConfirmed: true }, "admin")).status).toBe(200);
    expect((await get(`/complaints/${c.id}`, "staff")).status).toBe(403); expect((await get(`/complaints/${c.id}/image`, "staff")).status).toBe(403);
    expect((await get(`/complaints/${c.id}`, "replacement")).body.internalNotes).toHaveLength(1);
    const current = await get(`/complaints/${c.id}`, "replacement");
    const resolved = await post(`/complaints/${c.id}/resolve`, { version: current.body.version, resolutionDetails: "Synthetic repair completed" }, "replacement"); expect(resolved.status).toBe(200);
    expect((await post(`/complaints/${c.id}/feedback`, { version: resolved.body.version, feedback: "Synthetic feedback" }, "student")).status).toBe(200);
  });
  it("immediately removes module privileges from existing cookies after role revocation", async () => {
    const draft = await event();
    await db.user.update({ where: { id: users.head.id }, data: { roles: ["STUDENT"] } });
    expect((await get("/auth/me", "head")).body.user.roles).toEqual(["STUDENT"]);
    expect((await post(`/events/${draft.id}/edit`, { version: draft.version, name: "Revoked" }, "head")).status).toBe(403);
    expect((await get("/attendance/student", "head")).status).toBe(200);
    await db.user.update({ where: { id: users.head.id }, data: { roles: ["STUDENT", "CLUB_HEAD"] } });
    await post("/complaints/supervisors/UG_I", { version: 1, userId: users.staff.id, reason: "Synthetic designation", identityConfirmed: true }, "admin");
    await db.user.update({ where: { id: users.staff.id }, data: { roles: ["STUDENT"] } });
    expect((await get("/attendance/catalog", "staff")).status).toBe(403);
    expect((await get("/complaints?scope=supervisor", "staff")).status).toBe(403);
    await db.user.update({ where: { id: users.staff.id }, data: { roles: ["STAFF"] } });
  });
  it("atomically contends for the shared Event and Complaint image quota and preserves versions on failure", async () => {
    const e = await event(), c = await complaint(), bytes = await png(), clean = await validateImage(bytes, "image/png");
    const before = await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } });
    await db.imageBudget.update({ where: { id: 1 }, data: { usedBytes: MAX_STORED_BYTES - clean.bytes.length } });
    try {
      const results = await Promise.all([upload(`/events/${e.id}/poster?version=${e.version}`, bytes, "head"), upload(`/complaints/${c.id}/image?version=${c.version}`, bytes, "student")]);
      expect(results.map(r => r.status).sort()).toEqual([200, 409]);
      expect((await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })).usedBytes).toBe(MAX_STORED_BYTES);
      const failedVersion = results[0].status === 409 ? (await db.event.findUniqueOrThrow({ where: { id: e.id } })).version : (await db.complaint.findUniqueOrThrow({ where: { id: c.id } })).version;
      expect(failedVersion).toBe(1);
    } finally {
      const added = (await db.image.aggregate({ where: { OR: [{ eventId: e.id }, { complaintId: c.id }] }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0;
      await db.imageBudget.update({ where: { id: 1 }, data: { usedBytes: before.usedBytes + added } });
    }
  });
  it("excludes synthetic and lookalike accounts in production and preserves generic login errors", async () => {
    for (const [suffix, address] of [["demo", `${key}-demo@ssn.edu.in`], ["fake", `${key}-fake@fake-ssn.edu.in`]]) {
      const u = await db.user.create({ data: { name: suffix, email: address, passwordHash: await hashPassword(password), department: "", roles: ["STUDENT"], emailVerifiedAt: new Date(), isDemo: suffix === "demo" } });
      expect((await post("/auth/login", { email: address, password })).status).toBe(401);
      expect((await request(app).get("/api/auth/me").set("Cookie", "campusone_token=" + await issueToken(u.id, secret))).status).toBe(401);
    }
    const wrong = await post("/auth/login", { email: users.student.email, password: "wrong" }), missing = await post("/auth/login", { email: email(), password: "wrong" });
    expect(wrong.body).toEqual(missing.body);
    const synthetic = await db.user.findUniqueOrThrow({ where: { email: `${key}-demo@ssn.edu.in` } });
    await db.user.update({ where: { id: synthetic.id }, data: { roles: ["STAFF", "CLUB_HEAD"] } });
    expect((await get("/admin/club-access", "admin")).body.heads.some((u: { id: string }) => u.id === synthetic.id)).toBe(false);
    expect((await get("/attendance/admin/staff", "admin")).body.staff.some((u: { id: string }) => u.id === synthetic.id)).toBe(false);
    expect((await post("/attendance/admin/assignments", { staffId: synthetic.id, offeringId, assigned: true, identityConfirmed: true }, "admin")).status).toBe(400);
    expect((await post("/admin/club-access", { userId: synthetic.id, clubId, active: true, reason: "Synthetic attempt", identityConfirmed: true }, "admin")).status).toBe(400);
  });
  it("keeps production seeding disabled and trusted bootstrap independent of mailbox ownership", async () => {
    const env = { ...process.env, DATABASE_URL: url, NODE_ENV: "production", INSTITUTIONAL_AUTH_MODE: mode, ADMIN_EMAIL: `${key}-bootstrap@ssn.edu.in`, ADMIN_NAME: "Synthetic Bootstrap", ADMIN_PASSWORD: password };
    expect(() => execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], { env, stdio: "pipe" })).toThrow();
    execFileSync(process.execPath, ["--import", "tsx", "prisma/bootstrap-admin.ts"], { env, stdio: "pipe" });
    const u = await db.user.findUniqueOrThrow({ where: { email: env.ADMIN_EMAIL } });
    expect(u.roles).toEqual(["ADMIN"]); expect(u.emailVerifiedAt).toBeNull();
    expect(() => execFileSync(process.execPath, ["--import", "tsx", "prisma/bootstrap-admin.ts"], { env, stdio: "pipe" })).toThrow();
    expect(await db.user.findUniqueOrThrow({ where: { id: u.id } })).toEqual(u);
  }, 15000);
});
