import { describe, expect, it } from "vitest";
import {
  addDays,
  dayInZone,
  daysOfWeek,
  endOfDayInZone,
  startOfDayInZone,
  todayInZone,
  weekEndOf,
  weekStartOf,
  weekdayOf,
  zonedToUtc,
} from "./zone";

const LA = "America/Los_Angeles";

describe("dayInZone", () => {
  it("finds the calendar day in the company zone, across midnight", () => {
    // 03:30Z on Oct 6 is still the evening of Oct 5 in Los Angeles
    expect(dayInZone("2026-10-06T03:30:00.000Z", LA)).toBe("2026-10-05");
    expect(dayInZone("2026-10-06T03:30:00.000Z", "UTC")).toBe("2026-10-06");
    expect(dayInZone("2026-10-06T03:30:00.000Z", "Asia/Tokyo")).toBe("2026-10-06");
  });
  it("takes a Date, an ISO string or ms", () => {
    const ms = Date.UTC(2026, 9, 6, 3, 30);
    expect(dayInZone(ms, LA)).toBe("2026-10-05");
    expect(dayInZone(new Date(ms), LA)).toBe("2026-10-05");
  });
  it("rejects something that is not a time", () => {
    expect(() => dayInZone("yesterday", LA)).toThrow();
  });
});

describe("zonedToUtc", () => {
  it("turns a wall-clock time into the instant on a normal day", () => {
    expect(zonedToUtc("2026-10-05", "09:00", LA).toISOString()).toBe("2026-10-05T16:00:00.000Z");
    expect(zonedToUtc("2026-10-05", "09:00:30", LA).toISOString()).toBe("2026-10-05T16:00:30.000Z");
    expect(zonedToUtc("2026-01-15", "09:00", LA).toISOString()).toBe("2026-01-15T17:00:00.000Z");
    expect(zonedToUtc("2026-10-05", "09:00", "America/New_York").toISOString()).toBe("2026-10-05T13:00:00.000Z");
    expect(zonedToUtc("2026-10-05", "09:00", "UTC").toISOString()).toBe("2026-10-05T09:00:00.000Z");
  });
  it("moves a time the clock skipped on spring-forward day to the next valid instant", () => {
    // 02:30 does not exist on 2026-03-08 in Los Angeles: it becomes 03:30 PDT
    expect(zonedToUtc("2026-03-08", "02:30", LA).toISOString()).toBe("2026-03-08T10:30:00.000Z");
    // right around the jump
    expect(zonedToUtc("2026-03-08", "01:59", LA).toISOString()).toBe("2026-03-08T09:59:00.000Z");
    expect(zonedToUtc("2026-03-08", "03:00", LA).toISOString()).toBe("2026-03-08T10:00:00.000Z");
  });
  it("takes the first occurrence of a time the clock repeats on fall-back day", () => {
    // 01:30 happens twice on 2026-11-01 in Los Angeles: PDT first (08:30Z), then PST (09:30Z)
    expect(zonedToUtc("2026-11-01", "01:30", LA).toISOString()).toBe("2026-11-01T08:30:00.000Z");
    expect(zonedToUtc("2026-11-01", "00:59", LA).toISOString()).toBe("2026-11-01T07:59:00.000Z");
    expect(zonedToUtc("2026-11-01", "02:00", LA).toISOString()).toBe("2026-11-01T10:00:00.000Z");
  });
  it("throws on a malformed day or time", () => {
    expect(() => zonedToUtc("2026-13-01", "09:00", LA)).toThrow();
    expect(() => zonedToUtc("2026-02-30", "09:00", LA)).toThrow();
    expect(() => zonedToUtc("10/05/2026", "09:00", LA)).toThrow();
    expect(() => zonedToUtc("2026-10-05", "9:00", LA)).toThrow();
    expect(() => zonedToUtc("2026-10-05", "24:00", LA)).toThrow();
    expect(() => zonedToUtc("2026-10-05", "09:60", LA)).toThrow();
    expect(() => zonedToUtc("2026-10-05", "09:00:99", LA)).toThrow();
  });
});

describe("start and end of day", () => {
  it("brackets a day in the company zone with an exclusive end", () => {
    expect(startOfDayInZone("2026-10-05", LA).toISOString()).toBe("2026-10-05T07:00:00.000Z");
    expect(endOfDayInZone("2026-10-05", LA).toISOString()).toBe("2026-10-06T07:00:00.000Z");
    expect(dayInZone(endOfDayInZone("2026-10-05", LA).getTime() - 1, LA)).toBe("2026-10-05");
    expect(dayInZone(endOfDayInZone("2026-10-05", LA), LA)).toBe("2026-10-06");
  });
  it("gives a 23-hour day on spring-forward and a 25-hour day on fall-back", () => {
    const spring = endOfDayInZone("2026-03-08", LA).getTime() - startOfDayInZone("2026-03-08", LA).getTime();
    expect(spring).toBe(23 * 3_600_000);
    const fall = endOfDayInZone("2026-11-01", LA).getTime() - startOfDayInZone("2026-11-01", LA).getTime();
    expect(fall).toBe(25 * 3_600_000);
  });
});

describe("calendar math", () => {
  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-05", 0)).toBe("2026-10-05");
  });
  it("knows the weekday", () => {
    expect(weekdayOf("2026-10-04")).toBe(0); // Sunday
    expect(weekdayOf("2026-10-05")).toBe(1); // Monday
    expect(weekdayOf("2026-10-10")).toBe(6); // Saturday
  });
  it("finds the start of the week when the week starts Monday", () => {
    expect(weekStartOf("2026-10-06", 1)).toBe("2026-10-05"); // Tuesday
    expect(weekStartOf("2026-10-05", 1)).toBe("2026-10-05"); // Monday itself
    expect(weekStartOf("2026-10-11", 1)).toBe("2026-10-05"); // Sunday belongs to the week before
    expect(weekEndOf("2026-10-06", 1)).toBe("2026-10-11");
  });
  it("finds the start of the week when the week starts Sunday", () => {
    expect(weekStartOf("2026-10-06", 0)).toBe("2026-10-04");
    expect(weekStartOf("2026-10-04", 0)).toBe("2026-10-04");
    expect(weekStartOf("2026-10-10", 0)).toBe("2026-10-04");
    expect(weekEndOf("2026-10-06", 0)).toBe("2026-10-10");
  });
  it("lists the seven days of the week in order", () => {
    expect(daysOfWeek("2026-10-06", 1)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(daysOfWeek("2026-10-06", 0)[0]).toBe("2026-10-04");
    expect(daysOfWeek("2026-10-06", 0)[6]).toBe("2026-10-10");
  });
  it("rejects a week-start day outside 0–6", () => {
    expect(() => weekStartOf("2026-10-06", 7)).toThrow();
  });
  it("tells today in the company zone from a given moment", () => {
    expect(todayInZone(LA, Date.UTC(2026, 9, 6, 3, 30))).toBe("2026-10-05");
    expect(todayInZone("UTC", Date.UTC(2026, 9, 6, 3, 30))).toBe("2026-10-06");
    expect(todayInZone(LA)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
