import { describe, expect, it } from "vitest";
import { packState, unpackState } from "../connect";
import { callbackUrl, CONNECTION_INFO, CONNECTIONS, connectionCredentials, isHiddenConnection, SHOWN_PLATFORMS, siteOrigin } from "../platforms";
import { outcome, runLooksOff } from "../publish";
import { authorizeUrlFor } from "./index";
import { cleanHandle, looksLikeAppPassword } from "./bluesky";
import { count, errorText, expiresAt, needsRefresh, quoteBigIntegers } from "./common";
import { linkedinScopes, linkedinVersion } from "./linkedin";
import { graphVersion, META_SCOPES } from "./meta";
import { userAgent } from "./reddit";

const R = "https://pp.example.com/api/callback";

describe("signing in to the networks", () => {
  it("each network's sign-in address", () => {
    const x = new URL(authorizeUrlFor("x", "cid", `${R}/x`, "st", "chal"));
    expect(x.searchParams.get("code_challenge_method")).toBe("S256");
    expect(x.searchParams.get("scope")).toContain("offline.access");
    const yt = new URL(authorizeUrlFor("google", "cid", `${R}/google`, "st", "chal"));
    expect(yt.host).toBe("accounts.google.com");
    expect(yt.searchParams.get("access_type")).toBe("offline");
    expect(yt.searchParams.get("scope")).toContain("youtube.upload");
    const tt = new URL(authorizeUrlFor("tiktok", "ckey", `${R}/tiktok`, "st", "chal"));
    expect(tt.searchParams.get("client_key")).toBe("ckey");
    expect(tt.searchParams.get("scope")).toBe("user.info.basic,user.info.stats,video.list,video.publish");
    const rd = new URL(authorizeUrlFor("reddit", "cid", `${R}/reddit`, "st", "chal"));
    expect(rd.searchParams.get("duration")).toBe("permanent");
    expect(rd.searchParams.get("scope")).toBe("identity submit read");
    const fb = new URL(authorizeUrlFor("meta", "app", `${R}/meta`, "st", "chal"));
    expect(fb.searchParams.get("scope")).toBe(META_SCOPES);
    expect(META_SCOPES).toContain("instagram_manage_insights");
    const li = new URL(authorizeUrlFor("linkedin", "cid", `${R}/linkedin`, "st", "chal"));
    expect(li.searchParams.get("scope")).toBe(linkedinScopes());
  });
  it("tokens with under five minutes left are refreshed", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    expect(needsRefresh("2026-11-03T12:04:00Z", now)).toBe(true);
    expect(needsRefresh("2026-11-03T13:00:00Z", now)).toBe(false);
    expect(needsRefresh(null, now)).toBe(true);
  });
  it("versions and options from the environment", () => {
    expect(linkedinScopes({})).toBe("openid profile w_member_social");
    expect(linkedinScopes({ LINKEDIN_PAGES: "1" })).toContain("r_organization_social");
    expect(linkedinVersion({ LINKEDIN_API_VERSION: "202611" })).toBe("202611");
    expect(graphVersion({ META_GRAPH_VERSION: "v26.0" })).toBe("v26.0");
    expect(graphVersion({ META_GRAPH_VERSION: "26" })).toMatch(/^v\d+\.\d+$/);
    expect(userAgent("me", {})).toBe("web:post-planner:1.0 (by /u/me)");
    expect(userAgent(null, { REDDIT_USER_AGENT: "web:mine:2" })).toBe("web:mine:2");
  });
  it("Bluesky takes app passwords only", () => {
    expect(cleanHandle(" @Me.bsky.social ")).toBe("me.bsky.social");
    expect(looksLikeAppPassword("abcd-efgh-ijkl-mnop")).toBe(true);
    expect(looksLikeAppPassword("my real password")).toBe(false);
  });
  it("needs both keys for a network", () => {
    expect(connectionCredentials(CONNECTION_INFO.tiktok, { TIKTOK_CLIENT_KEY: "a" })).toBeNull();
    expect(connectionCredentials(CONNECTION_INFO.google, { GOOGLE_CLIENT_ID: " a ", GOOGLE_CLIENT_SECRET: "b" })).toEqual({ id: "a", secret: "b" });
    expect(connectionCredentials(CONNECTION_INFO.bluesky, {})).toBeNull();
  });
  it("callbacks on the app's address", () => {
    expect(callbackUrl("reddit", "https://pp.example.com/")).toBe("https://pp.example.com/api/callback/reddit");
    expect(siteOrigin("https://post-planner.vercel.app/x", { APP_URL: "https://social.example.com/" })).toBe("https://social.example.com");
    expect(siteOrigin("https://post-planner.vercel.app/x", {})).toBe("https://post-planner.vercel.app");
  });
  it("the sign-in's state survives the cookie", () => {
    const s = { connection: "x", state: "abc", verifier: "def" };
    expect(unpackState(packState(s))).toEqual(s);
    expect(unpackState("garbage")).toBeNull();
  });
});

describe("network answers", () => {
  it("finds the message whatever its shape", () => {
    expect(errorText({ error: { message: "Invalid OAuth access token.", code: 190 } })).toBe("Invalid OAuth access token.");
    expect(errorText({ error: { code: "access_token_invalid", message: "The access token is invalid" } })).toBe("The access token is invalid");
    expect(errorText({ error: "invalid_grant", error_description: "Token expired" })).toBe("Token expired");
    expect(errorText({ message: "Invalid identifier or password", error: "AuthenticationRequired" })).toBe("Invalid identifier or password");
    expect(errorText("plain text")).toBe("plain text");
    expect(errorText(null)).toBeNull();
  });
  it("keeps 19-digit ids whole", () => {
    const parsed = JSON.parse(quoteBigIntegers('{"ids":[7300000000000000001, 7300000000000000002],"n":12,"x":{"id":12345678901234567}, "s":"9999999999999999999"}'));
    expect(parsed).toEqual({ ids: ["7300000000000000001", "7300000000000000002"], n: 12, x: { id: "12345678901234567" }, s: "9999999999999999999" });
  });
  it("counts", () => {
    expect(count(5)).toBe(5);
    expect(count("1234")).toBe(1234);
    expect(count("n/a")).toBeNull();
    expect(expiresAt(60, Date.parse("2026-11-03T12:00:00Z"))).toBe("2026-11-03T12:01:00.000Z");
  });
});

describe("publishing outcome", () => {
  it("posted only when every account has it; still going while one is processing", () => {
    expect(outcome([{ status: "published" }, { status: "published" }])).toBe("published");
    expect(outcome([{ status: "published" }, { status: "processing" }])).toBe("publishing");
    expect(outcome([{ status: "published" }, { status: "failed" }])).toBe("failed");
    expect(outcome([])).toBe("failed");
  });
  it("warns when scheduled posts are waiting and the run hasn't come in 10 minutes", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    expect(runLooksOff(null, 0, now)).toBe(false);
    expect(runLooksOff(null, 2, now)).toBe(true);
    expect(runLooksOff("2026-11-03T11:55:00Z", 2, now)).toBe(false);
  });
});

describe("hidden networks", () => {
  it("Reddit is hidden everywhere; the rest are shown", () => {
    expect(SHOWN_PLATFORMS).not.toContain("reddit");
    expect(SHOWN_PLATFORMS).toEqual(["x", "facebook", "instagram", "linkedin", "youtube", "tiktok", "bluesky"]);
    expect(CONNECTIONS.filter(isHiddenConnection)).toEqual(["reddit"]);
    expect(CONNECTION_INFO.meta.platforms.every((p) => SHOWN_PLATFORMS.includes(p))).toBe(true);
  });
});
