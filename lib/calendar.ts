// Calendar math on YYYY-MM-DD days: a real day, a month's six weeks, the
// next and previous month. Pure; tested in calendar.test.ts.
import { addDays, weekStartOf } from "./zone";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar day: 2026-02-30 is not one.
export function isDay(d: string | undefined | null): d is string {
  if (!d || !DAY_RE.test(d)) return false;
  const [y, m, day] = d.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, day));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === day;
}

// The six rows of a month view: whole weeks, from the week holding the 1st.
export function monthGrid(day: string, weekStartsOn = 0): string[] {
  const start = weekStartOf(`${day.slice(0, 7)}-01`, weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// The first day of the month before or after.
export function stepMonth(day: string, direction: 1 | -1): string {
  const [y, m] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1 + direction, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// Every day from first to last, inclusive.
export function daysBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
