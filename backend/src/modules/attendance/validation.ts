import { z } from "zod";
import { textField } from "../../validation/text.js";
export const id = textField({ min: 1, max: 100 });
const label = textField({ min: 1, max: 100 });
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
  .object({ staffId: id, offeringId: id, assigned: z.boolean(), identityConfirmed: z.boolean().optional(), syntheticIdentityAttested: z.boolean().optional(), identityEvidence: textField({ min: 10, max: 500, multiline: true }).optional() })
  .strict()
  .superRefine((value, ctx) => {
    if (value.identityConfirmed && value.syntheticIdentityAttested)
      ctx.addIssue({ code: "custom", path: ["syntheticIdentityAttested"], message: "Choose one identity basis." });
    if (value.syntheticIdentityAttested && !value.identityEvidence)
      ctx.addIssue({ code: "custom", path: ["identityEvidence"], message: "Synthetic assignment requires authorization evidence." });
    if (value.identityEvidence && !value.syntheticIdentityAttested)
      ctx.addIssue({ code: "custom", path: ["identityEvidence"], message: "Evidence is only accepted for synthetic fixture attestation." });
    if (!value.assigned && (value.identityConfirmed || value.syntheticIdentityAttested || value.identityEvidence))
      ctx.addIssue({ code: "custom", path: ["assigned"], message: "Identity confirmation applies only when granting an assignment." });
  });
export const rosterSchema = z
  .object({
    classGroupId: id,
    prefix: z.string().regex(/^\d{1,24}$/),
    suffixWidth: z.number().int().min(1).max(6),
    input: textField({ max: 20000, multiline: true }),
    names: z.record(z.string().regex(/^\d{2,30}$/), textField({ max: 100 })).default({}),
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
    syntheticIdentityAttested: z.boolean().optional(),
    email: z.email().trim().toLowerCase(),
    reason: textField({ min: 10, max: 500, multiline: true }),
    confirmed: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.identityConfirmed && value.syntheticIdentityAttested)
      ctx.addIssue({ code: "custom", path: ["syntheticIdentityAttested"], message: "Choose one identity basis." });
  });
export const membershipSchema = z
  .object({
    studentId: id,
    active: z.boolean(),
    reason: textField({ min: 5, max: 500, multiline: true }),
    confirmed: z.literal(true),
    rosterVersion: z.number().int().nonnegative(),
  })
  .strict();
export const selectionSchema = z
  .object({ offeringId: id, date, period: z.number().int().min(1).max(12) })
  .strict();
export const previewSchema = selectionSchema.extend({
  mode: z.enum(["PRESENT", "ABSENT", "ALL_PRESENT", "ALL_ABSENT", "EXISTING"]),
  input: textField({ max: 20000, multiline: true }).default(""),
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
  reason: textField({ max: 500, multiline: true }).optional(),
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
