import { z } from "zod";

type TextOptions = {
  min?: number;
  max: number;
  multiline?: boolean;
};

/** Normalize human-entered text and reject control characters that are not
 * meaningful for the field. Multiline fields retain tabs and line breaks. */
export function textField({ min = 0, max, multiline = false }: TextOptions) {
  const controls = multiline
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u
    : /[\u0000-\u001F\u007F-\u009F]/u;
  return z
    .string()
    .transform((value) => value.normalize("NFC"))
    .pipe(
      z
        .string()
        .trim()
        .min(min)
        .max(max)
        .refine((value) => !controls.test(value), "Remove unsupported control characters."),
    );
}
