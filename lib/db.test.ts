import { describe, expect, it } from "vitest";
import { cleanKey, describeKey, projectRef } from "./db";

const URL = "https://gaxjgyvwvujcwcccuati.supabase.co";
const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("the database key", () => {
  it("drops what a paste adds", () => {
    expect(cleanKey('  "sb_secret_abc"\n')).toBe("sb_secret_abc");
    expect(cleanKey("sb_secret_ab c")).toBe("sb_secret_abc");
    expect(cleanKey(undefined)).toBe("");
  });
  it("reads the project from the address", () => {
    expect(projectRef(URL)).toBe("gaxjgyvwvujcwcccuati");
    expect(projectRef("https://example.com")).toBeNull();
  });
  it("says what kind of key it is, never the key", () => {
    const secret = "sb_secret_" + "x".repeat(31);
    expect(describeKey(secret, URL)).toMatch(/secret key \(sb_secret_…, 41 characters\)\. If the database still refuses it, it's most likely from a different project: .*gaxjgyvwvujcwcccuati/);
    expect(describeKey(secret, URL)).not.toContain("xxxx");
    expect(describeKey("sb_secret_AbC12•••••••", URL)).toMatch(/copy icon/);
    expect(describeKey("sb_secret_abc", URL)).toMatch(/cut short/);
    expect(describeKey("sb_publishable_" + "x".repeat(31), URL)).toMatch(/publishable key/);
    expect(describeKey(jwt({ role: "service_role", ref: "zylrzcxjuwwakohfjvoc" }), URL)).toMatch(/different project: this app's database is gaxjgyvwvujcwcccuati/);
    expect(describeKey(jwt({ role: "anon", ref: "gaxjgyvwvujcwcccuati" }), URL)).toMatch(/should be the service_role key, not anon/);
    expect(describeKey(jwt({ role: "service_role", ref: "gaxjgyvwvujcwcccuati" }), URL)).toBe(`It's an older-style key for the "service_role" role of project gaxjgyvwvujcwcccuati.`);
    expect(describeKey("super-secret-jwt-secret-value", URL)).toMatch(/doesn't look like a Supabase API key \(it starts "sup…"/);
    expect(describeKey("", URL)).toMatch(/empty/);
  });
});
