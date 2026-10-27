import { z } from "zod";
import { textField } from "../../validation/text.js";
import { parseInput } from "../../validation/parse.js";
import { queryInteger, requiredQueryInteger } from "../../validation/query.js";
export const groups = ["UG_I", "UG_II", "UG_III", "UG_IV", "PG"] as const;
export const categories = ["FACILITIES", "HOSTEL", "SANITATION", "SAFETY", "OTHER"] as const;
const group = z.enum(groups);
const version = z.number().int().positive();
const reason = textField({ min: 1, max: 2000, multiline: true });
export const submissionSchema = z.object({
  title: textField({ min: 1, max: 160 }),
  description: textField({ min: 1, max: 6000, multiline: true }),
  category: z.enum(categories).default("OTHER"),
  location: textField({ max: 200 }).optional(),
  studentGroup: group.nullable().optional(),
}).strict();
export const acceptSchema = z.object({ version, studentGroup: group, confirmRouting: z.literal(true) }).strict();
export const rejectSchema = z.object({ version, reason }).strict();
export const reassignSchema = z.object({ version, supervisorGroup: group, reason }).strict();
export const assignmentSchema = z.object({ version, userId: textField({ min: 1, max: 100 }).nullable(), reason, identityConfirmed: z.boolean().optional(), syntheticIdentityAttested: z.boolean().optional() }).strict().superRefine((value, ctx) => {
  if (value.identityConfirmed && value.syntheticIdentityAttested)
    ctx.addIssue({ code: "custom", path: ["syntheticIdentityAttested"], message: "Choose one identity basis." });
  if (value.userId === null && (value.identityConfirmed || value.syntheticIdentityAttested))
    ctx.addIssue({ code: "custom", path: ["userId"], message: "Identity confirmation applies only when designating a Supervisor." });
});
export const noteSchema = z.object({ version, text: textField({ min: 1, max: 4000, multiline: true }), wardenContact: textField({ max: 240 }).optional() }).strict();
export const resolveSchema = z.object({ version, resolutionDetails: textField({ min: 1, max: 4000, multiline: true }) }).strict();
export const feedbackSchema = z.object({ version, feedback: textField({ min: 1, max: 2000, multiline: true }) }).strict();
export const imageSchema = z.object({ version: requiredQueryInteger(1, Number.MAX_SAFE_INTEGER) }).strict();
export const listSchema = z.object({
  scope: z.enum(["mine", "admin", "supervisor"]).default("mine"),
  status: z.enum(["SUBMITTED", "ACCEPTED", "RESOLVED", "REJECTED"]).optional(),
  studentGroup: group.optional(),
  supervisorId: textField({ min: 1, max: 100 }).optional(),
  category: z.enum(categories).optional(),
  location: textField({ max: 200 }).optional(),
  from: z.iso.datetime({ offset: true }).transform(v => new Date(v)).optional(),
  to: z.iso.datetime({ offset: true }).transform(v => new Date(v)).optional(),
  page: queryInteger(1, 10000, 1),
  pageSize: queryInteger(1, 30, 15),
}).strict().refine(q => !q.from || !q.to || q.from <= q.to, "Start date must precede end date.");
export const parse = parseInput;
export type Submission = z.infer<typeof submissionSchema>;
export type ComplaintQuery = z.infer<typeof listSchema>;
