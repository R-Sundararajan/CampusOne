import { z } from "zod";
import { AccountError } from "../registration/service.js";
export const groups = ["UG_I", "UG_II", "UG_III", "UG_IV", "PG"] as const;
export const categories = ["FACILITIES", "HOSTEL", "SANITATION", "SAFETY", "OTHER"] as const;
const group = z.enum(groups);
const version = z.number().int().positive();
const reason = z.string().trim().min(1, "Enter a reason.").max(2000);
export const submissionSchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(160),
  description: z.string().trim().min(1, "Enter a description.").max(6000),
  category: z.enum(categories).default("OTHER"),
  location: z.string().trim().max(200).optional(),
  studentGroup: group.nullable().optional(),
}).strict();
export const acceptSchema = z.object({ version, studentGroup: group, confirmRouting: z.literal(true) }).strict();
export const rejectSchema = z.object({ version, reason }).strict();
export const reassignSchema = z.object({ version, supervisorGroup: group, reason }).strict();
export const assignmentSchema = z.object({ version, userId: z.string().trim().min(1).max(100).nullable(), reason }).strict();
export const noteSchema = z.object({ version, text: z.string().trim().min(1).max(4000), wardenContact: z.string().trim().max(240).optional() }).strict();
export const resolveSchema = z.object({ version, resolutionDetails: z.string().trim().min(1, "Enter resolution details.").max(4000) }).strict();
export const feedbackSchema = z.object({ version, feedback: z.string().trim().min(1).max(2000) }).strict();
export const imageSchema = z.object({ version: z.coerce.number().int().positive() }).strict();
export const listSchema = z.object({
  scope: z.enum(["mine", "admin", "supervisor"]).default("mine"),
  status: z.enum(["SUBMITTED", "ACCEPTED", "RESOLVED", "REJECTED"]).optional(),
  studentGroup: group.optional(),
  supervisorId: z.string().trim().min(1).max(100).optional(),
  category: z.enum(categories).optional(),
  location: z.string().trim().max(200).optional(),
  from: z.iso.datetime({ offset: true }).transform(v => new Date(v)).optional(),
  to: z.iso.datetime({ offset: true }).transform(v => new Date(v)).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(30).default(15),
}).strict().refine(q => !q.from || !q.to || q.from <= q.to, "Start date must precede end date.");
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AccountError(400, result.error.issues.map(i => i.message).join(" "));
  return result.data;
}
export type Submission = z.infer<typeof submissionSchema>;
export type ComplaintQuery = z.infer<typeof listSchema>;
