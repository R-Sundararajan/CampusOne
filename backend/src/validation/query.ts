import { z } from "zod";

const decimal = z
    .string()
    .regex(/^(0|[1-9]\d{0,15})$/, "Use a decimal integer.")
    .transform(Number);

/** Parse canonical decimal query integers without JavaScript coercion quirks. */
export function queryInteger(min: number, max: number, fallback: number) {
  return decimal
    .optional()
    .transform((value) => value ?? fallback)
    .pipe(z.number().int().min(min).max(max));
}

export function requiredQueryInteger(min: number, max: number) {
  return decimal.pipe(z.number().int().min(min).max(max));
}

export const emptyQuerySchema = z.object({}).strict();
export const cacheVersionSchema = z
  .object({ v: queryInteger(1, Number.MAX_SAFE_INTEGER, 1) })
  .strict();
