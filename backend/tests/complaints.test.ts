import { randomUUID } from "node:crypto";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import { authRepository, type PublicUser } from "../src/modules/auth/repository.js";
import { issueToken } from "../src/modules/auth/tokens.js";
import { complaintsService } from "../src/modules/complaints/service.js";
import { eventsService } from "../src/modules/events/service.js";
import { acceptSchema, assignmentSchema, groups, rejectSchema, resolveSchema, submissionSchema } from "../src/modules/complaints/validation.js";
import { MAX_IMAGE_BYTES, MAX_STORED_BYTES, validateImage } from "../src/services/image-storage.js";

const input = { title: "Water supply issue", description: "Please review the water supply.", category: "HOSTEL", location: "User-supplied block", studentGroup: "UG_I" };
const png = () => sharp({ create: { width: 80, height: 120, channels: 3, background: "#386342" } }).png().toBuffer();
describe("Complaint input boundaries", () => {
  it("requires title and description", () => {
    for (const bad of [{}, { title: "  ", description: "Text" }, { title: "Title", description: " " }]) expect(submissionSchema.safeParse(bad).success).toBe(false);
  });
  it("bounds text and controlled fields", () => {
    for (const extra of [{ title: "t".repeat(161) }, { description: "d".repeat(6001) }, { location: "x".repeat(201) }, { studentGroup: "UG_V" }, { category: "invented" }]) expect(submissionSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it.each(["submitterId", "status", "roles", "supervisorId", "verifiedById"])("refuses client %s", field => {
    expect(submissionSchema.safeParse({ ...input, [field]: "spoof" }).success).toBe(false);
  });
  it("requires explicit routing confirmation and nonempty outcome/reassignment reasons", () => {
    expect(acceptSchema.safeParse({ version: 1, studentGroup: "UG_I" }).success).toBe(false);
    expect(rejectSchema.safeParse({ version: 1, reason: "  " }).success).toBe(false);
    expect(resolveSchema.safeParse({ version: 1, resolutionDetails: "  " }).success).toBe(false);
    expect(assignmentSchema.safeParse({ version: 1, userId: "user", reason: "  " }).success).toBe(false);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgreSQL complaint lifecycle, Supervisor authorization and privacy", () => {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://unused:unused@localhost/unused";
  const db = createDatabase(url), service = complaintsService(db), events = eventsService(db);
  const key = "complaints-" + randomUUID(), origin = "http://127.0.0.1:5173", secret = "complaints-tests-only-secret-at-least-32-characters";
  const users: Record<string, PublicUser> = {}, cookies: Record<string, string> = {};
  let app: Awaited<ReturnType<typeof createApp>>, clubId: string;
  const get = (path: string, who = "student") => request(app).get("/api/complaints" + path).set("Cookie", cookies[who] ?? "");
  const post = (path: string, body: unknown, who = "admin") => request(app).post("/api/complaints" + path).set("Origin", origin).set("Cookie", cookies[who] ?? "").send(body);
  const upload = (id: string, version: number, bytes: Buffer, who = "student", mime = "image/png", filename = "attachment.png") => request(app).post(`/api/complaints/${id}/image?version=${version}`).set("Origin", origin).set("Cookie", cookies[who] ?? "").set("Content-Type", mime).set("X-Image-Filename", filename).send(bytes);
  async function submitted(extra: object = {}, who = "student") {
    const r = await post("", { ...input, ...(who === "staff" ? { studentGroup: null } : {}), ...extra }, who);
    expect(r.status, JSON.stringify(r.body)).toBe(201); return r.body;
  }
  async function designate(group = "UG_I", who: string | null = "supervisor", version = 1) {
    const r = await post("/supervisors/" + group, { version, userId: who ? users[who].id : null, reason: "Trusted Admin designation" });
    expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body;
  }
  async function accept(c: { id: string; version: number }, group = "UG_I") {
    const r = await post("/" + c.id + "/accept", { version: c.version, studentGroup: group, confirmRouting: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body;
  }
  async function assigned() { await designate(); return accept(await submitted()); }
  async function resolved() {
    const c = await assigned(), r = await post("/" + c.id + "/resolve", { version: c.version, resolutionDetails: "Water supply restored." }, "supervisor");
    expect(r.status).toBe(200); return r.body;
  }
  async function clean() {
    const ids = Object.values(users).map(u => u.id);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(731003)::text`;
      const where = { OR: [{ complaint: { submitterId: { in: ids } } }, { event: { clubId } }] };
      const sum = await tx.image.aggregate({ where, _sum: { sizeBytes: true } });
      await tx.image.deleteMany({ where });
      await tx.imageBudget.updateMany({ where: { id: 1 }, data: { usedBytes: { decrement: sum._sum.sizeBytes ?? 0 } } });
      await tx.complaintNote.deleteMany({ where: { authorId: { in: ids } } });
      await tx.complaint.deleteMany({ where: { submitterId: { in: ids } } });
      await tx.event.deleteMany({ where: { clubId } });
      await tx.auditLog.deleteMany({ where: { actorId: { in: ids } } });
      await tx.complaintSupervisorAssignment.updateMany({ data: { userId: null, assignedById: null, version: 1 } });
    });
  }
  beforeAll(async () => {
    if (!/test/i.test(new URL(url).pathname)) throw new Error("Complaints tests require an isolated named test database.");
    for (const [name, roles] of Object.entries({ student: ["STUDENT"], other: ["STUDENT"], staff: ["STAFF"], supervisor: ["STAFF"], replacement: ["STAFF"], admin: ["ADMIN"], head: ["CLUB_HEAD"] })) {
      users[name] = await db.user.create({ data: { name, email: key + "-" + name + "@ssn.edu.in", passwordHash: "unused", department: "IT", roles: roles as PublicUser["roles"], emailVerifiedAt: new Date() } });
      cookies[name] = "campusone_token=" + await issueToken(users[name].id, secret);
    }
    clubId = (await db.club.create({ data: { name: key } })).id;
    app = await createApp({ config: { nodeEnv: "test", appOrigin: origin, jwtSecret: secret, port: 3000, databaseUrl: url }, auth: authRepository(db), checkDatabase: async () => {}, complaints: service, events });
  });
  beforeEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => {
    vi.restoreAllMocks(); await clean(); await db.club.delete({ where: { id: clubId } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(u => u.id) } } }); await db.$disconnect();
  });
  it("requires authentication, verification and same-origin writes", async () => {
    expect((await get("", "anonymous")).status).toBe(401);
    expect((await request(app).post("/api/complaints").set("Cookie", cookies.student).send(input)).status).toBe(403);
    await db.user.update({ where: { id: users.other.id }, data: { emailVerifiedAt: null } });
    expect((await post("", input, "other")).status).toBe(401);
    await db.user.update({ where: { id: users.other.id }, data: { emailVerifiedAt: new Date() } });
  });
  it("creates a Student complaint from authenticated identity with a submission audit", async () => {
    const c = await submitted();
    expect(c).toMatchObject({ status: "SUBMITTED", studentGroup: "UG_I", routingConfirmed: false, stage: "Awaiting Admin Verification" });
    expect((await db.complaint.findUniqueOrThrow({ where: { id: c.id } })).submitterId).toBe(users.student.id);
    expect(await db.auditLog.count({ where: { entityId: c.id, action: "COMPLAINT_SUBMITTED" } })).toBe(1);
  });
  it("supports Staff submission and forbids Student classification for Staff", async () => {
    expect(await submitted({}, "staff")).toMatchObject({ routingSource: "MANUAL", studentGroup: null });
    expect((await post("", input, "staff")).status).toBe(400);
  });
  it("refuses identity spoofing and Club Head-only submission", async () => {
    expect((await post("", { ...input, submitterId: users.other.id }, "student")).status).toBe(400);
    expect((await post("", input, "head")).status).toBe(403);
  });
  it("limits own listings and denies cross-user detail and images", async () => {
    const c = await submitted(); await upload(c.id, c.version, await png()); await submitted({}, "other");
    const own = await get(""); expect(own.body.total).toBe(1); expect(own.body.complaints[0].id).toBe(c.id);
    for (const who of ["other", "staff", "head", "supervisor"]) {
      expect((await get("/" + c.id, who)).status).toBe(403);
      expect((await get("/" + c.id + "/image", who)).status).toBe(403);
    }
    expect((await get("?scope=admin", "head")).status).toBe(403);
    expect((await get("?scope=supervisor", "supervisor")).status).toBe(403);
  });
  it("requires Admin for verification regardless of client role labels", async () => {
    await designate(); const c = await submitted();
    for (const who of ["student", "staff", "supervisor", "head"]) {
      expect((await post("/" + c.id + "/accept", { version: 1, studentGroup: "UG_I", confirmRouting: true }, who)).status).toBe(403);
      expect((await post("/" + c.id + "/reject", { version: 1, reason: "Invalid" }, who)).status).toBe(403);
    }
    await expect(service.accept({ ...users.student, roles: ["ADMIN"] }, c.id, 1, "UG_I")).rejects.toMatchObject({ status: 403 });
  });
  it.each(groups)("routes confirmed %s to its designated Supervisor", async group => {
    await designate(group); const c = await accept(await submitted({ studentGroup: group }), group);
    expect(c).toMatchObject({ status: "ACCEPTED", routingConfirmed: true, supervisorGroup: group, supervisorId: users.supervisor.id, stage: "Assigned to Supervisor" });
    expect((await get("?scope=supervisor", "supervisor")).body.complaints[0].id).toBe(c.id);
    expect((await get("/" + c.id, "admin")).status).toBe(200);
  });
  it("requires Admin confirmation for unknown or provisional year and permits correction", async () => {
    const c = await submitted({ studentGroup: null });
    expect((await post("/" + c.id + "/accept", { version: 1, studentGroup: "UG_II" })).status).toBe(400);
    const accepted = await accept(c, "UG_II"); expect(accepted.studentGroup).toBe("UG_II"); expect(accepted.routingConfirmed).toBe(true);
  });
  it("uses manual Admin routing for Staff", async () => {
    await designate("UG_IV"); const c = await accept(await submitted({}, "staff"), "UG_IV");
    expect(c).toMatchObject({ supervisorId: users.supervisor.id, studentGroup: "UG_IV", routingSource: "MANUAL" });
  });
  it("keeps acceptance explicitly unassigned until eligible configuration exists", async () => {
    const c = await accept(await submitted());
    expect(c.supervisorId).toBeNull(); expect(c.stage).toBe("Awaiting Supervisor Assignment");
    expect((await get("/statistics", "admin")).body).toMatchObject({ unassigned: 1, pending: 0 });
    await designate(); expect((await get("/" + c.id, "admin")).body.supervisorId).toBe(users.supervisor.id);
  });
  it("rejects with mandatory reason and terminal feedback availability", async () => {
    const c = await submitted();
    expect((await post("/" + c.id + "/reject", { version: 1, reason: " " })).status).toBe(400);
    const r = await post("/" + c.id + "/reject", { version: 1, reason: "Outside campus scope." }); expect(r.status).toBe(200);
    expect((await get("/" + c.id)).body).toMatchObject({ status: "REJECTED", rejectionReason: "Outside campus scope.", canFeedback: true });
    expect((await post("/" + c.id + "/accept", { version: 2, studentGroup: "UG_I", confirmRouting: true })).status).toBe(409);
  });
  it("serializes competing accept/reject decisions with one atomic outcome", async () => {
    await designate(); const c = await submitted();
    const r = await Promise.all([post("/" + c.id + "/accept", { version: 1, studentGroup: "UG_I", confirmRouting: true }), post("/" + c.id + "/reject", { version: 1, reason: "Not valid" })]);
    expect(r.map(v => v.status).sort()).toEqual([200, 409]);
    const c2 = await db.complaint.findUniqueOrThrow({ where: { id: c.id } });
    expect(await db.auditLog.count({ where: { entityId: c.id, action: { in: ["COMPLAINT_ACCEPTED", "COMPLAINT_REJECTED"] } } })).toBe(1);
    expect(c2.supervisorId).toBe(c2.status === "ACCEPTED" ? users.supervisor.id : null);
  });
  it("rolls back acceptance, assignment and audits on transaction failure", async () => {
    await designate(); const c = await submitted(); const original = db.$transaction.bind(db);
    const spy = vi.spyOn(db, "$transaction").mockImplementationOnce(async (fn: unknown) => original(async tx => { await (fn as (t: typeof tx) => Promise<unknown>)(tx); throw new Error("Injected audit transaction failure"); }));
    const r = await post("/" + c.id + "/accept", { version: 1, studentGroup: "UG_I", confirmRouting: true }); spy.mockRestore();
    expect(r.status).toBe(500); expect(await db.complaint.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "SUBMITTED", version: 1, supervisorId: null });
    expect(await db.auditLog.count({ where: { entityId: c.id } })).toBe(1);
  });
  it("has exactly five unique group slots and only Admin can designate", async () => {
    expect(await db.complaintSupervisorAssignment.count()).toBe(5);
    for (const group of groups) await designate(group);
    expect(await db.complaintSupervisorAssignment.count({ where: { userId: { not: null } } })).toBe(5);
    await expect(db.complaintSupervisorAssignment.create({ data: { studentGroup: "UG_I" } })).rejects.toMatchObject({ code: "P2002" });
    expect((await post("/supervisors/UG_I", { version: 2, userId: users.replacement.id, reason: "Self appointment" }, "supervisor")).status).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: users.supervisor.id } })).roles).toEqual(["STAFF"]);
  });
  it("refuses unapproved, inactive or unverified Supervisor accounts", async () => {
    for (const who of ["student", "head", "admin"]) expect((await post("/supervisors/UG_I", { version: 1, userId: users[who].id, reason: "Invalid designation" })).status).toBe(400);
    await db.user.update({ where: { id: users.replacement.id }, data: { active: false } });
    expect((await post("/supervisors/UG_I", { version: 1, userId: users.replacement.id, reason: "Invalid" })).status).toBe(400);
    await db.user.update({ where: { id: users.replacement.id }, data: { active: true, emailVerifiedAt: null } });
    expect((await post("/supervisors/UG_I", { version: 1, userId: users.replacement.id, reason: "Invalid" })).status).toBe(400);
    await db.user.update({ where: { id: users.replacement.id }, data: { emailVerifiedAt: new Date() } });
  });
  it("protects concurrent Supervisor configuration from lost updates", async () => {
    const body = (who: string) => ({ version: 1, userId: users[who].id, reason: "Concurrent Admin update" });
    const r = await Promise.all([post("/supervisors/UG_I", body("supervisor")), post("/supervisors/UG_I", body("replacement"))]);
    expect(r.map(v => v.status).sort()).toEqual([200, 409]); expect((await db.complaintSupervisorAssignment.findUniqueOrThrow({ where: { studentGroup: "UG_I" } })).version).toBe(2);
  });
  it("excludes synthetic and noninstitutional accounts from production designations", async () => {
    await db.user.update({ where: { id: users.replacement.id }, data: { isDemo: true } });
    expect((await get("/catalog", "admin")).body.candidates.map((u: { id: string }) => u.id)).not.toContain(users.replacement.id);
    expect((await post("/supervisors/UG_I", { version: 1, userId: users.replacement.id, reason: "Production attempt" })).status).toBe(400);
    expect((await complaintsService(db, true).catalog(users.admin)).candidates?.map(u => u.id)).toContain(users.replacement.id);
    await db.user.update({ where: { id: users.replacement.id }, data: { isDemo: false, email: key + "-noninstitutional@example.com" } });
    expect((await post("/supervisors/UG_I", { version: 1, userId: users.replacement.id, reason: "Noninstitutional attempt" })).status).toBe(400);
    await db.user.update({ where: { id: users.replacement.id }, data: { email: users.replacement.email } });
  });
  it("replaces unresolved assignments transactionally and revokes old details/image access", async () => {
    await designate(); let c = await submitted(); c = (await upload(c.id, c.version, await png())).body; c = await accept(c);
    expect((await get("/" + c.id + "/image", "supervisor")).status).toBe(200);
    const r = await designate("UG_I", "replacement", 2); expect(r.transferredCases).toBe(1);
    expect((await get("/" + c.id, "supervisor")).status).toBe(403); expect((await get("/" + c.id + "/image", "supervisor")).status).toBe(403);
    expect((await get("/" + c.id, "replacement")).status).toBe(200); expect((await get("/" + c.id + "/image", "replacement")).status).toBe(200);
    expect(await db.auditLog.count({ where: { entityId: c.id, action: "COMPLAINT_REASSIGNED" } })).toBe(1);
  });
  it("revocation retains cases/history and leaves them unassigned", async () => {
    const c = await assigned(); await designate("UG_I", null, 2);
    expect((await get("/" + c.id, "admin")).body.stage).toBe("Awaiting Supervisor Assignment");
    expect((await get("/" + c.id, "supervisor")).status).toBe(403);
    expect(await db.auditLog.count({ where: { entityId: c.id } })).toBe(4);
  });
  it("rolls back configuration and case transfer when audit transaction fails", async () => {
    const c = await assigned(); const original = db.$transaction.bind(db);
    const spy = vi.spyOn(db, "$transaction").mockImplementationOnce(async (fn: unknown) => original(async tx => { await (fn as (t: typeof tx) => Promise<unknown>)(tx); throw new Error("Injected reassignment failure"); }));
    const r = await post("/supervisors/UG_I", { version: 2, userId: users.replacement.id, reason: "Replacement" }); spy.mockRestore();
    expect(r.status).toBe(500); expect((await db.complaint.findUniqueOrThrow({ where: { id: c.id } })).supervisorId).toBe(users.supervisor.id);
    expect((await db.complaintSupervisorAssignment.findUniqueOrThrow({ where: { studentGroup: "UG_I" } })).userId).toBe(users.supervisor.id);
    expect(await db.auditLog.count({ where: { entityId: c.id, action: "COMPLAINT_REASSIGNED" } })).toBe(0);
  });
  it("exceptional reassignment needs reason and an active target and preserves original routing", async () => {
    const c = await assigned(); await designate("PG", "replacement");
    expect((await post("/" + c.id + "/reassign", { version: c.version, supervisorGroup: "PG", reason: " " })).status).toBe(400);
    expect((await post("/" + c.id + "/reassign", { version: c.version, supervisorGroup: "UG_II", reason: "Help" })).status).toBe(400);
    const r = await post("/" + c.id + "/reassign", { version: c.version, supervisorGroup: "PG", reason: "Exceptional expertise" });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ studentGroup: "UG_I", supervisorGroup: "PG", supervisorId: users.replacement.id });
    expect((await get("/" + c.id, "supervisor")).status).toBe(403);
  });
  it("Supervisor sees only assigned accepted/resolved cases and Staff sees only own", async () => {
    const c = await assigned(); await submitted({}, "other"); await submitted({}, "staff");
    expect((await get("?scope=supervisor", "supervisor")).body.complaints.map((v: { id: string }) => v.id)).toEqual([c.id]);
    expect((await get("", "staff")).body.total).toBe(1);
    expect((await get("?scope=supervisor&supervisorId=" + users.replacement.id, "supervisor")).body.total).toBe(0);
  });
  it("records private coordination and supplied warden contact without submitter leakage", async () => {
    const c = await assigned(), r = await post("/" + c.id + "/notes", { version: c.version, text: "Private coordination detail", wardenContact: "Supplied Warden contact" }, "supervisor");
    expect(r.status).toBe(200); expect(r.body.stage).toBe("Under Coordination");
    const own = await get("/" + c.id); expect(own.body.internalNotes).toBeUndefined(); expect(JSON.stringify(own.body)).not.toMatch(/Private coordination|Supplied Warden|COMPLAINT_PROGRESS/);
    expect((await get("?scope=mine")).text).not.toMatch(/Private coordination|Supplied Warden/);
    expect((await get("/" + c.id, "admin")).body.internalNotes[0].text).toBe("Private coordination detail");
  });
  it("denies unassigned and Admin-only processing", async () => {
    const c = await assigned();
    for (const who of ["student", "admin", "replacement"]) {
      expect((await post("/" + c.id + "/notes", { version: c.version, text: "Note" }, who)).status).toBe(403);
      expect((await post("/" + c.id + "/resolve", { version: c.version, resolutionDetails: "Fixed" }, who)).status).toBe(403);
    }
  });
  it("resolves only after acceptance with required public details and no second approval", async () => {
    const c = await assigned();
    expect((await post("/" + c.id + "/resolve", { version: c.version, resolutionDetails: " " }, "supervisor")).status).toBe(400);
    const r = await post("/" + c.id + "/resolve", { version: c.version, resolutionDetails: "Repair completed." }, "supervisor");
    expect(r.status).toBe(200); expect((await get("/" + c.id)).body).toMatchObject({ status: "RESOLVED", resolutionDetails: "Repair completed.", canFeedback: true });
    expect((await post("/" + c.id + "/resolve", { version: r.body.version, resolutionDetails: "Again" }, "supervisor")).status).toBe(409);
    expect((await post("/" + c.id + "/reassign", { version: r.body.version, supervisorGroup: "UG_I", reason: "Reopen" })).status).toBe(409);
  });
  it("does not resolve Submitted or Rejected complaints", async () => {
    const c = await submitted();
    expect((await post("/" + c.id + "/resolve", { version: 1, resolutionDetails: "Bypass" }, "admin")).status).toBe(409);
    await post("/" + c.id + "/reject", { version: 1, reason: "Invalid" });
    expect((await post("/" + c.id + "/resolve", { version: 2, resolutionDetails: "Bypass" }, "admin")).status).toBe(409);
  });
  it("serializes competing resolution requests", async () => {
    const c = await assigned(), body = { version: c.version, resolutionDetails: "Fixed" };
    const r = await Promise.all([post("/" + c.id + "/resolve", body, "supervisor"), post("/" + c.id + "/resolve", body, "supervisor")]);
    expect(r.map(v => v.status).sort()).toEqual([200, 409]); expect(await db.auditLog.count({ where: { entityId: c.id, action: "COMPLAINT_RESOLVED" } })).toBe(1);
  });
  it("does not grant attendance/event privileges through Supervisor designation", async () => {
    await designate();
    await expect(events.create(users.supervisor, { clubId, name: "Privilege bypass", description: "", venue: "" })).rejects.toMatchObject({ status: 403 });
    expect((await get("?scope=admin", "supervisor")).status).toBe(403);
    expect((await db.teachingAssignment.count({ where: { staffId: users.supervisor.id } }))).toBe(0);
  });
  it("checks live account eligibility and revokes resolved-case access after replacement", async () => {
    const c = await resolved(); await designate("UG_I", "replacement", 2);
    expect((await get("/" + c.id, "supervisor")).status).toBe(403);
    expect((await get("/" + c.id, "replacement")).status).toBe(403);
    expect((await get("/" + c.id, "admin")).status).toBe(200);
  });
  it("withdraws Supervisor access if approved Staff capability is removed", async () => {
    const c = await assigned(); await db.user.update({ where: { id: users.supervisor.id }, data: { roles: ["STUDENT"] } });
    expect((await get("/" + c.id, "supervisor")).status).toBe(403);
    expect((await get("/" + c.id, "admin")).body.stage).toBe("Awaiting Supervisor Assignment");
    await db.user.update({ where: { id: users.supervisor.id }, data: { roles: ["STAFF"] } });
  });
  it("allows only the original submitter feedback after closure", async () => {
    const c = await resolved();
    for (const who of ["other", "admin", "supervisor"]) expect((await post("/" + c.id + "/feedback", { version: c.version, feedback: "Forged" }, who)).status).toBe(403);
    const r = await post("/" + c.id + "/feedback", { version: c.version, feedback: "Thank you." }, "student");
    expect(r.status).toBe(200); expect(r.body.status).toBe("RESOLVED");
    expect((await get("/" + c.id, "admin")).body.feedback).toBe("Thank you.");
    expect((await get("/" + c.id, "supervisor")).body.feedback).toBeUndefined();
    expect((await post("/" + c.id + "/feedback", { version: r.body.version, feedback: "Duplicate" }, "student")).status).toBe(409);
  });
  it("denies feedback while active and serializes feedback duplicates", async () => {
    let c = await submitted(); expect((await post("/" + c.id + "/feedback", { version: 1, feedback: "Early" }, "student")).status).toBe(409);
    c = (await post("/" + c.id + "/reject", { version: 1, reason: "Outside scope" })).body;
    const r = await Promise.all([post("/" + c.id + "/feedback", { version: c.version, feedback: "Response one" }, "student"), post("/" + c.id + "/feedback", { version: c.version, feedback: "Response two" }, "student")]);
    expect(r.map(v => v.status).sort()).toEqual([200, 409]); expect(await db.auditLog.count({ where: { entityId: c.id, action: "COMPLAINT_FEEDBACK" } })).toBe(1);
  });
  it("validates JPEG/PNG, contents, extension and 2 MiB maximum", async () => {
    const c = await submitted();
    expect((await upload(c.id, 1, Buffer.alloc(MAX_IMAGE_BYTES + 1))).status).toBe(413);
    expect((await upload(c.id, 1, Buffer.from("bad"))).status).toBe(400);
    expect((await upload(c.id, 1, await png(), "student", "image/gif", "a.gif")).status).toBe(400);
    expect((await upload(c.id, 1, await png(), "student", "image/png", "a.html")).status).toBe(400);
    const bytes = await sharp(await png()).jpeg().toBuffer();
    expect((await upload(c.id, 1, bytes, "student", "image/jpeg", "a.jpg")).status).toBe(200);
    expect((await get("/" + c.id + "/image")).headers).toMatchObject({ "content-type": "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  });
  it("denies image mutation by others or after verification; listings exclude bytes", async () => {
    let c = await submitted();
    expect((await upload(c.id, 1, await png(), "admin")).status).toBe(403);
    c = (await upload(c.id, 1, await png())).body;
    expect((await get("?scope=admin", "admin")).text).not.toMatch(/bytes|objectKey|base64|passwordHash/);
    expect((await get("/" + c.id + "/image", "admin")).status).toBe(200);
    c = await accept(c); expect((await upload(c.id, c.version, await png())).status).toBe(403);
  });
  it("replaces one image with net quota accounting and rejects stale concurrent uploads", async () => {
    const c = await submitted(), bytes = await png();
    const before = (await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })).usedBytes;
    const r = await Promise.all([upload(c.id, 1, bytes), upload(c.id, 1, bytes)]);
    expect(r.map(v => v.status).sort()).toEqual([200, 409]);
    const image = await db.image.findUniqueOrThrow({ where: { complaintId: c.id } });
    expect((await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })).usedBytes).toBe(before + image.sizeBytes);
    expect((await upload(c.id, 2, bytes)).status).toBe(200);
    expect(await db.image.count({ where: { complaintId: c.id } })).toBe(1);
    expect((await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })).usedBytes).toBe(before + image.sizeBytes);
  });
  it("shares the atomic 50 MiB quota with concurrent Event posters", async () => {
    const c = await submitted(), e = await events.create(users.admin, { clubId, name: "Quota event", description: "", venue: "" }), bytes = await png();
    const cleanImage = await validateImage(bytes, "image/png"), before = (await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })).usedBytes;
    await db.imageBudget.update({ where: { id: 1 }, data: { usedBytes: MAX_STORED_BYTES - cleanImage.bytes.length } });
    try {
      const r = await Promise.allSettled([service.saveImage(users.student, c.id, c.version, bytes, "image/png"), events.savePoster(users.admin, e.id, e.version, bytes, "image/png")]);
      expect(r.filter(v => v.status === "fulfilled")).toHaveLength(1);
      const failed = r.find(v => v.status === "rejected"); expect(failed && failed.status === "rejected" && failed.reason.status).toBe(409);
      expect((await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })).usedBytes).toBe(MAX_STORED_BYTES);
    } finally {
      const images = await db.image.aggregate({ where: { OR: [{ complaintId: c.id }, { eventId: e.id }] }, _sum: { sizeBytes: true } });
      await db.imageBudget.update({ where: { id: 1 }, data: { usedBytes: before + (images._sum.sizeBytes ?? 0) } });
    }
  });
  it("rolls back image bytes, quota, version and audit on failed storage transaction", async () => {
    const c = await submitted(), before = (await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })).usedBytes, original = db.$transaction.bind(db);
    const spy = vi.spyOn(db, "$transaction").mockImplementationOnce(async (fn: unknown) => original(async tx => { await (fn as (t: typeof tx) => Promise<unknown>)(tx); throw new Error("Injected image failure"); }));
    const r = await upload(c.id, 1, await png()); spy.mockRestore(); expect(r.status).toBe(500);
    expect(await db.image.findUnique({ where: { complaintId: c.id } })).toBeNull();
    expect((await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })).usedBytes).toBe(before);
    expect((await db.complaint.findUniqueOrThrow({ where: { id: c.id } })).version).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: c.id } })).toBe(1);
  });
  it("filters persisted data and reports all five real overview counts", async () => {
    await submitted(); await accept(await submitted({ category: "SAFETY", location: "Workshop" }));
    const rejected = await submitted(); await post("/" + rejected.id + "/reject", { version: 1, reason: "Invalid" });
    expect((await get("/statistics", "admin")).body).toEqual({ submitted: 1, unassigned: 1, pending: 0, resolved: 0, rejected: 1 });
    expect((await get("?scope=admin&category=SAFETY&location=work&studentGroup=UG_I&status=ACCEPTED", "admin")).body.total).toBe(1);
    expect((await get("?scope=admin&from=2100-01-01T00:00:00Z", "admin")).body.total).toBe(0);
    expect((await get("?scope=admin&pageSize=1&page=2", "admin")).body.complaints).toHaveLength(1);
    expect((await get("/statistics", "student")).status).toBe(403);
  });
});
