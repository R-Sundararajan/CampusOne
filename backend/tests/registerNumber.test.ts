import { describe, expect, it } from "vitest";
import { parseRegisterNumbers } from "../src/modules/attendance/registerNumber.js";
import { csv, percentage } from "../src/modules/attendance/service.js";
import { date, reportSchema } from "../src/modules/attendance/validation.js";
describe("Deterministic register-number parsing", () => {
  it.each([
    "62,63,304,305",
    "62 63 304 305",
    "62\n63\n304\n305",
    "62, 63\n304\t305",
  ])("accepts separators in %j", (input) => {
    expect(parseRegisterNumbers(input, "3122245002")).toMatchObject({
      suffixes: ["062", "063", "304", "305"],
      registerNumbers: [
        "3122245002062",
        "3122245002063",
        "3122245002304",
        "3122245002305",
      ],
      errors: [],
    });
  });
  it("expands only explicitly written inclusive ranges including lateral entries", () => {
    const result = parseRegisterNumbers("62-132,304,305", "3122245002");
    expect(result.registerNumbers).toHaveLength(73);
    expect(result.suffixes[0]).toBe("062");
    expect(result.suffixes).toContain("132");
    expect(result.suffixes).not.toContain("133");
  });
  it("normalizes and reports duplicates across ranges and padded suffixes", () => {
    expect(parseRegisterNumbers("62,062,62-63,63", "0001")).toMatchObject({
      suffixes: ["062", "063"],
      duplicates: ["062", "063"],
      registerNumbers: ["0001062", "0001063"],
    });
  });
  it("preserves prefix zeroes and supports different widths", () => {
    expect(parseRegisterNumbers("1 62", "000123", 2).registerNumbers).toEqual([
      "00012301",
      "00012362",
    ]);
    expect(parseRegisterNumbers("0 3004", "901", 4).registerNumbers).toEqual([
      "9010000",
      "9013004",
    ]);
  });
  it.each(["a,62", "-1", "1.5", "62/63", "62 - 63"])(
    "rejects malformed values %j",
    (input) =>
      expect(parseRegisterNumbers(input, "100").errors.length).toBeGreaterThan(
        0,
      ),
  );
  it.each(["62,63,...132", "62…132"])(
    "explains ambiguous shorthand %j",
    (input) =>
      expect(parseRegisterNumbers(input, "100").errors[0]).toContain("62-132"),
  );
  it("rejects reversed ranges, overflow and excessive expansion", () => {
    expect(parseRegisterNumbers("70-62", "100").errors[0]).toContain(
      "Reversed",
    );
    expect(parseRegisterNumbers("1000", "100", 3).errors[0]).toContain(
      "width 3",
    );
    expect(parseRegisterNumbers("0-1001", "100", 4).errors[0]).toContain(
      "too large",
    );
    expect(
      parseRegisterNumbers("0-999,0-999,0-999,0-999,0-999,0-999", "100")
        .errors[0],
    ).toContain("too large");
  });
  it("rejects invalid configuration and input length without expansion", () => {
    expect(parseRegisterNumbers("62", "abc").errors).not.toEqual([]);
    expect(parseRegisterNumbers("62", "100", 0).errors).not.toEqual([]);
    expect(parseRegisterNumbers("62", "100", 7).errors).not.toEqual([]);
    expect(parseRegisterNumbers("1".repeat(20001), "100").suffixes).toEqual([]);
    expect(parseRegisterNumbers("", "100")).toMatchObject({
      suffixes: [],
      errors: [],
    });
  });
});
describe("Report formatting and dates", () => {
  it("calculates weighted percentages and zero sessions safely", () => {
    expect(percentage(30, 35)).toBe(85.71);
    expect(percentage(0, 0)).toBe(0);
  });
  it("quotes CSV cells and guards spreadsheet formula injection", () => {
    expect(
      csv([
        ["a,b", '"quoted"', "line\nbreak", "=cmd", " @SUM(1)", "3122245002062"],
      ]),
    ).toBe(
      '\uFEFF"a,b","""quoted""","line\nbreak","\'=cmd","\' @SUM(1)","3122245002062"\r\n',
    );
  });
  it("validates real calendar dates and ordered date ranges", () => {
    expect(date.safeParse("2026-02-30").success).toBe(false);
    expect(date.safeParse("2028-02-29").success).toBe(true);
    expect(
      reportSchema.safeParse({ from: "2026-10-10", to: "2026-10-09" }).success,
    ).toBe(false);
    expect(reportSchema.safeParse({ studentId: "other" }).success).toBe(false);
  });
});
