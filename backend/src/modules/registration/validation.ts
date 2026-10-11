import { z } from "zod";

export const institutionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254))
  .refine(
    (email) => email.split("@")[1] === "ssn.edu.in",
    "Use your @ssn.edu.in institutional email.",
  );
export const requestableRole = z.enum(["STAFF", "CLUB_HEAD"]);
export const registrationSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    email: institutionalEmail,
    accountType: z.enum(["STUDENT", "STAFF", "CLUB_HEAD"]),
    password: z.string().min(12).max(128),
    confirmPassword: z.string().min(12).max(128),
  })
  .strict()
  .refine(
    (value) => value.password === value.confirmPassword,
    "Passwords must match.",
  );
export const decisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("APPROVED"),
      clubId: z.string().min(1).max(100).optional(),
      offeringIds: z.array(z.string().min(1).max(100)).max(30).default([]),
      identityConfirmed: z.boolean().optional(),
      syntheticIdentityAttested: z.boolean().optional(),
      identityEvidence: z.string().trim().min(10).max(500).optional(),
    })
    .strict(),
  z
    .object({
      decision: z.literal("REJECTED"),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
export type Registration = z.infer<typeof registrationSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type RequestedRole = z.infer<typeof requestableRole>;
