// The AI connector's sign-in, by the rules MCP clients follow (OAuth 2.1 with
// PKCE, discovery documents, apps that register themselves). Grok, Claude and
// the rest add https://<site>/api/mcp as a connector, are sent here to ask,
// and you say yes on /oauth/authorize. Pure; tested in oauth.test.ts.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SCOPE = "social";
export const CODE_TTL_MS = 10 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 90 * 24 * 3600_000;
// A refresh token traded moments ago still works once more (two requests
// racing each other must not sign the assistant out).
export const REFRESH_GRACE_MS = 2 * 60_000;

export type TokenKind = "code" | "access" | "refresh" | "key";
const PREFIX: Record<TokenKind, string> = { code: "boc_", access: "boa_", refresh: "bor_", key: "bok_" };

export function newToken(kind: TokenKind): { token: string; hash: string } {
  const token = PREFIX[kind] + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function newClientId(): string {
  return `boc-${randomBytes(18).toString("base64url")}`;
}

export function newClientSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashToken(secret) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function tokenKindOf(token: string): TokenKind | null {
  const kind = (Object.keys(PREFIX) as TokenKind[]).find((k) => token.startsWith(PREFIX[k]));
  return kind ?? null;
}

export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// PKCE: the verifier the app kept, against the challenge it sent first.
export function verifierMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return sameSecret(createHash("sha256").update(verifier).digest("base64url"), challenge);
}

// Where an app may be sent back to: https anywhere, http only on this
// computer (desktop apps), or an app's own scheme (cursor://…). Never a
// script or data address.
export function redirectUriAllowed(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return !!u.hostname;
  if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !["javascript:", "data:", "file:", "vbscript:", "about:", "blob:", "ftp:", "ws:", "wss:"].includes(u.protocol);
}

// The app's own registration (RFC 7591): what it's called and where it goes back.
export type Registration = { name: string; redirectUris: string[]; authMethod: "none" | "client_secret_post" | "client_secret_basic" };

export function parseRegistration(body: unknown): { ok: true; value: Registration } | { ok: false; error: string; description: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_client_metadata", description: "Send the registration as a JSON object." };
  const b = body as Record<string, unknown>;
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length) return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris needs at least one address." };
  if (uris.length > 10) return { ok: false, error: "invalid_redirect_uri", description: "At most 10 redirect_uris." };
  const bad = uris.find((u) => u.length > 2000 || !redirectUriAllowed(u));
  if (bad) return { ok: false, error: "invalid_redirect_uri", description: `${bad.slice(0, 200)} can't be a redirect address (https, or http on localhost).` };
  const method = typeof b.token_endpoint_auth_method === "string" ? b.token_endpoint_auth_method : "none";
  if (method !== "none" && method !== "client_secret_post" && method !== "client_secret_basic") {
    return { ok: false, error: "invalid_client_metadata", description: `token_endpoint_auth_method ${method} isn't supported (none, client_secret_post, client_secret_basic).` };
  }
  const grants = Array.isArray(b.grant_types) ? b.grant_types : ["authorization_code"];
  if (!grants.includes("authorization_code")) return { ok: false, error: "invalid_client_metadata", description: "grant_types must include authorization_code." };
  const rawName = typeof b.client_name === "string" ? b.client_name : "";
  const name = rawName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || hostOf(uris[0]) || "AI assistant";
  return { ok: true, value: { name, redirectUris: [...new Set(uris)], authMethod: method } };
}

function hostOf(uri: string): string | null {
  try {
    return new URL(uri).hostname || null;
  } catch {
    return null;
  }
}

// What an app asks for at /oauth/authorize. A bad client or redirect address
// is shown on the page (never redirected to); anything else goes back to the
// app as an OAuth error.
export type AuthorizeParams = { clientId: string; redirectUri: string; state: string | null; challenge: string; scope: string; resource: string | null };
export type AuthorizeCheck =
  | { ok: true; value: AuthorizeParams }
  | { ok: false; kind: "page"; message: string }
  | { ok: false; kind: "redirect"; redirectUri: string; state: string | null; error: string; description: string };

export function checkAuthorize(
  q: Record<string, string | undefined>,
  client: { redirect_uris: string[] } | null,
  resourceAllowed: (r: string) => boolean
): AuthorizeCheck {
  const clientId = q.client_id?.trim() ?? "";
  if (!clientId || !client) return { ok: false, kind: "page", message: "This connection request doesn't come from an app Post Planner knows. Start again from the assistant's connector settings." };
  const redirectUri = q.redirect_uri?.trim() || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : "");
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return { ok: false, kind: "page", message: "The address this request would send you back to isn't one the app registered, so it was stopped. Start again from the assistant's connector settings." };
  }
  const state = q.state ?? null;
  const fail = (error: string, description: string): AuthorizeCheck => ({ ok: false, kind: "redirect", redirectUri, state, error, description });
  if (q.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const challenge = q.code_challenge?.trim() ?? "";
  if (!challenge) return fail("invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256.");
  if ((q.code_challenge_method ?? "plain") !== "S256") return fail("invalid_request", "Only code_challenge_method=S256 is supported.");
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(challenge)) return fail("invalid_request", "code_challenge isn't a valid S256 challenge.");
  const resource = q.resource?.trim() || null;
  if (resource && !resourceAllowed(resource)) return fail("invalid_target", "That resource isn't this server.");
  return { ok: true, value: { clientId, redirectUri, state, challenge, scope: SCOPE, resource } };
}

// The address the app is sent back to, with the code (or the error) and the
// issuer (RFC 9207), keeping anything already on it.
export function backToApp(redirectUri: string, params: Record<string, string | null>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

// ---------- discovery documents ----------

export function mcpUrl(origin: string) {
  return `${origin}/api/mcp`;
}

export function resourceAllowedFor(origin: string) {
  return (r: string) => {
    const clean = r.replace(/\/+$/, "");
    return clean === origin || clean === mcpUrl(origin);
  };
}

// RFC 8414: where to sign in, trade codes, and register.
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    revocation_endpoint: `${origin}/api/mcp/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/accounts`,
  };
}

// RFC 9728: which server signs in for /api/mcp.
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Post Planner",
    resource_documentation: `${origin}/accounts`,
  };
}

export function wwwAuthenticate(origin: string, error?: "invalid_token") {
  const parts = [`resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`, `scope="${SCOPE}"`];
  if (error) parts.push(`error="${error}"`);
  return `Bearer ${parts.join(", ")}`;
}

// The site's own address as the app reached it, so every
// document and link agrees with the address the connector was added with.
export function originOf(request: Request): string {
  return new URL(request.url).origin;
}

// The same from a page's request headers (Vercel sets both).
export function originFromHeaders(h: Headers): string {
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000").split(",")[0].trim();
  const proto = (h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}
