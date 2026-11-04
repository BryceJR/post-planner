// Signing in: one person, one password (APP_PASSWORD). A signed-in browser
// carries a cookie that says until when, signed with SESSION_SECRET, so
// nothing is kept on the server and changing SESSION_SECRET signs everyone out.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pp_session";
export const SESSION_DAYS = 30;

function secret(env: Record<string, string | undefined> = process.env): string {
  const s = env.SESSION_SECRET?.trim() ?? "";
  if (s.length < 32) throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters.");
  return s;
}

function sign(value: string, key: string) {
  return createHmac("sha256", key).update(value).digest("base64url");
}

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function makeSession(nowMs = Date.now(), env?: Record<string, string | undefined>): { value: string; maxAge: number } {
  const until = nowMs + SESSION_DAYS * 86_400_000;
  return { value: `${until}.${sign(String(until), secret(env))}`, maxAge: SESSION_DAYS * 86_400 };
}

export function sessionValid(value: string | undefined | null, nowMs = Date.now(), env?: Record<string, string | undefined>): boolean {
  if (!value) return false;
  const [until, mac] = value.split(".");
  if (!until || !mac || !/^\d+$/.test(until) || Number(until) < nowMs) return false;
  try {
    return same(mac, sign(until, secret(env)));
  } catch {
    return false;
  }
}

// The password check. Hashing both sides first keeps the comparison the
// same length whatever is typed.
export function passwordMatches(typed: string, env: Record<string, string | undefined> = process.env): boolean {
  const real = env.APP_PASSWORD ?? "";
  if (real.length < 8) return false;
  const h = (s: string) => createHmac("sha256", "post-planner").update(s).digest();
  return timingSafeEqual(h(typed), h(real));
}
