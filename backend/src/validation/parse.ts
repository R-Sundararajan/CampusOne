import type { z } from "zod";
import { AccountError } from "../errors.js";

const MAX_FIELD_ERRORS = 20;

/** Parse untrusted request data and report bounded, field-oriented issues. */
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.slice(0, MAX_FIELD_ERRORS).map((issue) => ({
      field: issue.path.length ? issue.path.map(String).join(".") : "$",
      message: issue.message,
    }));
    throw new AccountError(400, "Request validation failed.", details);
  }
  return result.data;
}
