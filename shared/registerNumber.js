// Shared, deterministic parser. Strings preserve prefix/suffix leading zeroes.
export function parseRegisterNumbers(input, prefix, width = 3) {
  const result = {
    suffixes: [],
    registerNumbers: [],
    duplicates: [],
    errors: [],
  };
  if (!/^\d{1,24}$/.test(prefix))
    result.errors.push("Use a numeric register prefix of 1–24 digits.");
  if (!Number.isInteger(width) || width < 1 || width > 6)
    result.errors.push("Suffix width must be between 1 and 6.");
  if (typeof input !== "string" || input.length > 20000)
    result.errors.push("Limit bulk input to 20,000 characters.");
  if (result.errors.length) return result;
  if (/\.{2,}|…/.test(input)) {
    result.errors.push(
      "Ambiguous shorthand: write an inclusive range such as 62-132 instead of 62,63,...132.",
    );
    return result;
  }
  const seen = new Set();
  const duplicates = new Set();
  const max = 10 ** width - 1;
  let expanded = 0;
  for (const token of input
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean)) {
    if (!/^\d+(?:-\d+)?$/.test(token)) {
      result.errors.push(
        `Invalid entry “${token}”. Use suffixes or ranges such as 62-132.`,
      );
      continue;
    }
    const [start, end = start] = token.split("-").map(Number);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > max ||
      end > max
    ) {
      result.errors.push(`Entry “${token}” exceeds suffix width ${width}.`);
      continue;
    }
    if (end < start) {
      result.errors.push(
        `Reversed range “${token}”. Write the smaller suffix first.`,
      );
      continue;
    }
    if (end - start + 1 > 1000 || expanded + end - start + 1 > 5000) {
      result.errors.push(
        `Range/input is too large: at most 1,000 values per range and 5,000 expanded values.`,
      );
      continue;
    }
    expanded += end - start + 1;
    for (let value = start; value <= end; value++) {
      const suffix = String(value).padStart(width, "0");
      if (seen.has(suffix)) duplicates.add(suffix);
      seen.add(suffix);
    }
  }
  result.suffixes = [...seen].sort();
  result.registerNumbers = result.suffixes.map((suffix) => prefix + suffix);
  result.duplicates = [...duplicates].sort();
  return result;
}
