// The AI connector's apps, approvals and tokens in the database (0079), with
// the server key. Only hashes of codes, tokens, keys and secrets are kept.
// Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  hashToken,
  newClientId,
  newClientSecret,
  newToken,
  REFRESH_GRACE_MS,
  REFRESH_TTL_MS,
  SCOPE,
  sameSecret,
  tokenKindOf,
  verifierMatches,
  type Registration,
} from "./oauth";

type Db = SupabaseClient;

export type AiClient = { id: string; client_id: string; secret_hash: string | null; name: string; redirect_uris: string[]; auth_method: Registration["authMethod"]; created_at: string };

const CLIENT_COLUMNS = "id, client_id, secret_hash, name, redirect_uris, auth_method, created_at";

export async function registerClient(db: Db, reg: Registration, nowMs = Date.now()) {
  await forgetStale(db, nowMs);
  const clientId = newClientId();
  const secret = reg.authMethod === "none" ? null : newClientSecret();
  const { error } = await db.from("ai_clients").insert({
    client_id: clientId,
    secret_hash: secret?.hash ?? null,
    name: reg.name,
    redirect_uris: reg.redirectUris,
    auth_method: reg.authMethod,
  });
  if (error) throw new Error(error.message);
  return {
    client_id: clientId,
    ...(secret ? { client_secret: secret.secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(nowMs / 1000),
    client_name: reg.name,
    redirect_uris: reg.redirectUris,
    token_endpoint_auth_method: reg.authMethod,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: SCOPE,
  };
}

export async function findClient(db: Db, clientId: string): Promise<AiClient | null> {
  if (!clientId || clientId.length > 100) return null;
  const { data, error } = await db.from("ai_clients").select(CLIENT_COLUMNS).eq("client_id", clientId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AiClient | null) ?? null;
}

// The app proves who it is at the token endpoint: by its secret when it
// registered with one, by PKCE alone when it didn't.
export function clientSecretOk(client: AiClient, provided: string | null): boolean {
  if (client.auth_method === "none" || !client.secret_hash) return true;
  return !!provided && sameSecret(hashToken(provided), client.secret_hash);
}

// You said yes: the app's approval (one per app; saying yes again
// reuses it) and a one-time code for it.
export async function approve(db: Db, client: AiClient, opts: { redirectUri: string; challenge: string; nowMs?: number }): Promise<string> {
  const nowMs = opts.nowMs ?? Date.now();
  const { data: existing } = await db.from("ai_grants").select("id").eq("client_id", client.id).is("revoked_at", null).limit(1).maybeSingle();
  let grantId = (existing as { id: string } | null)?.id ?? null;
  if (!grantId) {
    const { data, error } = await db.from("ai_grants").insert({ client_id: client.id, name: client.name }).select("id").single();
    if (error) throw new Error(error.message);
    grantId = (data as { id: string }).id;
  }
  const code = newToken("code");
  const { error } = await db.from("ai_tokens").insert({
    hash: code.hash,
    grant_id: grantId,
    kind: "code",
    expires_at: new Date(nowMs + CODE_TTL_MS).toISOString(),
    redirect_uri: opts.redirectUri,
    challenge: opts.challenge,
  });
  if (error) throw new Error(error.message);
  return code.token;
}

export type TokenError = { error: "invalid_grant" | "invalid_client" | "invalid_request"; description: string };
export type TokenSet = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

type TokenRow = { hash: string; grant_id: string; kind: string; expires_at: string | null; used_at: string | null; redirect_uri: string | null; challenge: string | null };
type GrantRow = { id: string; client_id: string | null; revoked_at: string | null };

async function issue(db: Db, grantId: string, nowMs: number): Promise<TokenSet> {
  const access = newToken("access");
  const refresh = newToken("refresh");
  const { error } = await db.from("ai_tokens").insert([
    { hash: access.hash, grant_id: grantId, kind: "access", expires_at: new Date(nowMs + ACCESS_TTL_MS).toISOString() },
    { hash: refresh.hash, grant_id: grantId, kind: "refresh", expires_at: new Date(nowMs + REFRESH_TTL_MS).toISOString() },
  ]);
  if (error) throw new Error(error.message);
  await db.from("ai_grants").update({ last_used_at: new Date(nowMs).toISOString() }).eq("id", grantId);
  return { access_token: access.token, token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL_MS / 1000), refresh_token: refresh.token, scope: SCOPE };
}

async function grantFor(db: Db, grantId: string): Promise<GrantRow | null> {
  const { data } = await db.from("ai_grants").select("id, client_id, revoked_at").eq("id", grantId).maybeSingle();
  return (data as GrantRow | null) ?? null;
}

// authorization_code: the code, once, by the app it was made for, back to
// the same address, with the PKCE verifier.
export async function tradeCode(db: Db, client: AiClient, opts: { code: string; redirectUri: string | null; verifier: string; nowMs?: number }): Promise<TokenSet | TokenError> {
  const nowMs = opts.nowMs ?? Date.now();
  if (tokenKindOf(opts.code) !== "code") return { error: "invalid_grant", description: "That isn't a code from this server." };
  const hash = hashToken(opts.code);
  const { data } = await db.from("ai_tokens").select("hash, grant_id, kind, expires_at, used_at, redirect_uri, challenge").eq("hash", hash).eq("kind", "code").maybeSingle();
  const row = data as TokenRow | null;
  if (!row) return { error: "invalid_grant", description: "That code isn't recognized." };
  const grant = await grantFor(db, row.grant_id);
  if (!grant || grant.revoked_at || grant.client_id !== client.id) return { error: "invalid_grant", description: "That code wasn't made for this app." };
  if (row.used_at) return { error: "invalid_grant", description: "That code was already used. Connect again." };
  if (!row.expires_at || Date.parse(row.expires_at) < nowMs) return { error: "invalid_grant", description: "That code ran out (codes last 10 minutes). Connect again." };
  if (opts.redirectUri && opts.redirectUri !== row.redirect_uri) return { error: "invalid_grant", description: "redirect_uri doesn't match the one the code was made for." };
  if (!row.challenge || !verifierMatches(opts.verifier, row.challenge)) return { error: "invalid_grant", description: "The PKCE code_verifier doesn't match." };
  const { data: claimed } = await db.from("ai_tokens").update({ used_at: new Date(nowMs).toISOString() }).eq("hash", hash).is("used_at", null).select("hash");
  if (!claimed?.length) return { error: "invalid_grant", description: "That code was already used." };
  return issue(db, grant.id, nowMs);
}

// refresh_token: a new pair for the old refresh token (which stops working
// two minutes later), as long as the approval stands.
export async function tradeRefresh(db: Db, client: AiClient, opts: { refreshToken: string; nowMs?: number }): Promise<TokenSet | TokenError> {
  const nowMs = opts.nowMs ?? Date.now();
  if (tokenKindOf(opts.refreshToken) !== "refresh") return { error: "invalid_grant", description: "That isn't a refresh token from this server." };
  const hash = hashToken(opts.refreshToken);
  const { data } = await db.from("ai_tokens").select("hash, grant_id, kind, expires_at, used_at").eq("hash", hash).eq("kind", "refresh").maybeSingle();
  const row = data as TokenRow | null;
  if (!row) return { error: "invalid_grant", description: "That refresh token isn't recognized. Connect again." };
  const grant = await grantFor(db, row.grant_id);
  if (!grant || grant.revoked_at || grant.client_id !== client.id) return { error: "invalid_grant", description: "That connection was disconnected. Connect again." };
  if (!row.expires_at || Date.parse(row.expires_at) < nowMs) return { error: "invalid_grant", description: "The connection ran out after 90 days unused. Connect again." };
  if (row.used_at && nowMs - Date.parse(row.used_at) > REFRESH_GRACE_MS) return { error: "invalid_grant", description: "That refresh token was already used. Connect again." };
  if (!row.used_at) await db.from("ai_tokens").update({ used_at: new Date(nowMs).toISOString() }).eq("hash", hash).is("used_at", null);
  return issue(db, grant.id, nowMs);
}

// Who's calling /api/mcp: an access token or a key whose approval stands.
const lastTouched = new Map<string, number>();

export async function bearerGrant(db: Db, token: string, nowMs = Date.now()): Promise<{ grantId: string; name: string } | null> {
  const kind = tokenKindOf(token);
  if (kind !== "access" && kind !== "key") return null;
  const { data } = await db.from("ai_tokens").select("grant_id, kind, expires_at").eq("hash", hashToken(token)).eq("kind", kind).maybeSingle();
  const row = data as Pick<TokenRow, "grant_id" | "kind" | "expires_at"> | null;
  if (!row) return null;
  if (row.expires_at && Date.parse(row.expires_at) < nowMs) return null;
  const { data: g } = await db.from("ai_grants").select("id, name, revoked_at").eq("id", row.grant_id).maybeSingle();
  const grant = g as { id: string; name: string; revoked_at: string | null } | null;
  if (!grant || grant.revoked_at) return null;
  if ((lastTouched.get(grant.id) ?? 0) < nowMs - 60_000) {
    lastTouched.set(grant.id, nowMs);
    await db.from("ai_grants").update({ last_used_at: new Date(nowMs).toISOString() }).eq("id", grant.id);
  }
  return { grantId: grant.id, name: grant.name };
}

// RFC 7009: the app forgetting a token. Unknown tokens are fine too.
export async function revokeToken(db: Db, token: string) {
  const kind = tokenKindOf(token);
  if (kind !== "access" && kind !== "refresh") return;
  await db.from("ai_tokens").delete().eq("hash", hashToken(token)).eq("kind", kind);
}

// ---------- the Connections page ----------

export type GrantSummary = { id: string; name: string; kind: "app" | "key"; created_at: string; last_used_at: string | null };

export async function listGrants(db: Db): Promise<GrantSummary[]> {
  const { data, error } = await db.from("ai_grants").select("id, client_id, name, created_at, last_used_at").is("revoked_at", null).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as (GrantSummary & { client_id: string | null })[]).map(({ client_id, ...g }) => ({ ...g, kind: client_id ? "app" : "key" }));
}

