// YouTube: a Google sign-in (offline, so it comes with a refresh token),
// uploads through the YouTube Data API's resumable upload, numbers from its
// statistics. Until Google audits the app, YouTube keeps every upload from
// it private; the post's note says so when that happens.
import { bodyAfterTitle, youtubeSettings } from "../target-settings";
import type { AccountWithTokens, Metrics } from "../types";
import { callJson, count, expiresAt, formBody, NetworkError, video, type NetworkModule, type Outgoing, type Step, type TokenChange } from "./common";
import type { AccountDraft } from "./drafts";

const API = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";

type Creds = { id: string; secret: string };
type TokenAnswer = { access_token: string; refresh_token?: string; expires_in?: number };

export function youtubeAuthorizeUrl(clientId: string, redirect: string, state: string, challenge: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", YOUTUBE_SCOPES);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function token(values: Record<string, string>): Promise<TokenAnswer> {
  const { body } = await callJson<TokenAnswer>(
    "Google",
    "https://oauth2.googleapis.com/token",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody(values) },
    (status) => status === 400 || status === 401
  );
  return body;
}

export async function youtubeFinishConnect(creds: Creds, code: string, redirect: string, verifier: string): Promise<AccountDraft[]> {
  const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: creds.id, client_secret: creds.secret, code_verifier: verifier });
  const { body } = await callJson<{ items?: { id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } }[] }>(
    "YouTube",
    `${API}/channels?part=snippet&mine=true`,
    { headers: { Authorization: `Bearer ${t.access_token}` } }
  );
  const channel = body.items?.[0];
  if (!channel) throw new NetworkError("That Google account has no YouTube channel. Make one on youtube.com (or pick the account that has it), then connect again.");
  if (!t.refresh_token) throw new NetworkError("Google didn't give a lasting sign-in. Remove Post Planner at myaccount.google.com/permissions, then connect again.");
  return [
    {
      platform: "youtube",
      external_id: channel.id,
      name: channel.snippet?.title || "YouTube channel",
      handle: channel.snippet?.customUrl ?? null,
      avatar_url: channel.snippet?.thumbnails?.default?.url ?? null,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: expiresAt(t.expires_in),
      extra: {},
    },
  ];
}

export async function youtubeRefresh(creds: Creds, refreshToken: string): Promise<TokenChange> {
  const t = await token({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: creds.id, client_secret: creds.secret });
  return { access_token: t.access_token, refresh_token: t.refresh_token ?? refreshToken, expires_at: expiresAt(t.expires_in) };
}

function auth(account: AccountWithTokens) {
  return { Authorization: `Bearer ${account.access_token ?? ""}` };
}

async function publish(out: Outgoing): Promise<Step> {
  const clip = video(out);
  if (!clip) throw new NetworkError("YouTube posts are videos. Add one.");
  const s = youtubeSettings(out.settings, out.text);
  const bytes = await clip.bytes();
  const meta = {
    snippet: { title: s.title, description: bodyAfterTitle(out.text, s.title).slice(0, 5000), tags: s.tags, categoryId: "22" },
    status: { privacyStatus: s.privacy, selfDeclaredMadeForKids: s.madeForKids },
  };
  const { res } = await callJson<unknown>("YouTube", "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      ...auth(out.account),
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(bytes.byteLength),
      "X-Upload-Content-Type": clip.item.mime,
    },
    body: JSON.stringify(meta),
  });
  const session = res.headers.get("location");
  if (!session) throw new NetworkError("YouTube didn't start the upload.");
  const { body } = await callJson<{ id?: string; status?: { privacyStatus?: string; uploadStatus?: string } }>("YouTube (upload)", session, {
    method: "PUT",
    headers: { ...auth(out.account), "Content-Type": clip.item.mime, "Content-Length": String(bytes.byteLength) },
    body: bytes as BodyInit,
    signal: AbortSignal.timeout(240_000),
  });
  if (!body.id) throw new NetworkError("YouTube didn't say the video's id; check the channel before trying again.");
  const kept = body.status?.privacyStatus;
  const note =
    kept && kept !== s.privacy
      ? `YouTube kept it ${kept}: until Google audits Post Planner's app, uploads from it stay private. Change it to ${s.privacy} in YouTube Studio.`
      : null;
  return { done: true, id: body.id, url: `https://www.youtube.com/watch?v=${body.id}`, note };
}

async function metrics(account: AccountWithTokens, id: string): Promise<Metrics | null> {
  const { body } = await callJson<{ items?: { statistics?: Record<string, unknown> }[] }>("YouTube", `${API}/videos?part=statistics&id=${encodeURIComponent(id)}`, { headers: auth(account) });
  const s = body.items?.[0]?.statistics;
  return s ? { views: count(s.viewCount), likes: count(s.likeCount), comments: count(s.commentCount) } : null;
}

async function followers(account: AccountWithTokens): Promise<number | null> {
  const { body } = await callJson<{ items?: { statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }[] }>("YouTube", `${API}/channels?part=statistics&mine=true`, {
    headers: auth(account),
  });
  const s = body.items?.[0]?.statistics;
  return s && !s.hiddenSubscriberCount ? count(s.subscriberCount) : null;
}

export const youtube: NetworkModule = { publish, metrics, followers };
