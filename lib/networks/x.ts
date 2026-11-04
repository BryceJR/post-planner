// X (Twitter): OAuth 2.0 with PKCE, posts and numbers through the v2 API.
// Tokens last two hours and come with a refresh token (offline.access),
// which X replaces at every refresh. A video is uploaded in parts, and X
// processes it before it can be posted (the run checks back).
import type { AccountWithTokens, Metrics } from "../types";
import { basicAuth, blobOf, callJson, count, expiresAt, formBody, images, NetworkError, video, type NetworkModule, type Outgoing, type Step, type TokenChange } from "./common";
import type { AccountDraft } from "./drafts";

const AUTHORIZE = "https://x.com/i/oauth2/authorize";
const TOKEN = "https://api.x.com/2/oauth2/token";
const API = "https://api.x.com/2";
export const X_SCOPES = "tweet.read tweet.write users.read media.write offline.access";
const CHUNK = 4 * 1024 * 1024;

type Creds = { id: string; secret: string };
type TokenAnswer = { access_token: string; refresh_token?: string; expires_in?: number };

export function xAuthorizeUrl(clientId: string, redirect: string, state: string, challenge: string) {
  const u = new URL(AUTHORIZE);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("scope", X_SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function token(creds: Creds, values: Record<string, string>): Promise<TokenAnswer> {
  const { body } = await callJson<TokenAnswer>(
    "X",
    TOKEN,
    { method: "POST", headers: { Authorization: basicAuth(creds.id, creds.secret), "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ ...values, client_id: creds.id }) },
    (status) => status === 400 || status === 401
  );
  return body;
}

export async function xFinishConnect(creds: Creds, code: string, redirect: string, verifier: string): Promise<AccountDraft[]> {
  const t = await token(creds, { grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: verifier });
  const { body } = await callJson<{ data?: { id: string; name: string; username: string; profile_image_url?: string } }>("X", `${API}/users/me?user.fields=profile_image_url`, {
    headers: { Authorization: `Bearer ${t.access_token}` },
  });
  const me = body.data;
  if (!me) throw new NetworkError("X didn't say which account signed in.");
  return [
    {
      platform: "x",
      external_id: me.id,
      name: me.name || `@${me.username}`,
      handle: `@${me.username}`,
      avatar_url: me.profile_image_url ?? null,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? null,
      expires_at: expiresAt(t.expires_in),
      extra: { username: me.username },
    },
  ];
}

export async function xRefresh(creds: Creds, refreshToken: string): Promise<TokenChange> {
  const t = await token(creds, { grant_type: "refresh_token", refresh_token: refreshToken });
  return { access_token: t.access_token, refresh_token: t.refresh_token ?? refreshToken, expires_at: expiresAt(t.expires_in) };
}

function auth(account: AccountWithTokens) {
  return { Authorization: `Bearer ${account.access_token ?? ""}` };
}

function postUrl(account: AccountWithTokens, id: string) {
  const username = typeof account.extra.username === "string" ? account.extra.username : (account.handle ?? "").replace(/^@/, "");
  return username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`;
}

async function tweet(out: Outgoing, mediaIds: string[]): Promise<Step> {
  const payload: Record<string, unknown> = { text: out.text };
  if (mediaIds.length) payload.media = { media_ids: mediaIds };
  const { body } = await callJson<{ data?: { id?: string } }>("X", `${API}/tweets`, {
    method: "POST",
    headers: { ...auth(out.account), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const id = body.data?.id;
  if (!id) throw new NetworkError("X didn't say the post's id; check the account before trying again.");
  return { done: true, id, url: postUrl(out.account, id) };
}

type Processing = { state?: string; check_after_secs?: number; error?: { message?: string } };

// Where X is with a video it's processing: ready, failed, or check back.
async function videoState(account: AccountWithTokens, mediaId: string): Promise<Processing | null> {
  const { body } = await callJson<{ data?: { processing_info?: Processing } }>("X (video)", `${API}/media/upload?command=STATUS&media_id=${encodeURIComponent(mediaId)}`, { headers: auth(account) });
  return body.data?.processing_info ?? null;
}

function afterProcessing(info: Processing | null | undefined, mediaId: string): Step | "ready" {
  if (!info || info.state === "succeeded") return "ready";
  if (info.state === "failed") throw new NetworkError(`X couldn't process the video${info.error?.message ? `: ${info.error.message}` : "."}`);
  return { done: false, progress: { mediaId }, checkInSeconds: Math.max(5, Math.min(120, info.check_after_secs ?? 15)) };
}

async function uploadVideo(out: Outgoing): Promise<Step | string> {
  const file = video(out)!;
  const bytes = await file.bytes();
  const { body: init } = await callJson<{ data?: { id?: string } }>("X (video upload)", `${API}/media/upload/initialize`, {
    method: "POST",
    headers: { ...auth(out.account), "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: file.item.mime === "video/quicktime" ? "video/quicktime" : "video/mp4", total_bytes: bytes.byteLength, media_category: "tweet_video" }),
  });
  const mediaId = init.data?.id;
  if (!mediaId) throw new NetworkError("X didn't start the video upload.");
  for (let i = 0, offset = 0; offset < bytes.byteLength; i++, offset += CHUNK) {
    const form = new FormData();
    form.set("media", blobOf(bytes.subarray(offset, offset + CHUNK), "application/octet-stream"), "chunk");
    form.set("segment_index", String(i));
    await callJson("X (video upload)", `${API}/media/upload/${encodeURIComponent(mediaId)}/append`, { method: "POST", headers: auth(out.account), body: form });
  }
  const { body: fin } = await callJson<{ data?: { processing_info?: Processing } }>("X (video upload)", `${API}/media/upload/${encodeURIComponent(mediaId)}/finalize`, {
    method: "POST",
    headers: auth(out.account),
  });
  const next = afterProcessing(fin.data?.processing_info, mediaId);
  return next === "ready" ? mediaId : next;
}

async function publish(out: Outgoing): Promise<Step> {
  // a video X was still processing last time
  const pending = typeof out.progress.mediaId === "string" ? out.progress.mediaId : null;
  if (pending) {
    const next = afterProcessing(await videoState(out.account, pending), pending);
    return next === "ready" ? tweet(out, [pending]) : next;
  }
  if (video(out)) {
    const uploaded = await uploadVideo(out);
    return typeof uploaded === "string" ? tweet(out, [uploaded]) : uploaded;
  }
  const mediaIds: string[] = [];
  for (const picture of images(out)) {
    const form = new FormData();
    form.set("media", blobOf(await picture.bytes(), picture.item.mime), "picture.jpg");
    form.set("media_category", "tweet_image");
    form.set("media_type", picture.item.mime);
    const { body } = await callJson<{ data?: { id?: string } }>("X (picture upload)", `${API}/media/upload`, { method: "POST", headers: auth(out.account), body: form });
    const id = body.data?.id;
    if (!id) throw new NetworkError("X took the picture but didn't say its id.");
    mediaIds.push(id);
    if (picture.item.alt) {
      // a nicety: the post still goes without its description
      await callJson("X", `${API}/media/metadata`, {
        method: "POST",
        headers: { ...auth(out.account), "Content-Type": "application/json" },
        body: JSON.stringify({ id, metadata: { alt_text: { text: picture.item.alt.slice(0, 1000) } } }),
      }).catch(() => undefined);
    }
  }
  return tweet(out, mediaIds);
}

async function metrics(account: AccountWithTokens, id: string): Promise<Metrics | null> {
  const { body } = await callJson<{ data?: { public_metrics?: Record<string, unknown> } }>("X", `${API}/tweets/${encodeURIComponent(id)}?tweet.fields=public_metrics`, { headers: auth(account) });
  const m = body.data?.public_metrics;
  if (!m) return null;
  const retweets = count(m.retweet_count) ?? 0;
  const quotes = count(m.quote_count) ?? 0;
  return { views: count(m.impression_count), likes: count(m.like_count), comments: count(m.reply_count), shares: retweets + quotes, saves: count(m.bookmark_count) };
}

async function followers(account: AccountWithTokens): Promise<number | null> {
  const { body } = await callJson<{ data?: { public_metrics?: { followers_count?: number } } }>("X", `${API}/users/me?user.fields=public_metrics`, { headers: auth(account) });
  return count(body.data?.public_metrics?.followers_count);
}

export const x: NetworkModule = { publish, metrics, followers };
