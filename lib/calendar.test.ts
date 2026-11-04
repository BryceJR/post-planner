import { describe, expect, it } from "vitest";
import { daysBetween, isDay, monthGrid, stepMonth } from "./calendar";

describe("calendar", () => {
  it("a month is six whole weeks from the week holding the 1st", () => {
    const grid = monthGrid("2026-10-15");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-09-27");
    expect(grid[41]).toBe("2026-11-07");
  });
  it("only real days", () => {
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("nope")).toBe(false);
  });
  it("steps months across years", () => {
    expect(stepMonth("2026-12-15", 1)).toBe("2027-01-01");
    expect(stepMonth("2026-01-31", -1)).toBe("2025-12-01");
  });
  it("days between, inclusive", () => {
    expect(daysBetween("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });
});
