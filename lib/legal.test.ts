import { describe, expect, it } from "vitest";
import { contactLine } from "../app/legal-page";
import { proxy } from "../proxy";
import { NextRequest } from "next/server";

describe("privacy policy and terms", () => {
  it("are open without signing in, like the networks need", () => {
    for (const path of ["/privacy", "/terms"]) {
      const res = proxy(new NextRequest(`https://pp.example.com${path}`));
      expect(res.headers.get("location")).toBeNull();
    }
    expect(proxy(new NextRequest("https://pp.example.com/accounts")).headers.get("location")).toMatch(/\/login\?next=%2Faccounts$/);
  });
  it("show a contact address only when a real one is set", () => {
    expect(contactLine({ CONTACT_EMAIL: " me@example.com " })).toBe("me@example.com");
    expect(contactLine({ CONTACT_EMAIL: "not an email" })).toBeNull();
    expect(contactLine({})).toBeNull();
  });
});
