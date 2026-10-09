import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import type { PublicUser } from "../auth/repository.js";
import { AccountError } from "../registration/service.js";
import {
  canManage,
  currentUser,
  managedClubs,
  requireClub,
} from "./permissions.js";
import {
  eventGroup,
  registrationOpen,
  validateDates,
  type EventInput,
  type EventEdit,
  type EventQuery,
} from "./validation.js";
import { imageStorage, validateImage } from "../../services/image-storage.js";
const selection = {
  id: true,
  name: true,
  description: true,
  venue: true,
  startsAt: true,
  endsAt: true,
  registrationEndsAt: true,
  registrationLink: true,
  status: true,
  clubId: true,
  creatorId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  club: { select: { id: true, name: true } },
  image: { select: { id: true } },
  _count: { select: { registrations: true } },
} as const;
type Selected = Prisma.EventGetPayload<{ select: typeof selection }>;
function card(e: Selected, now: Date, registered = false) {
  const { image, _count, ...rest } = e;
  return {
    ...rest,
    posterUrl: image ? "/api/events/" + e.id + "/poster?v=" + e.version : null,
    registrationCount: _count.registrations,
    registered,
    registrationOpen: registrationOpen(e, now),
    group: eventGroup(e, now),
  };
}
export function eventsService(db: PrismaClient, clock = () => new Date()) {
  const storage = imageStorage();
  async function lockEvent(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${id} FOR UPDATE`;
    const e = await tx.event.findUnique({ where: { id }, select: selection });
    if (!e) throw new AccountError(404, "Event not found.");
    return e;
  }
  async function lockedManage<T>(
    user: PublicUser,
    id: string,
    version: number,
    fn: (tx: Prisma.TransactionClient, e: Selected) => Promise<T>,
  ) {
    return db.$transaction(async (tx) => {
      const before = await tx.event.findUnique({
        where: { id },
        select: { clubId: true },
      });
      if (!before) throw new AccountError(404, "Event not found.");
      // Same club lock is used by assignment revocation. Authorization is checked after locking.
      await tx.$queryRaw`SELECT "id" FROM "Club" WHERE "id" = ${before.clubId} FOR UPDATE`;
      await requireClub(tx, user, before.clubId);
      const e = await lockEvent(tx, id);
      if (e.version !== version)
        throw new AccountError(
          409,
          "This event changed. Reload before saving.",
        );
      return fn(tx, e);
    });
  }
  async function audit(
    tx: Prisma.TransactionClient,
    user: PublicUser,
    id: string,
    action: string,
    changes: Prisma.InputJsonValue,
  ) {
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "EVENT_" + action,
        entityType: "Event",
        entityId: id,
        changes,
      },
    });
  }
  function publishedRequirements(
    e: {
      name: string;
      description: string;
      venue: string;
      startsAt: Date | null;
      registrationEndsAt: Date | null;
      endsAt: Date | null;
    },
    publishing: boolean,
  ) {
    validateDates(e);
    if (!e.description || !e.venue || !e.startsAt || !e.registrationEndsAt)
      throw new AccountError(
        400,
        "Publishing requires a description, venue, start time and registration deadline.",
      );
    if (
      publishing &&
      (e.startsAt <= clock() || e.registrationEndsAt <= clock())
    )
      throw new AccountError(
        400,
        "Publish with a future start and an open registration deadline.",
      );
  }
  return {
    async catalog(user: PublicUser) {
      const [clubs, authorizedClubs] = await Promise.all([
        db.club.findMany({
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        managedClubs(db, user),
      ]);
      return { clubs, authorizedClubs };
    },
    async list(user: PublicUser, q: EventQuery) {
      const u = await currentUser(db, user);
      const now = clock();
      const clubs = q.scope === "manage" ? await managedClubs(db, user) : [];
      if (
        q.scope === "manage" &&
        !u.roles.some((r) => ["CLUB_HEAD", "ADMIN"].includes(r))
      )
        throw new AccountError(403, "Club Head or Admin access required.");
      if (q.scope === "mine" && !u.roles.includes("STUDENT"))
        throw new AccountError(403, "Student access required.");
      const and: Prisma.EventWhereInput[] = [];
      if (q.scope === "manage")
        and.push({ clubId: { in: clubs.map((c) => c.id) } });
      else if (q.scope === "mine")
        and.push({ registrations: { some: { studentId: u.id } } });
      else and.push({ status: "PUBLISHED" });
      if (q.status) and.push({ status: q.status });
      if (q.clubId) and.push({ clubId: q.clubId });
      if (q.q)
        and.push({
          OR: [
            { name: { contains: q.q, mode: "insensitive" } },
            { description: { contains: q.q, mode: "insensitive" } },
          ],
        });
      if (q.group === "upcoming") and.push({ startsAt: { gt: now } });
      if (q.group === "ongoing")
        and.push({ startsAt: { lte: now }, endsAt: { gt: now } });
      if (q.group === "past")
        and.push({
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { lte: now } }],
        });
      const where = { AND: and };
      const [total, events] = await db.$transaction(
        [
          db.event.count({ where }),
          db.event.findMany({
            where,
            select: {
              ...selection,
              registrations: {
                where: { studentId: u.id },
                select: { id: true, createdAt: true },
              },
            },
            orderBy: [
              { startsAt: { sort: q.sort, nulls: "last" } },
              { id: "asc" },
            ],
            skip: (q.page - 1) * q.pageSize,
            take: q.pageSize,
          }),
        ],
        { isolationLevel: "RepeatableRead" },
      );
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        events: events.map(({ registrations, ...e }) => ({
          ...card(e, now, !!registrations.length),
          registeredAt: registrations[0]?.createdAt ?? null,
        })),
      };
    },
    async detail(user: PublicUser, id: string) {
      const e = await db.event.findUnique({ where: { id }, select: selection });
      if (!e) throw new AccountError(404, "Event not found.");
      const manage = await canManage(db, user, e.clubId);
      const own = await db.eventRegistration.findUnique({
        where: { eventId_studentId: { eventId: id, studentId: user.id } },
        select: { id: true, createdAt: true },
      });
      if (e.status === "DRAFT" && !manage && !own)
        throw new AccountError(404, "Event not found.");
      const u = await currentUser(db, user);
      return {
        ...card(e, clock(), !!own),
        canManage: manage,
        canRegister: u.roles.includes("STUDENT"),
        registeredAt: own?.createdAt ?? null,
      };
    },
    async create(user: PublicUser, input: EventInput) {
      validateDates(input);
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Club" WHERE "id" = ${input.clubId} FOR UPDATE`;
        await requireClub(tx, user, input.clubId);
        if (!(await tx.club.findUnique({ where: { id: input.clubId } })))
          throw new AccountError(400, "Club not found.");
        const e = await tx.event.create({
          data: { ...input, creatorId: user.id, status: "DRAFT" },
          select: selection,
        });
        await audit(tx, user, e.id, "CREATED", { clubId: e.clubId });
        return card(e, clock());
      });
    },
    async edit(user: PublicUser, id: string, input: EventEdit) {
      return lockedManage(user, id, input.version, async (tx, e) => {
        if (e.status === "CANCELLED")
          throw new AccountError(
            409,
            "Cancelled events retain their history and cannot be edited.",
          );
        const { version, ...fields } = input;
        const next = {
          ...e,
          ...fields,
          startsAt: fields.startsAt ?? null,
          endsAt: fields.endsAt ?? null,
          registrationEndsAt: fields.registrationEndsAt ?? null,
        };
        validateDates(next);
        if (e.status === "PUBLISHED") publishedRequirements(next, false);
        if (e._count.registrations) {
          const latest = await tx.eventRegistration.findFirst({
            where: { eventId: id },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          });
          if (
            !next.startsAt ||
            !next.registrationEndsAt ||
            (latest && next.registrationEndsAt <= latest.createdAt)
          )
            throw new AccountError(
              409,
              "Keep the schedule and a deadline after existing registrations.",
            );
          if (
            next.startsAt.getTime() !== e.startsAt?.getTime() &&
            next.startsAt <= clock()
          )
            throw new AccountError(
              409,
              "Rescheduling must keep the event in the future.",
            );
        }
        const saved = await tx.event.update({
          where: { id },
          data: {
            ...fields,
            startsAt: next.startsAt,
            endsAt: next.endsAt,
            registrationEndsAt: next.registrationEndsAt,
            registrationLink: fields.registrationLink ?? null,
            version: { increment: 1 },
          },
          select: selection,
        });
        await audit(tx, user, id, "EDITED", {
          fromVersion: version,
          toVersion: saved.version,
          fields: JSON.parse(JSON.stringify(fields)),
        });
        return card(saved, clock());
      });
    },
    async action(
      user: PublicUser,
      id: string,
      version: number,
      action: "publish" | "cancel" | "unpublish",
    ) {
      return lockedManage(user, id, version, async (tx, e) => {
        const u = await currentUser(tx, user);
        if (e.status === "CANCELLED")
          throw new AccountError(409, "Cancelled events cannot change status.");
        if (action === "publish") {
          if (e.status !== "DRAFT")
            throw new AccountError(409, "Only drafts can be published.");
          publishedRequirements(e, true);
        }
        if (action === "unpublish") {
          if (!u.roles.includes("ADMIN"))
            throw new AccountError(403, "Only Admin can unpublish events.");
          if (e.status !== "PUBLISHED")
            throw new AccountError(
              409,
              "Only published events can be unpublished.",
            );
          if (e._count.registrations)
            throw new AccountError(
              409,
              "This event has registrations. Cancel it to retain visible registration history.",
            );
        }
        const status =
          action === "publish"
            ? "PUBLISHED"
            : action === "cancel"
              ? "CANCELLED"
              : "DRAFT";
        const saved = await tx.event.update({
          where: { id },
          data: { status, version: { increment: 1 } },
          select: selection,
        });
        await audit(tx, user, id, action.toUpperCase(), {
          from: e.status,
          to: status,
          fromVersion: version,
        });
        return card(saved, clock());
      });
    },
    async register(user: PublicUser, id: string) {
      return db.$transaction(async (tx) => {
        const e = await lockEvent(tx, id);
        const u = await currentUser(tx, user);
        if (!u.roles.includes("STUDENT"))
          throw new AccountError(
            403,
            "Approved Student access is required to register.",
          );
        const previous = await tx.eventRegistration.findUnique({
          where: { eventId_studentId: { eventId: id, studentId: u.id } },
          select: { id: true, createdAt: true },
        });
        if (previous)
          return {
            registered: true,
            alreadyRegistered: true,
            registration: previous,
          };
        const now = clock();
        if (!registrationOpen(e, now))
          throw new AccountError(409, "Registration is closed for this event.");
        const registration = await tx.eventRegistration.create({
          data: { eventId: id, studentId: u.id, createdAt: now },
          select: { id: true, createdAt: true },
        });
        return { registered: true, alreadyRegistered: false, registration };
      });
    },
    async registrations(
      user: PublicUser,
      id: string,
      page: number,
      pageSize: number,
    ) {
      const e = await db.event.findUnique({
        where: { id },
        select: { clubId: true },
      });
      if (!e) throw new AccountError(404, "Event not found.");
      await requireClub(db, user, e.clubId);
      const [total, registrations] = await db.$transaction([
        db.eventRegistration.count({ where: { eventId: id } }),
        db.eventRegistration.findMany({
          where: { eventId: id },
          select: {
            id: true,
            createdAt: true,
            student: {
              select: { id: true, name: true, email: true, department: true },
            },
          },
          orderBy: [{ createdAt: "asc" }, { studentId: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { total, page, pageSize, registrations };
    },
    async statistics(user: PublicUser) {
      const u = await currentUser(db, user);
      if (!u.roles.some((r) => ["ADMIN", "CLUB_HEAD"].includes(r)))
        throw new AccountError(403, "Club Head or Admin access required.");
      const clubs = await managedClubs(db, user);
      if (!clubs.length)
        return {
          clubs: [],
          totalEvents: 0,
          upcomingEvents: 0,
          pastEvents: 0,
          totalRegistrations: 0,
        };
      const now = clock();
      const rows = await db.$queryRaw<
        {
          clubId: string;
          name: string;
          totalEvents: number;
          upcomingEvents: number;
          pastEvents: number;
          totalRegistrations: number;
        }[]
      >(Prisma.sql`
    SELECT c."id" AS "clubId", c."name", COUNT(DISTINCT e."id")::int AS "totalEvents",
    COUNT(DISTINCT e."id") FILTER (WHERE e."status" = 'PUBLISHED' AND e."startsAt" > ${now})::int AS "upcomingEvents",
    COUNT(DISTINCT e."id") FILTER (WHERE e."status" = 'PUBLISHED' AND e."startsAt" <= ${now} AND (e."endsAt" IS NULL OR e."endsAt" <= ${now}))::int AS "pastEvents",
    COUNT(r."id")::int AS "totalRegistrations"
    FROM "Club" c LEFT JOIN "Event" e ON e."clubId"=c."id" LEFT JOIN "EventRegistration" r ON r."eventId"=e."id"
    WHERE c."id" IN (${Prisma.join(clubs.map((c) => c.id))}) GROUP BY c."id",c."name" ORDER BY c."name"`);
      return {
        clubs: rows,
        totalEvents: rows.reduce((a, c) => a + c.totalEvents, 0),
        upcomingEvents: rows.reduce((a, c) => a + c.upcomingEvents, 0),
        pastEvents: rows.reduce((a, c) => a + c.pastEvents, 0),
        totalRegistrations: rows.reduce((a, c) => a + c.totalRegistrations, 0),
      };
    },
    async poster(user: PublicUser, id: string) {
      await this.detail(user, id);
      const img = await db.image.findUnique({
        where: { eventId: id },
        select: { bytes: true, mimeType: true },
      });
      if (!img?.bytes) throw new AccountError(404, "Poster not found.");
      return img;
    },
    async savePoster(
      user: PublicUser,
      id: string,
      version: number,
      bytes: Buffer,
      mime: string,
    ) {
      const validated = await validateImage(bytes, mime);
      return lockedManage(user, id, version, async (tx, e) => {
        if (e.status === "CANCELLED")
          throw new AccountError(409, "Cancelled events cannot be edited.");
        await storage.replace(tx, { eventId: id }, validated);
        const saved = await tx.event.update({
          where: { id },
          data: { version: { increment: 1 } },
          select: selection,
        });
        await audit(tx, user, id, "POSTER_REPLACED", {
          sizeBytes: validated.bytes.length,
          fromVersion: version,
        });
        return card(saved, clock());
      });
    },
    async removePoster(user: PublicUser, id: string, version: number) {
      return lockedManage(user, id, version, async (tx, e) => {
        if (e.status === "CANCELLED")
          throw new AccountError(409, "Cancelled events cannot be edited.");
        await storage.remove(tx, { eventId: id });
        const saved = await tx.event.update({
          where: { id },
          data: { version: { increment: 1 } },
          select: selection,
        });
        await audit(tx, user, id, "POSTER_REMOVED", { fromVersion: version });
        return card(saved, clock());
      });
    },
  };
}
export type EventsService = ReturnType<typeof eventsService>;
