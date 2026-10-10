import { randomUUID } from "node:crypto";
import sharp from "sharp";
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
import {
  authRepository,
  type PublicUser,
} from "../src/modules/auth/repository.js";
import { issueToken } from "../src/modules/auth/tokens.js";
import { eventsService } from "../src/modules/events/service.js";
import { registrationService } from "../src/modules/registration/service.js";
import {
  createSchema,
  eventGroup,
  registrationOpen,
  validateDates,
} from "../src/modules/events/validation.js";
import {
  MAX_IMAGE_BYTES,
  MAX_STORED_BYTES,
  validateImage,
} from "../src/services/image-storage.js";

const now = new Date("2026-10-09T06:00:00Z");
const details = {
  name: "Campus Workshop",
  description: "Build something together",
  venue: "Seminar Hall",
  startsAt: "2026-10-12T10:00:00+05:30",
  endsAt: "2026-10-12T12:00:00+05:30",
  registrationEndsAt: "2026-10-11T20:00:00+05:30",
  registrationLink: null,
};
const png = () =>
  sharp({
    create: { width: 80, height: 120, channels: 3, background: "#386342" },
  })
    .png()
    .toBuffer();
const jpeg = () =>
  sharp({
    create: { width: 160, height: 90, channels: 3, background: "#cfdbb3" },
  })
    .jpeg()
    .toBuffer();
