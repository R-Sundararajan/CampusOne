export type RegisterNumberParse = {
  suffixes: string[];
  registerNumbers: string[];
  duplicates: string[];
  errors: string[];
};
export function parseRegisterNumbers(
  input: string,
  prefix: string,
  width?: number,
): RegisterNumberParse;
