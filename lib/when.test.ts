import { describe, expect, it } from "vitest";
import { parseWhen, sayWhen, wallInput } from "./when";

const LA = "America/Los_Angeles";

describe("parseWhen", () => {
  it("now and draft", () => {
    expect(parseWhen("now", LA)).toEqual({ kind: "now" });
    expect(parseWhen("NOW", LA)).toEqual({ kind: "now" });
    expect(parseWhen("draft", LA)).toEqual({ kind: "draft", at: null });
    expect(parseWhen("", LA)).toEqual({ kind: "draft", at: null });
  });
  it("a wall-clock time reads in the calendar's zone, standard and daylight time", () => {
    expect(parseWhen("2026-11-05T09:00", LA)).toEqual({ kind: "schedule", at: "2026-11-05T17:00:00.000Z" });
    expect(parseWhen("2026-07-04 9:30", LA)).toEqual({ kind: "schedule", at: "2026-07-04T16:30:00.000Z" });
    expect(parseWhen("2026-11-05 9:00 pm", LA)).toEqual({ kind: "schedule", at: "2026-11-06T05:00:00.000Z" });
    expect(parseWhen("2026-11-05 12:15 am", LA)).toEqual({ kind: "schedule", at: "2026-11-05T08:15:00.000Z" });
  });
  it("an offset wins over the zone", () => {
    expect(parseWhen("2026-11-05T09:00:00-05:00", LA)).toEqual({ kind: "schedule", at: "2026-11-05T14:00:00.000Z" });
    expect(parseWhen("2026-11-05T09:00:00Z", LA)).toEqual({ kind: "schedule", at: "2026-11-05T09:00:00.000Z" });
  });
  it("says what's wrong", () => {
    expect(parseWhen("2026-11-05", LA)).toHaveProperty("error");
    expect(parseWhen("2026-02-30T09:00", LA)).toHaveProperty("error");
    expect(parseWhen("2026-11-05T25:00", LA)).toHaveProperty("error");
    expect(parseWhen("tomorrow", LA)).toHaveProperty("error");
  });
});

describe("showing times", () => {
  it("wallInput is what parseWhen reads back", () => {
    const at = "2026-11-05T17:00:00.000Z";
    expect(wallInput(at, LA)).toBe("2026-11-05T09:00");
    expect(parseWhen(wallInput(at, LA), LA)).toEqual({ kind: "schedule", at });
  });
  it("sayWhen names the day, time and zone", () => {
    expect(sayWhen("2026-11-05T17:00:00.000Z", LA)).toBe("Thu, Nov 5, 2026, 9:00 AM PST");
  });
});