export async function revokeGrant(db: Db, grantId: string) {
  await db.from("ai_grants").update({ revoked_at: new Date().toISOString() }).eq("id", grantId);
  await db.from("ai_tokens").delete().eq("grant_id", grantId);
}

// A key for apps that take one in a header instead of signing in (Claude
// Code, the xAI API's remote tools, scripts). Shown once.
export async function makeKey(db: Db, name: string): Promise<string> {
  const { data, error } = await db.from("ai_grants").insert({ client_id: null, name: name.trim().slice(0, 120) || "Key" }).select("id").single();
  if (error) throw new Error(error.message);
  const key = newToken("key");
  const { error: keyError } = await db.from("ai_tokens").insert({ hash: key.hash, grant_id: (data as { id: string }).id, kind: "key", expires_at: null });
  if (keyError) throw new Error(keyError.message);
  return key.token;
}

// Housekeeping on each registration: tokens long past their time, and apps
// that registered a day ago and were never approved.
async function forgetStale(db: Db, nowMs: number) {
  const dayAgo = new Date(nowMs - 24 * 3600_000).toISOString();
  await db.from("ai_tokens").delete().neq("kind", "key").lt("expires_at", dayAgo);
  const { data } = await db.from("ai_clients").select("id, grants:ai_grants(id)").lt("created_at", dayAgo).limit(200);
  const unused = ((data ?? []) as { id: string; grants: { id: string }[] | null }[]).filter((c) => !c.grants?.length).map((c) => c.id);
  if (unused.length) await db.from("ai_clients").delete().in("id", unused);
}
