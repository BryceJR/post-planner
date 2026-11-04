// When a post goes, as the composer and the assistant say it: "now", "draft",
// a time with its offset (2026-11-05T09:00:00-08:00), or a wall-clock time
// read in the calendar's time zone (2026-11-05T09:00, 2026-11-05 9:00 am).
// Pure; tested in when.test.ts.
import { isDay } from "./calendar";
import { dayInZone, zonedToUtc } from "./zone";

export type ParsedWhen = { kind: "now" } | { kind: "draft"; at: string | null } | { kind: "schedule"; at: string };

const WALL = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function parseWhen(raw: string | null | undefined, timeZone: string): ParsedWhen | { error: string } {
  const text = (raw ?? "").trim();
  if (!text || /^draft$/i.test(text)) return { kind: "draft", at: null };
  if (/^now$/i.test(text)) return { kind: "now" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: `"${text}" needs a time too, like ${text}T09:00.` };
  if (HAS_OFFSET.test(text)) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? { kind: "schedule", at: new Date(ms).toISOString() } : { error: `"${text}" isn't a date and time.` };
  }
  const m = WALL.exec(text);
  if (!m) return { error: `"${text}" isn't a date and time. Use "now", "draft", or a time like 2026-11-05T09:00.` };
  const [, day, h, min, sec, ampm] = m;
  if (!isDay(day)) return { error: `${day} isn't a real day.` };
  let hour = Number(h);
  if (ampm) {
    if (hour < 1 || hour > 12) return { error: `"${text}" isn't a time.` };
    hour = (hour % 12) + (ampm.toLowerCase() === "pm" ? 12 : 0);
  }
  if (hour > 23 || Number(min) > 59 || Number(sec ?? 0) > 59) return { error: `"${text}" isn't a time.` };
  const time = `${String(hour).padStart(2, "0")}:${min}:${sec ?? "00"}`;
  return { kind: "schedule", at: zonedToUtc(day, time, timeZone).toISOString() };
}

// "Thu, Nov 5, 9:00 AM PST": how the calendar and the assistant say a time.
export function sayWhen(iso: string, timeZone: string): string {
  const text = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
  // newer ICU puts a narrow no-break space before AM/PM; use a plain one
  return text.replace(/[\u202f\u00a0]/g, " ");
}

// The value for an <input type="datetime-local"> in the zone: 2026-11-05T09:00.
export function wallInput(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function todayIn(timeZone: string, nowMs = Date.now()): string {
  return dayInZone(nowMs, timeZone);
}

// "9:00 AM" in the zone.
export function clockIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/[  ]/g, " ");
}
