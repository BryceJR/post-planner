import { describe, expect, it } from "vitest";
import { makeSession, passwordMatches, sessionValid } from "./session";

const env = { SESSION_SECRET: "x".repeat(40), APP_PASSWORD: "correct horse battery" };

describe("sign-in", () => {
  it("a session is good until it runs out, and only with the same secret", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    const s = makeSession(now, env);
    expect(sessionValid(s.value, now + 1000, env)).toBe(true);
    expect(sessionValid(s.value, now + 31 * 86_400_000, env)).toBe(false);
    expect(sessionValid(s.value, now, { SESSION_SECRET: "y".repeat(40) })).toBe(false);
    expect(sessionValid(s.value.replace(/.$/, "A"), now, env)).toBe(false);
    expect(sessionValid(undefined, now, env)).toBe(false);
    expect(sessionValid(`${now + 9e9}.forged`, now, env)).toBe(false);
  });
  it("refuses a short secret", () => {
    expect(() => makeSession(Date.now(), { SESSION_SECRET: "short" })).toThrow();
  });
  it("the password", () => {
    expect(passwordMatches("correct horse battery", env)).toBe(true);
    expect(passwordMatches("wrong", env)).toBe(false);
    expect(passwordMatches("", { APP_PASSWORD: "" })).toBe(false);
    expect(passwordMatches("short", { APP_PASSWORD: "short" })).toBe(false);
  });
});
