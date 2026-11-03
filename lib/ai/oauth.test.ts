import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizationServerMetadata,
  backToApp,
  checkAuthorize,
  hashToken,
  newToken,
  parseRegistration,
  protectedResourceMetadata,
  redirectUriAllowed,
  resourceAllowedFor,
  tokenKindOf,
  verifierMatches,
  wwwAuthenticate,
} from "./oauth";

const ORIGIN = "https://app.brycoops.com";
const VERIFIER = "dBjftJeZ4CVP-mJ92K9mH8dWYzMWrNTDxk7y0j7Eu4Q";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

describe("PKCE", () => {
  it("S256: the base64url SHA-256 of the verifier", () => {
    expect(CHALLENGE).toBe("NxnTxFQ-ASuStk9Tmobaku-b8kDwnI4HWuYtP-JY9TQ");
    expect(verifierMatches(VERIFIER, CHALLENGE)).toBe(true);
    expect(verifierMatches(VERIFIER, createHash("sha256").update(VERIFIER).digest("base64"))).toBe(false);
    expect(verifierMatches(VERIFIER.replace("d", "e"), CHALLENGE)).toBe(false);
    expect(verifierMatches("short", CHALLENGE)).toBe(false);
  });
});

describe("tokens", () => {
  it("carry their kind, and only the hash is kept", () => {
    const t = newToken("access");
    expect(tokenKindOf(t.token)).toBe("access");
    expect(t.hash).toBe(hashToken(t.token));
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenKindOf(newToken("key").token)).toBe("key");
    expect(tokenKindOf("bo_live_x")).toBeNull();
  });
});

describe("redirect addresses", () => {
  it("https anywhere, http only on this computer, an app's own scheme, never scripts", () => {
    expect(redirectUriAllowed("https://grok.com/connectors/oauth/callback")).toBe(true);
    expect(redirectUriAllowed("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectUriAllowed("http://localhost:6274/oauth/callback")).toBe(true);
    expect(redirectUriAllowed("http://127.0.0.1:33418/callback")).toBe(true);
    expect(redirectUriAllowed("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe(true);
    expect(redirectUriAllowed("http://evil.example/callback")).toBe(false);
    expect(redirectUriAllowed("javascript:alert(1)")).toBe(false);
    expect(redirectUriAllowed("https://grok.com/cb#frag")).toBe(false);
    expect(redirectUriAllowed("not a url")).toBe(false);
  });
});

describe("registration", () => {
  it("takes a name, its addresses and how it proves itself", () => {
    const r = parseRegistration({ client_name: "Grok", redirect_uris: ["https://grok.com/cb", "https://grok.com/cb"], token_endpoint_auth_method: "client_secret_post" });
    expect(r).toEqual({ ok: true, value: { name: "Grok", redirectUris: ["https://grok.com/cb"], authMethod: "client_secret_post" } });
  });
  it("names an app after its address when it gives no name", () => {
    const r = parseRegistration({ redirect_uris: ["https://grok.com/cb"] });
    expect(r.ok && r.value.name).toBe("grok.com");
    expect(r.ok && r.value.authMethod).toBe("none");
  });
  it("refuses what it can't use", () => {
    expect(parseRegistration({ redirect_uris: [] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(parseRegistration({ redirect_uris: ["http://evil.example/cb"] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(parseRegistration({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "private_key_jwt" })).toMatchObject({ ok: false });
    expect(parseRegistration({ redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] })).toMatchObject({ ok: false });
    expect(parseRegistration("nope")).toMatchObject({ ok: false });
  });
});

describe("checkAuthorize", () => {
  const client = { redirect_uris: ["https://grok.com/cb"] };
  const base = { client_id: "boc-abc", redirect_uri: "https://grok.com/cb", response_type: "code", code_challenge: CHALLENGE, code_challenge_method: "S256", state: "xyz" };
  const allowed = resourceAllowedFor(ORIGIN);

  it("a good request", () => {
    expect(checkAuthorize({ ...base, resource: `${ORIGIN}/api/mcp` }, client, allowed)).toEqual({
      ok: true,
      value: { clientId: "boc-abc", redirectUri: "https://grok.com/cb", state: "xyz", challenge: CHALLENGE, scope: "social", resource: `${ORIGIN}/api/mcp` },
    });
  });
  it("an unknown app or address stays on the page", () => {
    expect(checkAuthorize(base, null, allowed)).toMatchObject({ ok: false, kind: "page" });
    expect(checkAuthorize({ ...base, redirect_uri: "https://evil.example/cb" }, client, allowed)).toMatchObject({ ok: false, kind: "page" });
  });
  it("the only registered address is used when none is sent", () => {
    const { redirect_uri: _, ...rest } = base;
    void _;
    expect(checkAuthorize(rest, client, allowed)).toMatchObject({ ok: true });
  });
  it("anything else goes back to the app as an error", () => {
    expect(checkAuthorize({ ...base, code_challenge: undefined }, client, allowed)).toMatchObject({ ok: false, kind: "redirect", error: "invalid_request" });
    expect(checkAuthorize({ ...base, code_challenge_method: "plain" }, client, allowed)).toMatchObject({ ok: false, kind: "redirect", error: "invalid_request" });
    expect(checkAuthorize({ ...base, response_type: "token" }, client, allowed)).toMatchObject({ ok: false, kind: "redirect", error: "unsupported_response_type" });
    expect(checkAuthorize({ ...base, resource: "https://other.example/mcp" }, client, allowed)).toMatchObject({ ok: false, kind: "redirect", error: "invalid_target" });
  });
});

describe("discovery", () => {
  it("the documents point at each other", () => {
    const as = authorizationServerMetadata(ORIGIN);
    expect(as.issuer).toBe(ORIGIN);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.registration_endpoint).toBe(`${ORIGIN}/api/mcp/oauth/register`);
    const pr = protectedResourceMetadata(ORIGIN);
    expect(pr.resource).toBe(`${ORIGIN}/api/mcp`);
    expect(pr.authorization_servers).toEqual([ORIGIN]);
    expect(wwwAuthenticate(ORIGIN)).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
  });
  it("sends the app back with what it had plus the answer", () => {
    expect(backToApp("https://grok.com/cb?x=1", { code: "c", state: "s", iss: ORIGIN, error: null })).toBe(`https://grok.com/cb?x=1&code=c&state=s&iss=${encodeURIComponent(ORIGIN)}`);
  });
});