describe("Event validation and time boundaries", () => {
  it("allows incomplete drafts and refuses client privilege fields", () => {
    expect(
      createSchema.safeParse({ name: "Draft", clubId: "club" }).success,
    ).toBe(true);
    for (const extra of [
      { status: "PUBLISHED" },
      { creatorId: "other" },
      { roles: ["ADMIN"] },
      { image: { bytes: "bad" } },
    ])
      expect(
        createSchema.safeParse({ name: "Draft", clubId: "club", ...extra })
          .success,
      ).toBe(false);
  });
  it("requires a title and owning club", () => {
    expect(createSchema.safeParse({ name: " ", clubId: "club" }).success).toBe(
      false,
    );
    expect(createSchema.safeParse({ name: "Draft" }).success).toBe(false);
  });
  it("rejects unsafe external links", () => {
    for (const registrationLink of [
      "javascript:alert(1)",
      "data:text/html,foo",
      "https://user:pass@example.org",
    ])
      expect(
        createSchema.safeParse({
          name: "Draft",
          clubId: "club",
          registrationLink,
        }).success,
      ).toBe(false);
  });
  it("rejects ambiguous dates without a UTC offset", () => {
    expect(
      createSchema.safeParse({
        name: "Draft",
        clubId: "club",
        startsAt: "2026-10-12T10:00",
      }).success,
    ).toBe(false);
  });
  it("enforces chronological ordering", () => {
    expect(() => validateDates({ startsAt: now, endsAt: now })).toThrow(
      "End time",
    );
    expect(() =>
      validateDates({
        startsAt: now,
        registrationEndsAt: new Date(now.getTime() + 1),
      }),
    ).toThrow("deadline");
    expect(() => validateDates({ registrationEndsAt: now })).toThrow(
      "deadline",
    );
  });
  it("closes registration at the exact deadline and start boundaries", () => {
    const e = {
      status: "PUBLISHED",
      startsAt: new Date(now.getTime() + 1000),
      registrationEndsAt: now,
    };
    expect(registrationOpen(e, new Date(now.getTime() - 1))).toBe(true);
    expect(registrationOpen(e, now)).toBe(false);
    expect(
      registrationOpen(
        {
          ...e,
          startsAt: now,
          registrationEndsAt: new Date(now.getTime() + 1),
        },
        now,
      ),
    ).toBe(false);
  });
  it("categorizes UTC instants correctly across an IST date boundary", () => {
    const start = new Date("2026-10-10T00:00:00+05:30");
    const end = new Date("2026-10-10T01:00:00+05:30");
    expect(
      eventGroup(
        { startsAt: start, endsAt: end },
        new Date("2026-10-09T18:29:59Z"),
      ),
    ).toBe("upcoming");
    expect(eventGroup({ startsAt: start, endsAt: end }, start)).toBe("ongoing");
    expect(eventGroup({ startsAt: start, endsAt: end }, end)).toBe("past");
    expect(eventGroup({ startsAt: start, endsAt: null }, start)).toBe("past");
    expect(eventGroup({ startsAt: null, endsAt: null }, now)).toBe(
      "unscheduled",
    );
  });
});
describe("Poster content validation", () => {
  it("accepts and decodes JPEG and PNG", async () => {
    expect(
      (await validateImage(await png(), "image/png", "poster.png")).mimeType,
    ).toBe("image/png");
    expect(
      (await validateImage(await jpeg(), "image/jpeg", "poster.JPG")).mimeType,
    ).toBe("image/jpeg");
  });
  it("rejects missing and invalid bytes", async () => {
    await expect(
      validateImage(Buffer.alloc(0), "image/png"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      validateImage(
        Buffer.from("<html><script>alert(1)</script></html>"),
        "image/png",
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("rejects MIME and filename mismatch", async () => {
    await expect(
      validateImage(await png(), "image/jpeg"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      validateImage(await png(), "image/png", "poster.html"),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("rejects unsupported image formats", async () => {
    const gif = await sharp(await png())
      .gif()
      .toBuffer();
    await expect(validateImage(gif, "image/png")).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      validateImage(await png(), "image/svg+xml"),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("rejects truncated pixel data", async () => {
    const image = await png();
    await expect(
      validateImage(image.subarray(0, image.length - 30), "image/png"),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("rejects uploads above 2 MiB", async () => {
    await expect(
      validateImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/jpeg"),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("removes arbitrary trailing content and preserves dimensions", async () => {
    const image = await png();
    const validated = await validateImage(
      Buffer.concat([image, Buffer.from("<script>payload</script>")]),
      "image/png",
    );
    expect(validated.bytes.includes(Buffer.from("payload"))).toBe(false);
    expect(await sharp(validated.bytes).metadata()).toMatchObject({
      width: 80,
      height: 120,
    });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "PostgreSQL events permissions, registrations and image quota",
  () => {
    const url =
      process.env.TEST_DATABASE_URL ??
      "postgresql://unused:unused@localhost/unused";
    const db = createDatabase(url);
    let time = new Date(now);
    const service = eventsService(db, () => time);
    const access = registrationService(
      db,
      async () => {},
      "http://127.0.0.1:5173",
    );
    const key = "events-" + randomUUID();
    const origin = "http://127.0.0.1:5173",
      secret = "events-tests-only-secret-at-least-32-characters";
    const users: Record<string, PublicUser> = {},
      cookies: Record<string, string> = {};
    let clubId: string, otherClubId: string;
    let app: Awaited<ReturnType<typeof createApp>>;
    const get = (path: string, who = "head") =>
      request(app)
        .get("/api/events" + path)
        .set("Cookie", cookies[who] ?? "");
    const post = (path: string, body: unknown, who = "head") =>
      request(app)
        .post("/api/events" + path)
        .set("Origin", origin)
        .set("Cookie", cookies[who] ?? "")
        .send(body);
    const upload = (
      id: string,
      version: number,
      bytes: Buffer,
      mime = "image/png",
      who = "head",
      filename = "poster.png",
    ) =>
      request(app)
        .post("/api/events/" + id + "/poster?version=" + version)
        .set("Origin", origin)
        .set("Cookie", cookies[who] ?? "")
        .set("Content-Type", mime)
        .set("X-Image-Filename", filename)
        .send(bytes);
    async function draft(extra: object = {}) {
      const r = await post("", { ...details, clubId, ...extra });
      expect(r.status).toBe(201);
      return r.body;
    }
    async function published(extra: object = {}) {
      const e = await draft(extra);
      const r = await post("/" + e.id + "/action", {
        action: "publish",
        version: e.version,
      });
      expect(r.status).toBe(200);
      return r.body;
    }
    beforeAll(async () => {
      if (!/test/i.test(new URL(url).pathname))
        throw new Error("Events tests require a named test database.");
      for (const [name, roles] of Object.entries({
        head: ["CLUB_HEAD"],
        other: ["CLUB_HEAD"],
        student: ["STUDENT"],
        combined: ["STUDENT", "CLUB_HEAD"],
        admin: ["ADMIN"],
        staff: ["STAFF"],
      })) {
        const u = await db.user.create({
          data: {
            name,
            email: key + "-" + name + "@ssn.edu.in",
            passwordHash: "unused",
            roles: roles as PublicUser["roles"],
            department: "IT",
            emailVerifiedAt: new Date(),
          },
        });
        users[name] = u;
        cookies[name] = "campusone_token=" + (await issueToken(u.id, secret));
      }
      clubId = (await db.club.create({ data: { name: key } })).id;
      otherClubId = (await db.club.create({ data: { name: key + "-other" } }))
        .id;
      await db.clubAssignment.createMany({
        data: [
          { clubId, userId: users.head.id },
          { clubId, userId: users.combined.id },
          { clubId: otherClubId, userId: users.other.id },
        ],
      });
      app = await createApp({
        config: {
          nodeEnv: "test",
          appOrigin: origin,
          jwtSecret: secret,
          port: 3000,
          databaseUrl: url,
        },
        auth: authRepository(db),
        checkDatabase: async () => {},
        events: service,
        registration: access,
      });
    });
    beforeEach(() => {
      time = new Date(now);
    });
    afterAll(async () => {
      vi.restoreAllMocks();
      await db.$transaction(async (tx) => {
        const images = await tx.image.aggregate({
          where: { event: { clubId: { in: [clubId, otherClubId] } } },
          _sum: { sizeBytes: true },
        });
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(731003)::text`;
        await tx.image.deleteMany({
          where: { event: { clubId: { in: [clubId, otherClubId] } } },
        });
        await tx.imageBudget.updateMany({
          where: { id: 1 },
          data: { usedBytes: { decrement: images._sum.sizeBytes ?? 0 } },
        });
        await tx.eventRegistration.deleteMany({
          where: { event: { clubId: { in: [clubId, otherClubId] } } },
        });
        await tx.event.deleteMany({
          where: { clubId: { in: [clubId, otherClubId] } },
        });
        await tx.clubAssignment.deleteMany({
          where: { clubId: { in: [clubId, otherClubId] } },
        });
        await tx.club.deleteMany({
          where: { id: { in: [clubId, otherClubId] } },
        });
        await tx.auditLog.deleteMany({
          where: { actorId: { in: Object.values(users).map((u) => u.id) } },
        });
        await tx.user.deleteMany({
          where: { id: { in: Object.values(users).map((u) => u.id) } },
        });
      });
      await db.$disconnect();
    });
    it("requires authentication and same-origin writes", async () => {
      expect((await get("", "anonymous")).status).toBe(401);
      expect(
        (
          await request(app)
            .post("/api/events")
            .set("Cookie", cookies.head)
            .send({})
        ).status,
      ).toBe(403);
    });
    it("creates incomplete drafts and enforces publish requirements", async () => {
      const e = await draft({
        description: "",
        venue: "",
        startsAt: null,
        endsAt: null,
        registrationEndsAt: null,
      });
      expect(e.status).toBe("DRAFT");
      expect(
        (await post("/" + e.id + "/action", { action: "publish", version: 1 }))
          .status,
      ).toBe(400);
    });
    it("rejects non-managers and wrong-club creation", async () => {
      expect((await post("", { ...details, clubId }, "student")).status).toBe(
        403,
      );
      expect((await post("", { ...details, clubId: otherClubId })).status).toBe(
        403,
      );
    });
    it("rejects client-supplied ownership/status/version overrides", async () => {
      for (const privileged of [
        { creatorId: users.admin.id },
        { status: "PUBLISHED" },
        { version: 999 },
      ])
        expect(
          (await post("", { ...details, clubId, ...privileged })).status,
        ).toBe(400);
    });
    it("hides drafts and draft posters from other clubs, students, and staff", async () => {
      const e = await draft();
      await upload(e.id, e.version, await png());
      for (const who of ["other", "student", "staff"]) {
        expect((await get("/" + e.id, who)).status).toBe(404);
        expect((await get("/" + e.id + "/poster", who)).status).toBe(404);
      }
      expect((await get("/" + e.id, "admin")).status).toBe(200);
      expect(
        (await get("?q=Campus&group=all", "student")).body.events.some(
          (v: { id: string }) => v.id === e.id,
        ),
      ).toBe(false);
    });
    it("permits owning club edits and Admin cross-club supervision", async () => {
      const e = await draft();
      expect(
        (
          await post("/" + e.id + "/edit", {
            ...details,
            name: "Edited",
            version: e.version,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await post(
            "/" + e.id + "/edit",
            { ...details, name: "Admin edited", version: e.version + 1 },
            "admin",
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await post(
            "/" + e.id + "/edit",
            { ...details, version: e.version + 2 },
            "other",
          )
        ).status,
      ).toBe(403);
    });
    it("rejects Student editing and changes to the owning club", async () => {
      const e = await draft();
      expect(
        (
          await post(
            "/" + e.id + "/edit",
            { ...details, version: 1 },
            "student",
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await post("/" + e.id + "/edit", {
            ...details,
            version: 1,
            clubId: otherClubId,
          })
        ).status,
      ).toBe(400);
    });
    it("revocation immediately blocks edits and uploads and is audited", async () => {
      const e = await draft();
      await access.changeClubAccess(users.admin.id, {
        userId: users.head.id,
        clubId,
        active: false,
        reason: "Test revocation",
      });
      try {
        expect(
          (await post("/" + e.id + "/edit", { ...details, version: 1 })).status,
        ).toBe(403);
        expect((await upload(e.id, 1, await png())).status).toBe(403);
        expect((await get("/catalog")).body.authorizedClubs).toEqual([]);
        expect(
          await db.auditLog.count({
            where: {
              actorId: users.admin.id,
              action: "CLUB_ACCESS_REVOKED",
              entityId: clubId,
            },
          }),
        ).toBeGreaterThan(0);
      } finally {
        await access.changeClubAccess(users.admin.id, {
          userId: users.head.id,
          clubId,
          active: true,
          reason: "Restore test assignment",
        });
      }
    });
    it("rejects stale and competing edits", async () => {
      const e = await draft();
      const results = await Promise.all([
        post("/" + e.id + "/edit", { ...details, name: "First", version: 1 }),
        post("/" + e.id + "/edit", { ...details, name: "Second", version: 1 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        (await db.event.findUniqueOrThrow({ where: { id: e.id } })).version,
      ).toBe(2);
    });
    it("rejects invalid chronology before writing", async () => {
      const before = await db.event.count({ where: { clubId } });
      expect(
        (await post("", { ...details, clubId, endsAt: details.startsAt }))
          .status,
      ).toBe(400);
      expect(
        (
          await post("", {
            ...details,
            clubId,
            registrationEndsAt: "2026-10-15T00:00:00Z",
          })
        ).status,
      ).toBe(400);
      expect(await db.event.count({ where: { clubId } })).toBe(before);
    });
    it("registers approved Students idempotently", async () => {
      const e = await published();
      const first = await post("/" + e.id + "/register", {}, "student");
      const second = await post("/" + e.id + "/register", {}, "student");
      expect(first.body.alreadyRegistered).toBe(false);
      expect(second.body.alreadyRegistered).toBe(true);
      expect(first.body.registration.id).toBe(second.body.registration.id);
      expect((await get("/" + e.id, "student")).body).toMatchObject({
        registered: true,
        registrationCount: 1,
      });
    });
    it("serializes concurrent duplicate registrations", async () => {
      const e = await published();
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          post("/" + e.id + "/register", {}, "student"),
        ),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => !r.body.alreadyRegistered)).toHaveLength(1);
      expect(
        await db.eventRegistration.count({ where: { eventId: e.id } }),
      ).toBe(1);
    });
    it("retains Student privileges for Student + Club Head accounts", async () => {
      const e = await published();
      expect(
        (await post("/" + e.id + "/register", {}, "combined")).status,
      ).toBe(200);
      expect((await post("/" + e.id + "/register", {}, "head")).status).toBe(
        403,
      );
    });
    it("refuses registration identities and private history queries", async () => {
      const e = await published();
      expect(
        (
          await post(
            "/" + e.id + "/register",
            { studentId: users.other.id },
            "student",
          )
        ).status,
      ).toBe(400);
      expect(
        (await get("?scope=mine&studentId=" + users.other.id, "student"))
          .status,
      ).toBe(400);
      expect((await get("/" + e.id + "/registrations", "student")).status).toBe(
        403,
      );
    });
    it("enforces deadline at the exact millisecond", async () => {
      const e = await published();
      time = new Date(e.registrationEndsAt);
      expect((await post("/" + e.id + "/register", {}, "student")).status).toBe(
        409,
      );
      time = new Date(time.getTime() - 1);
      expect((await post("/" + e.id + "/register", {}, "student")).status).toBe(
        200,
      );
    });
    it("refuses draft, cancelled, ongoing and past registrations", async () => {
      const d = await draft();
      expect((await post("/" + d.id + "/register", {}, "student")).status).toBe(
        409,
      );
      const e = await published();
      time = new Date(e.startsAt);
      expect((await post("/" + e.id + "/register", {}, "student")).status).toBe(
        409,
      );
      time = new Date(e.endsAt);
      expect((await post("/" + e.id + "/register", {}, "student")).status).toBe(
        409,
      );
      time = new Date(now);
      await post("/" + e.id + "/action", {
        action: "cancel",
        version: e.version,
      });
      expect((await post("/" + e.id + "/register", {}, "student")).status).toBe(
        409,
      );
    });
    it("preserves registrations and history after cancellation", async () => {
      const e = await published();
      await post("/" + e.id + "/register", {}, "student");
      expect(
        (
          await post(
            "/" + e.id + "/action",
            { action: "cancel", version: e.version },
            "admin",
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await get("?scope=mine&group=all&clubId=" + clubId, "student")
        ).body.events.find((v: { id: string }) => v.id === e.id),
      ).toMatchObject({
        status: "CANCELLED",
        registered: true,
        registrationCount: 1,
      });
      expect((await get("/" + e.id + "/registrations")).body.total).toBe(1);
    });
    it("prevents invalid edits against existing registration timestamps", async () => {
      const e = await published();
      await post("/" + e.id + "/register", {}, "student");
      expect(
        (
          await post("/" + e.id + "/edit", {
            ...details,
            registrationEndsAt: now.toISOString(),
            version: e.version,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await post("/" + e.id + "/edit", {
            ...details,
            startsAt: now.toISOString(),
            endsAt: null,
            registrationEndsAt: new Date(now.getTime() - 1).toISOString(),
            version: e.version,
          })
        ).status,
      ).toBe(409);
      expect(
        await db.eventRegistration.count({ where: { eventId: e.id } }),
      ).toBe(1);
    });
    it("restricts unpublishing to Admin and refuses events with registrations", async () => {
      const e = await published();
      expect(
        (
          await post("/" + e.id + "/action", {
            action: "unpublish",
            version: e.version,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post(
            "/" + e.id + "/action",
            { action: "unpublish", version: e.version },
            "admin",
          )
        ).body.status,
      ).toBe("DRAFT");
      const registered = await published();
      await post("/" + registered.id + "/register", {}, "student");
      expect(
        (
          await post(
            "/" + registered.id + "/action",
            { action: "unpublish", version: registered.version },
            "admin",
          )
        ).status,
      ).toBe(409);
    });
    it("makes cancellation terminal", async () => {
      const e = await draft();
      const cancelled = await post("/" + e.id + "/action", {
        action: "cancel",
        version: e.version,
      });
      expect(
        (
          await post("/" + e.id + "/action", {
            action: "publish",
            version: cancelled.body.version,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await post("/" + e.id + "/edit", {
            ...details,
            version: cancelled.body.version,
          })
        ).status,
      ).toBe(409);
    });
    it("filters by club and searches description with server pagination", async () => {
      await published({
        name: "Search Target " + key,
        description: "UniqueSearchToken",
      });
      const r = await get(
        "?group=all&q=uniquesearchtoken&clubId=" + clubId + "&pageSize=1",
        "student",
      );
      expect(r.body.total).toBe(1);
      expect(r.body.events).toHaveLength(1);
      expect(
        (
          await get(
            "?group=all&q=uniquesearchtoken&clubId=" + otherClubId,
            "student",
          )
        ).body.total,
      ).toBe(0);
      expect((await get("?pageSize=1000", "student")).status).toBe(400);
    });
    it("returns private own registrations and manager-scoped counts", async () => {
      const e = await published();
      await post("/" + e.id + "/register", {}, "student");
      const own = await get("?scope=mine&group=all", "combined");
      expect(own.body.events.some((v: { id: string }) => v.id === e.id)).toBe(
        false,
      );
      expect(
        (await get("?scope=manage&group=all", "other")).body.events.every(
          (v: { clubId: string }) => v.clubId === otherClubId,
        ),
      ).toBe(true);
      const s = await get("/statistics");
      expect(
        s.body.clubs.every((c: { clubId: string }) => c.clubId === clubId),
      ).toBe(true);
      expect(s.body.totalRegistrations).toBe(
        await db.eventRegistration.count({ where: { event: { clubId } } }),
      );
      expect((await get("/statistics", "student")).status).toBe(403);
    });
    it("uploads, replaces and removes posters with correct quota and headers", async () => {
      const before =
        (await db.imageBudget.findUnique({ where: { id: 1 } }))?.usedBytes ?? 0;
      const e = await draft();
      const p = await upload(e.id, 1, await png());
      expect(p.status).toBe(200);
      const size = (
        await db.image.findUniqueOrThrow({ where: { eventId: e.id } })
      ).sizeBytes;
      expect(
        (await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } }))
          .usedBytes,
      ).toBe(before + size);
      const replacement = await upload(
        e.id,
        p.body.version,
        await jpeg(),
        "image/jpeg",
        "head",
        "poster.jpg",
      );
      expect(replacement.status).toBe(200);
      const newSize = (
        await db.image.findUniqueOrThrow({ where: { eventId: e.id } })
      ).sizeBytes;
      expect(
        (await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } }))
          .usedBytes,
      ).toBe(before + newSize);
      const response = await get("/" + e.id + "/poster");
      expect(response.headers).toMatchObject({
        "content-type": "image/jpeg",
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      });
      expect(await sharp(response.body).metadata()).toMatchObject({
        width: 160,
        height: 90,
      });
      expect(
        (
          await post("/" + e.id + "/poster/remove", {
            version: replacement.body.version,
          })
        ).status,
      ).toBe(200);
      expect(
        (await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } }))
          .usedBytes,
      ).toBe(before);
      expect(
        await db.image.findUnique({ where: { eventId: e.id } }),
      ).toBeNull();
    });
    it("limits upload bodies and rejects bad bytes and mismatched extensions", async () => {
      const e = await draft();
      expect(
        (await upload(e.id, 1, Buffer.alloc(MAX_IMAGE_BYTES + 1))).status,
      ).toBe(413);
      expect((await upload(e.id, 1, Buffer.from("bad"))).status).toBe(400);
      expect(
        (await upload(e.id, 1, await png(), "image/png", "head", "bad.html"))
          .status,
      ).toBe(400);
      expect(
        await db.image.findUnique({ where: { eventId: e.id } }),
      ).toBeNull();
    });
    it("refuses competing stale poster replacements without leaking quota", async () => {
      const e = await draft();
      const bytes = await png();
      const before = (
        await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })
      ).usedBytes;
      const results = await Promise.all([
        upload(e.id, 1, bytes),
        upload(e.id, 1, bytes),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const img = await db.image.findUniqueOrThrow({
        where: { eventId: e.id },
      });
      expect(
        (await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } }))
          .usedBytes,
      ).toBe(before + img.sizeBytes);
    });
    it("atomically enforces the shared budget across concurrent event uploads", async () => {
      const first = await draft(),
        second = await draft();
      const bytes = await png();
      const clean = await validateImage(bytes, "image/png");
      const before = (
        await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })
      ).usedBytes;
      // A quota reservation fixture simulates an almost full campus budget, without allocating 50 MiB.
      await db.imageBudget.update({
        where: { id: 1 },
        data: { usedBytes: MAX_STORED_BYTES - clean.bytes.length },
      });
      try {
        const results = await Promise.all([
          upload(first.id, 1, bytes),
          upload(second.id, 1, bytes),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(
          (await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } }))
            .usedBytes,
        ).toBe(MAX_STORED_BYTES);
        expect(
          await db.image.count({
            where: { eventId: { in: [first.id, second.id] } },
          }),
        ).toBe(1);
      } finally {
        const added = await db.image.aggregate({
          where: { eventId: { in: [first.id, second.id] } },
          _sum: { sizeBytes: true },
        });
        await db.imageBudget.update({
          where: { id: 1 },
          data: { usedBytes: before + (added._sum.sizeBytes ?? 0) },
        });
      }
    });
    it("rolls back bytes, quota, event version and audit on failed transactions", async () => {
      const e = await draft();
      const before = (
        await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })
      ).usedBytes;
      const spy = vi
        .spyOn(db, "$transaction")
        .mockImplementationOnce(async (fn: unknown) => {
          return db.$transaction(async (tx) => {
            await (fn as (tx: typeof tx) => Promise<unknown>)(tx);
            throw new Error("Injected transaction failure");
          });
        });
      const r = await upload(e.id, 1, await png());
      spy.mockRestore();
      expect(r.status).toBe(500);
      expect(
        await db.image.findUnique({ where: { eventId: e.id } }),
      ).toBeNull();
      expect(
        (await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } }))
          .usedBytes,
      ).toBe(before);
      expect(
        (await db.event.findUniqueOrThrow({ where: { id: e.id } })).version,
      ).toBe(1);
      expect(
        await db.auditLog.count({
          where: { entityId: e.id, action: "EVENT_POSTER_REPLACED" },
        }),
      ).toBe(0);
    });
    it("serializes cancellation against a registration race", async () => {
      const e = await published();
      const results = await Promise.all([
        post(
          "/" + e.id + "/action",
          { action: "cancel", version: e.version },
          "admin",
        ),
        post("/" + e.id + "/register", {}, "student"),
      ]);
      expect(results[0].status).toBe(200);
      expect([200, 409]).toContain(results[1].status);
      expect(
        await db.eventRegistration.count({ where: { eventId: e.id } }),
      ).toBe(results[1].status === 200 ? 1 : 0);
      expect(
        (await db.event.findUniqueOrThrow({ where: { id: e.id } })).status,
      ).toBe("CANCELLED");
    });
    it("rejects publishing with a past start or closed deadline", async () => {
      const e = await draft({
        startsAt: "2026-10-08T10:00:00Z",
        endsAt: null,
        registrationEndsAt: "2026-10-08T09:00:00Z",
      });
      expect(
        (await post("/" + e.id + "/action", { action: "publish", version: 1 }))
          .status,
      ).toBe(400);
    });
    it("filters upcoming ongoing and past events at timestamp boundaries", async () => {
      const e = await published({ name: "Timeline " + key });
      time = new Date(e.startsAt);
      expect(
        (
          await get("?group=ongoing&q=Timeline&clubId=" + clubId, "student")
        ).body.events.map((v: { id: string }) => v.id),
      ).toContain(e.id);
      expect(
        (await get("?group=upcoming&q=Timeline&clubId=" + clubId, "student"))
          .body.total,
      ).toBe(0);
      time = new Date(e.endsAt);
      expect(
        (
          await get("?group=past&q=Timeline&clubId=" + clubId, "student")
        ).body.events.map((v: { id: string }) => v.id),
      ).toContain(e.id);
      expect(
        (await get("?group=ongoing&q=Timeline&clubId=" + clubId, "student"))
          .body.total,
      ).toBe(0);
    });
    it("rejects club grants to unapproved heads without changing roles", async () => {
      await expect(
        access.changeClubAccess(users.admin.id, {
          userId: users.student.id,
          clubId,
          active: true,
          reason: "Attempted grant",
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        await db.clubAssignment.findUnique({
          where: { userId_clubId: { userId: users.student.id, clubId } },
        }),
      ).toBeNull();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: users.student.id } }))
          .roles,
      ).toEqual(["STUDENT"]);
    });
    it("replaces a poster using only the size delta at full quota", async () => {
      const e = await draft();
      const initial = await upload(
        e.id,
        1,
        await jpeg(),
        "image/jpeg",
        "head",
        "poster.jpg",
      );
      expect(initial.status).toBe(200);
      const old = (
        await db.image.findUniqueOrThrow({ where: { eventId: e.id } })
      ).sizeBytes;
      const before = (
        await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } })
      ).usedBytes;
      await db.imageBudget.update({
        where: { id: 1 },
        data: { usedBytes: MAX_STORED_BYTES },
      });
      let size = old;
      try {
        const smaller = await sharp({
          create: { width: 1, height: 1, channels: 3, background: "white" },
        })
          .png()
          .toBuffer();
        const next = await upload(e.id, initial.body.version, smaller);
        expect(next.status).toBe(200);
        size = (await db.image.findUniqueOrThrow({ where: { eventId: e.id } }))
          .sizeBytes;
        expect(size).toBeLessThan(old);
        expect(
          (await db.imageBudget.findUniqueOrThrow({ where: { id: 1 } }))
            .usedBytes,
        ).toBe(MAX_STORED_BYTES - old + size);
      } finally {
        await db.imageBudget.update({
          where: { id: 1 },
          data: { usedBytes: before - old + size },
        });
      }
    });
    it("never includes binary images or other students in directory results", async () => {
      const e = await published();
      await upload(e.id, e.version, await png());
      await post("/" + e.id + "/register", {}, "student");
      const r = await get("?group=all&clubId=" + clubId, "combined");
      expect(JSON.stringify(r.body)).not.toContain("passwordHash");
      expect(JSON.stringify(r.body)).not.toContain('"bytes"');
      expect(JSON.stringify(r.body)).not.toContain(users.student.email);
      expect((await get("/" + e.id + "/poster", "student")).status).toBe(200);
    });
  },
);
