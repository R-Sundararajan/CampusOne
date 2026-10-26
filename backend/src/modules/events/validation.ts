import { z } from "zod";
import { AccountError } from "../registration/service.js";
import { textField } from "../../validation/text.js";
import { parseInput } from "../../validation/parse.js";
import { queryInteger, requiredQueryInteger } from "../../validation/query.js";
const id = textField({ min: 1, max: 100 });
const date = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .nullable()
  .optional();
const fields = {
  name: textField({ min: 1, max: 160 }),
  description: textField({ max: 10000, multiline: true }).default(""),
  venue: textField({ max: 200 }).default(""),
  startsAt: date,
  endsAt: date,
  registrationEndsAt: date,
  registrationLink: z
    .string()
    .pipe(textField({ max: 2000 }))
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
  .object({ version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })
  .strict();
export const queryVersionSchema = z
  .object({ version: requiredQueryInteger(1, Number.MAX_SAFE_INTEGER) })
  .strict();
export const listSchema = z
  .object({
    scope: z.enum(["browse", "manage", "mine"]).default("browse"),
    group: z.enum(["upcoming", "ongoing", "past", "all"]).default("upcoming"),
    status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]).optional(),
    clubId: id.optional(),
    q: textField({ max: 120 }).default(""),
    sort: z.enum(["asc", "desc"]).default("asc"),
    page: queryInteger(1, 10000, 1),
    pageSize: queryInteger(1, 24, 12),
  })
  .strict();
export const pageSchema = z
  .object({
    page: queryInteger(1, 10000, 1),
    pageSize: queryInteger(1, 50, 25),
  })
  .strict();
export type EventInput = z.infer<typeof createSchema>;
export type EventEdit = z.infer<typeof editSchema>;
export type EventQuery = z.infer<typeof listSchema>;
export const parse = parseInput;
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
