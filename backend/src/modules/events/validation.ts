import { z } from "zod";
import { AccountError } from "../registration/service.js";
const id = z.string().trim().min(1).max(100);
const date = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .nullable()
  .optional();
const fields = {
  name: z.string().trim().min(1, "Enter an event name.").max(160),
  description: z.string().trim().max(10000).default(""),
  venue: z.string().trim().max(200).default(""),
  startsAt: date,
  endsAt: date,
  registrationEndsAt: date,
  registrationLink: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => {
      try {
        const u = new URL(v);
        return (
          ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
        );
      } catch {
        return false;
      }
    }, "Use an HTTP(S) external link.")
    .nullable()
    .optional(),
};
export const createSchema = z.object({ ...fields, clubId: id }).strict();
export const editSchema = z
  .object({ ...fields, version: z.number().int().positive() })
  .strict();
export const actionSchema = z
  .object({
    version: z.number().int().positive(),
    action: z.enum(["publish", "cancel", "unpublish"]),
  })
  .strict();
export const versionSchema = z
  .object({ version: z.coerce.number().int().positive() })
  .strict();
export const listSchema = z
  .object({
    scope: z.enum(["browse", "manage", "mine"]).default("browse"),
    group: z.enum(["upcoming", "ongoing", "past", "all"]).default("upcoming"),
    status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]).optional(),
    clubId: id.optional(),
    q: z.string().trim().max(120).default(""),
    sort: z.enum(["asc", "desc"]).default("asc"),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(24).default(12),
  })
  .strict();
export const pageSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
export type EventInput = z.infer<typeof createSchema>;
export type EventEdit = z.infer<typeof editSchema>;
export type EventQuery = z.infer<typeof listSchema>;
export function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new AccountError(
      400,
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  return parsed.data;
}
export function validateDates(e: {
  startsAt?: Date | null;
  endsAt?: Date | null;
  registrationEndsAt?: Date | null;
}) {
  if (e.endsAt && (!e.startsAt || e.endsAt <= e.startsAt))
    throw new AccountError(400, "End time must follow the start time.");
  if (
    e.registrationEndsAt &&
    (!e.startsAt || e.registrationEndsAt > e.startsAt)
  )
    throw new AccountError(
      400,
      "Registration deadline must be on or before the start time.",
    );
}
export function registrationOpen(
  e: { status: string; startsAt: Date | null; registrationEndsAt: Date | null },
  now: Date,
) {
  return (
    e.status === "PUBLISHED" &&
    !!e.startsAt &&
    e.startsAt > now &&
    !!e.registrationEndsAt &&
    e.registrationEndsAt > now
  );
}
export function eventGroup(
  e: { startsAt: Date | null; endsAt: Date | null },
  now: Date,
) {
  if (!e.startsAt) return "unscheduled";
  if (e.startsAt > now) return "upcoming";
  return e.endsAt && e.endsAt > now ? "ongoing" : "past";
}
