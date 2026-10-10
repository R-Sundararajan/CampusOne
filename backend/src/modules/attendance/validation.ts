import { z } from "zod";
export const id = z.string().trim().min(1).max(100);
const label = z.string().trim().min(1).max(100);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(value + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }, "Use a valid calendar date (YYYY-MM-DD).");
export const termSchema = z.object({ name: label }).strict();
export const classSchema = z
  .object({
    termId: id,
    department: label,
    admissionBatch: label,
    name: label,
    section: label,
  })
  .strict();
export const offeringSchema = z
  .object({ classGroupId: id, code: label, name: label })
  .strict();
export const assignmentSchema = z
  .object({ staffId: id, offeringId: id, assigned: z.boolean(), identityConfirmed: z.boolean().optional() })
  .strict();
export const rosterSchema = z
  .object({
    classGroupId: id,
    prefix: z.string().regex(/^\d{1,24}$/),
    suffixWidth: z.number().int().min(1).max(6),
    input: z.string().max(20000),
    names: z.record(z.string(), z.string().trim().max(100)).default({}),
  })
  .strict();
export const importSchema = rosterSchema.extend({
  confirmed: z.literal(true),
  rosterVersion: z.number().int().nonnegative(),
});
export const linkSchema = z
  .object({
    registerNumber: z.string().regex(/^\d{2,30}$/),
    identityConfirmed: z.boolean().optional(),
    email: z.email().trim().toLowerCase(),
    reason: z.string().trim().min(10).max(500),
    confirmed: z.literal(true),
  })
  .strict();
export const membershipSchema = z
  .object({
    studentId: id,
    active: z.boolean(),
    reason: z.string().trim().min(5).max(500),
    confirmed: z.literal(true),
    rosterVersion: z.number().int().nonnegative(),
  })
  .strict();
export const selectionSchema = z
  .object({ offeringId: id, date, period: z.number().int().min(1).max(12) })
  .strict();
export const previewSchema = selectionSchema.extend({
  mode: z.enum(["PRESENT", "ABSENT", "ALL_PRESENT", "ALL_ABSENT", "EXISTING"]),
  input: z.string().max(20000).default(""),
  overrides: z
    .array(
      z
        .object({ studentId: id, status: z.enum(["PRESENT", "ABSENT"]) })
        .strict(),
    )
    .max(2000)
    .default([]),
});
export const saveSchema = previewSchema.extend({
  confirmed: z.literal(true),
  allConfirmation: z.enum(["PRESENT", "ABSENT"]).optional(),
  rosterVersion: z.number().int().nonnegative(),
  sessionVersion: z.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional(),
});
export const reportSchema = z
  .object({
    termId: id.optional(),
    classGroupId: id.optional(),
    section: label.optional(),
    offeringId: id.optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .strict()
  .refine(
    (x) => !x.from || !x.to || x.from <= x.to,
    "Start date must be on or before end date.",
  );
export type RosterInput = z.infer<typeof rosterSchema>;
export type AttendanceInput = z.infer<typeof previewSchema>;
export type SaveInput = z.infer<typeof saveSchema>;
export type ReportFilter = z.infer<typeof reportSchema>;
