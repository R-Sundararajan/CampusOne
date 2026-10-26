import { z } from "zod";
import { textField } from "../../validation/text.js";

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
    fullName: textField({ min: 2, max: 100 }),
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
      clubId: textField({ min: 1, max: 100 }).optional(),
      offeringIds: z.array(textField({ min: 1, max: 100 })).max(30).default([]),
      identityConfirmed: z.boolean().optional(),
      syntheticIdentityAttested: z.boolean().optional(),
      identityEvidence: textField({ min: 10, max: 500, multiline: true }).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.identityConfirmed && value.syntheticIdentityAttested)
        ctx.addIssue({ code: "custom", path: ["syntheticIdentityAttested"], message: "Choose one identity basis." });
      if (value.syntheticIdentityAttested && !value.identityEvidence)
        ctx.addIssue({ code: "custom", path: ["identityEvidence"], message: "Synthetic fixture approval requires authorization evidence." });
      if (value.identityEvidence && !value.syntheticIdentityAttested)
        ctx.addIssue({ code: "custom", path: ["identityEvidence"], message: "Evidence is only accepted for synthetic fixture attestation." });
    }),
  z
    .object({
      decision: z.literal("REJECTED"),
      reason: textField({ min: 1, max: 500, multiline: true }),
    })
    .strict(),
]);
export type Registration = z.infer<typeof registrationSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type RequestedRole = z.infer<typeof requestableRole>;
