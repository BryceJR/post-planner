// Calendar days and the company time zone. Exact timestamps are UTC instants;
// people see them in the company zone, and a "work day" is a YYYY-MM-DD in
// that zone. Pure functions on Intl.DateTimeFormat: no libraries, safe on the
// server and in the browser.

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 86_400_000;

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

// Building a formatter is slow, so keep one per zone.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function toMs(instant: Date | string | number): number {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === "number" ? instant : new Date(instant).getTime();
  if (!Number.isFinite(ms)) throw new Error(`Not a valid instant: ${String(instant)}`);
  return ms;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

// What a clock on the wall in that zone reads at this instant.
function wallClockAt(ms: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour");
  // some engines print midnight as "24" even with h23; treat it as 0
  return { year: get("year"), month: get("month"), day: get("day"), hour: hour === 24 ? 0 : hour, minute: get("minute"), second: get("second") };
}

// The wall clock read as if it were UTC. Handy for offset math.
function wallAsUtc(w: WallClock): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

// The zone's offset from UTC at an instant, in ms (Los Angeles in summer: -7h).
function offsetAt(ms: number, timeZone: string): number {
  const wholeSecond = Math.floor(ms / 1000) * 1000;
  return wallAsUtc(wallClockAt(wholeSecond, timeZone)) - wholeSecond;
}

function parseDay(day: string): { year: number; month: number; day: number } {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`Not a valid day (expected YYYY-MM-DD): ${day}`);
  const [year, month, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, d));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== d) {
    throw new Error(`Not a valid day: ${day}`);
  }
  return { year, month, day: d };
}

function parseTime(time: string): { hour: number; minute: number; second: number } {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Not a valid time (expected HH:mm or HH:mm:ss): ${time}`);
  const [hour, minute, second] = [Number(m[1]), Number(m[2]), Number(m[3] ?? "0")];
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`Not a valid time: ${time}`);
  return { hour, minute, second };
}

function formatDay(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

// A calendar day in a time zone, as YYYY-MM-DD, from an instant.
export function dayInZone(instant: Date | string | number, timeZone: string): string {
  const w = wallClockAt(toMs(instant), timeZone);
  return formatDay(w.year, w.month, w.day);
}

// The instant a wall-clock time in a zone points at. `time` is HH:mm or HH:mm:ss.
// Daylight saving: a time that does not exist on spring-forward day moves to
// the next valid instant (02:30 becomes 03:30); a time that happens twice on
// fall-back day takes the first occurrence.
export function zonedToUtc(day: string, time: string, timeZone: string): Date {
  const d = parseDay(day);
  const t = parseTime(time);
  const wall = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute, t.second);
  // The offsets in force a day before and a day after bracket any transition
  // near this wall time. Each gives a candidate instant; keep those that
  // really read back as this wall time.
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  const offsets = before === after ? [before] : [before, after];
  const valid = offsets.map((o) => wall - o).filter((candidate) => offsetAt(candidate, timeZone) === wall - candidate);
  if (valid.length > 0) return new Date(Math.min(...valid));
  // Nothing matched: the clock skipped this time. Using the offset from before
  // the jump lands on the next valid instant.
  return new Date(wall - before);
}

export function startOfDayInZone(day: string, timeZone: string): Date {
  return zonedToUtc(day, "00:00", timeZone);
}

// The instant the next day starts: an exclusive end, so a day's entries are
// those with start >= startOfDay and start < endOfDay.
export function endOfDayInZone(day: string, timeZone: string): Date {
  return startOfDayInZone(addDays(day, 1), timeZone);
}

// Calendar math on YYYY-MM-DD, no zone involved.
export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day + Math.trunc(n)));
  return formatDay(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

// 0 = Sunday … 6 = Saturday.
export function weekdayOf(day: string): number {
  const d = parseDay(day);
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

function checkWeekday(n: number, what: string) {
  if (!Number.isInteger(n) || n < 0 || n > 6) throw new Error(`${what} must be 0 (Sunday) to 6 (Saturday), got ${n}`);
}

// The day the week containing `day` starts on, given the company's week-start day.
export function weekStartOf(day: string, weekStartsOn: number): string {
  checkWeekday(weekStartsOn, "weekStartsOn");
  const back = (weekdayOf(day) - weekStartsOn + 7) % 7;
  return addDays(day, -back);
}

export function weekEndOf(day: string, weekStartsOn: number): string {
  return addDays(weekStartOf(day, weekStartsOn), 6);
}

// The seven days of the week containing `day`, in order.
export function daysOfWeek(day: string, weekStartsOn: number): string[] {
  const start = weekStartOf(day, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// Today's calendar day in the company zone. Pass `nowMs` so the server and
// the browser agree while a page loads.
export function todayInZone(timeZone: string, nowMs?: number): string {
  return dayInZone(nowMs ?? Date.now(), timeZone);
}

// How far back crew can pick a day to fix or ask about: this week and last.
export const FIX_DAYS_BACK = 14;

// The day a "?day=" link asks for, when it's one of the last FIX_DAYS_BACK
// days (today included); otherwise today.
export function pickedDay(param: string | null | undefined, today: string, daysBack: number = FIX_DAYS_BACK): string {
  if (!param || !/^\d{4}-\d{2}-\d{2}$/.test(param)) return today;
  if (param > today || param <= addDays(today, -daysBack)) return today;
  return param;
}
