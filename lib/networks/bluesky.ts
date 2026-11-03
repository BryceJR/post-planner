// Bluesky: a handle and an app password (Settings → Privacy and security →
// App passwords), no developer app needed. Each post signs in afresh with
// the app password, on the account's own server. Numbers come from
// Bluesky's public API.
import { blueskyFacets } from "../text";
import type { AccountWithTokens, Metrics } from "../types";
import { callJson, count, images, NetworkError, type NetworkModule, type Outgoing, type Step } from "./common";
import type { AccountDraft } from "./drafts";

const ENTRYWAY = "https://bsky.social";
const PUBLIC = "https://public.api.bsky.app";

type Session = { did: string; handle: string; accessJwt: string; didDoc?: { service?: { id?: string; type?: string; serviceEndpoint?: string }[] } };

// "@name.bsky.social", "name.bsky.social" or a full did: what createSession takes.
export function cleanHandle(raw: string) {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

// App passwords look like xxxx-xxxx-xxxx-xxxx; a real password would work
// too, and must not be kept, so only the app-password shape is taken.
export function looksLikeAppPassword(raw: string) {
  return /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(raw.trim());
}

function serviceOf(session: Session, fallback: string) {
  const pds = session.didDoc?.service?.find((s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer")?.serviceEndpoint;
  return pds && /^https:\/\//.test(pds) ? pds.replace(/\/$/, "") : fallback;
}

async function signIn(service: string, identifier: string, password: string): Promise<{ session: Session; service: string }> {
  const { body } = await callJson<Session>(
    "Bluesky",
    `${service}/xrpc/com.atproto.server.createSession`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password }) },
    (status) => status === 401
  );
  return { session: body, service: serviceOf(body, service) };
}

export async function blueskyConnect(handle: string, appPassword: string): Promise<AccountDraft> {
  const { session, service } = await signIn(ENTRYWAY, cleanHandle(handle), appPassword.trim());
  let name = session.handle;
  let avatar: string | null = null;
  try {
    const { body } = await callJson<{ displayName?: string; avatar?: string }>("Bluesky", `${service}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(session.did)}`, {
      headers: { Authorization: `Bearer ${session.accessJwt}` },
    });
    name = body.displayName?.trim() || session.handle;
    avatar = body.avatar ?? null;
  } catch {
    // the profile is a nicety
  }
  return { platform: "bluesky", external_id: session.did, name, handle: `@${session.handle}`, avatar_url: avatar, access_token: appPassword.trim(), refresh_token: null, expires_at: null, extra: { service, handle: session.handle } };
}

async function publish(out: Outgoing): Promise<Step> {
  const service = typeof out.account.extra.service === "string" ? out.account.extra.service : ENTRYWAY;
  const password = out.account.access_token ?? "";
  if (!password) throw new NetworkError("Bluesky's app password is missing. Connect Bluesky again.", { reconnect: true });
  const { session, service: pds } = await signIn(service, out.account.external_id, password);
  const auth = { Authorization: `Bearer ${session.accessJwt}` };

  const embedded: Record<string, unknown>[] = [];
  for (const picture of images(out)) {
    const bytes = await picture.bytes();
    if (bytes.byteLength > 1_000_000) throw new NetworkError("Bluesky takes pictures up to 1 MB; this one is bigger. Upload it again so Post Planner can shrink it.");
    const { body } = await callJson<{ blob?: unknown }>("Bluesky (picture upload)", `${pds}/xrpc/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: { ...auth, "Content-Type": picture.item.mime },
      body: bytes as BodyInit,
    });
    if (!body.blob) throw new NetworkError("Bluesky took the picture but didn't say where it is.");
    embedded.push({
      alt: picture.item.alt ?? "",
      image: body.blob,
      ...(picture.item.width && picture.item.height ? { aspectRatio: { width: picture.item.width, height: picture.item.height } } : {}),
    });
  }
  const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text: out.text, createdAt: new Date().toISOString(), langs: ["en"] };
  const facets = blueskyFacets(out.text);
  if (facets.length) record.facets = facets;
  if (embedded.length) record.embed = { $type: "app.bsky.embed.images", images: embedded };
  const { body } = await callJson<{ uri?: string }>("Bluesky", `${pds}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
  });
  if (!body.uri) throw new NetworkError("Bluesky didn't say the post's id; check the account before trying again.");
  const rkey = body.uri.split("/").pop();
  return { done: true, id: body.uri, url: rkey ? `https://bsky.app/profile/${session.handle}/post/${rkey}` : null };
}

function publicBase(account: AccountWithTokens) {
  // a test or self-hosted server answers for itself; Bluesky's own accounts use the public API
  const service = typeof account.extra.service === "string" ? account.extra.service : ENTRYWAY;
  return service === ENTRYWAY || service.endsWith(".host.bsky.network") ? PUBLIC : service;
}

async function metrics(account: AccountWithTokens, uri: string): Promise<Metrics | null> {
  const { body } = await callJson<{ posts?: { likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number }[] }>(
    "Bluesky",
    `${publicBase(account)}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`,
    {}
  );
  const p = body.posts?.[0];
  return p ? { likes: count(p.likeCount), comments: count(p.replyCount), shares: (count(p.repostCount) ?? 0) + (count(p.quoteCount) ?? 0) } : null;
}

async function followers(account: AccountWithTokens): Promise<number | null> {
  const { body } = await callJson<{ followersCount?: number }>("Bluesky", `${publicBase(account)}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(account.external_id)}`, {});
  return count(body.followersCount);
}

export const bluesky: NetworkModule = { publish, metrics, followers };
