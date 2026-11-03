// TikTok: Login Kit sign-in (tokens last a day, refresh tokens a year), the
// Content Posting API's Direct Post (the video uploaded in one piece, then
// TikTok processes it: the run checks back), numbers from video.list.
// Until TikTok audits the app, it may only post to a private account,
// visible only to its owner; TikTok's own error says so.
import { tiktokSettings } from "../target-settings";
import type { AccountWithTokens, Metrics } from "../types";
import { callJson, count, expiresAt, formBody, NetworkError, video, type NetworkModule, type Outgoing, type Step, type TokenChange } from "./common";
import type { AccountDraft } from "./drafts";

const API = "https://open.tiktokapis.com/v2";
export const TIKTOK_SCOPES = "user.info.basic,user.info.stats,video.list,video.publish";

type Creds = { id: string; secret: string };
type TokenAnswer = { access_token?: string; refresh_token?: string; expires_in?: number; open_id?: string; error?: string; error_description?: string };
type Answer<T> = { data?: T; error?: { code?: string; message?: string } };

export function tiktokAuthorizeUrl(clientKey: string, redirect: string, state: string) {
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.searchParams.set("client_key", clientKey);
  u.searchParams.set("scope", TIKTOK_SCOPES);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("state", state);
  return u.toString();
}

async function token(creds: Creds, values: Record<string, string>): Promise<TokenAnswer> {
  const { body } = await callJson<TokenAnswer>(
    "TikTok",
    `${API}/oauth/token/`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ client_key: creds.id, client_secret: creds.secret, ...values }) },
    (status) => status === 400 || status === 401
  );
  if (body.error || !body.access_token) throw new NetworkError(`TikTok didn't accept the sign-in: ${body.error_description || body.error || "no token"}.`, { reconnect: true });
  return body;
}

const SIGNED_OUT = new Set(["access_token_invalid", "scope_not_authorized", "token_not_authorized_for_specified_open_id"]);

// TikTok answers 200 with an error inside; anything but "ok" is a refusal.
async function call<T>(network: string, url: string, token: string, payload?: unknown): Promise<T> {
  const { body } = await callJson<Answer<T>>(
    network,
    url,
    {
      method: payload === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { "Content-Type": "application/json; charset=UTF-8" }) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    },
    (status, b) => status === 401 || SIGNED_OUT.has((b as Answer<T> | null)?.error?.code ?? "")
  );
  const code = body.error?.code;
  if (code && code !== "ok") {
    const hint = code === "unaudited_client_can_only_post_to_private_accounts" ? " Until TikTok audits the app, make the TikTok account private and pick Only me." : "";
    throw new NetworkError(`${network} said no: ${body.error?.message || code}.${hint}`, { reconnect: SIGNED_OUT.has(code) });
  }
  return body.data as T;
}

type User = { open_id?: string; display_name?: string; avatar_url?: string; username?: string; follower_count?: number };

export async function tiktokFinishConnect(creds: Creds, code: string, redirect: string): Promise<AccountDraft[]> {
  const t = await token(creds, { code, grant_type: "authorization_code", redirect_uri: redirect });
  const data = await call<{ user?: User }>("TikTok", `${API}/user/info/?fields=open_id,display_name,avatar_url`, t.access_token!);
  const user = data?.user;
  const openId = user?.open_id ?? t.open_id;
  if (!openId) throw new NetworkError("TikTok didn't say which account signed in.");
  return [
    {
      platform: "tiktok",
      external_id: openId,
      name: user?.display_name || "TikTok account",
      handle: null,
      avatar_url: user?.avatar_url ?? null,
      access_token: t.access_token!,
      refresh_token: t.refresh_token ?? null,
      expires_at: expiresAt(t.expires_in),
      extra: {},
    },
  ];
}

export async function tiktokRefresh(creds: Creds, refreshToken: string): Promise<TokenChange> {
  const t = await token(creds, { grant_type: "refresh_token", refresh_token: refreshToken });
  return { access_token: t.access_token!, refresh_token: t.refresh_token ?? refreshToken, expires_at: expiresAt(t.expires_in) };
}

type Status = { status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] };

async function status(account: AccountWithTokens, publishId: string): Promise<Step> {
  const s = await call<Status>("TikTok", `${API}/post/publish/status/fetch/`, account.access_token ?? "", { publish_id: publishId });
  if (s?.status === "FAILED") throw new NetworkError(`TikTok couldn't post the video${s.fail_reason ? `: ${s.fail_reason}` : "."}`);
  if (s?.status === "PUBLISH_COMPLETE") {
    const postId = s.publicaly_available_post_id?.[0];
    return postId
      ? { done: true, id: String(postId), url: null }
      : { done: true, id: publishId, url: null, note: "It's on TikTok but not public (only you can see it), so there's no link." };
  }
  return { done: false, progress: { publishId }, checkInSeconds: 20 };
}

async function publish(out: Outgoing): Promise<Step> {
  const token = out.account.access_token ?? "";
  const waiting = typeof out.progress.publishId === "string" ? out.progress.publishId : null;
  if (waiting) return status(out.account, waiting);
  const clip = video(out);
  if (!clip) throw new NetworkError("TikTok posts are videos. Add one.");
  const s = tiktokSettings(out.settings);
  const creator = await call<{ privacy_level_options?: string[]; max_video_post_duration_sec?: number }>("TikTok", `${API}/post/publish/creator_info/query/`, token, {});
  const allowed = creator?.privacy_level_options ?? [];
  if (allowed.length && !allowed.includes(s.privacy)) {
    throw new NetworkError(`TikTok won't take "${s.privacy}" for this account; it allows ${allowed.join(", ")}. Pick one of those.`);
  }
  if (clip.item.duration && creator?.max_video_post_duration_sec && clip.item.duration > creator.max_video_post_duration_sec) {
    throw new NetworkError(`This TikTok account takes videos up to ${creator.max_video_post_duration_sec} seconds.`);
  }
  const bytes = await clip.bytes();
  const init = await call<{ publish_id?: string; upload_url?: string }>("TikTok", `${API}/post/publish/video/init/`, token, {
    post_info: { title: out.text.slice(0, 2200), privacy_level: s.privacy, disable_comment: !s.allowComments, disable_duet: !s.allowDuet, disable_stitch: !s.allowStitch },
    source_info: { source: "FILE_UPLOAD", video_size: bytes.byteLength, chunk_size: bytes.byteLength, total_chunk_count: 1 },
  });
  if (!init?.publish_id || !init.upload_url) throw new NetworkError("TikTok didn't start the upload.");
  const put = await fetch(init.upload_url, {
    method: "PUT",
    headers: { "Content-Type": clip.item.mime, "Content-Length": String(bytes.byteLength), "Content-Range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}` },
    body: bytes as BodyInit,
    signal: AbortSignal.timeout(240_000),
  });
  if (!put.ok) throw new NetworkError(`TikTok didn't take the video (${put.status}).`);
  return status(out.account, init.publish_id);
}

async function metrics(account: AccountWithTokens, id: string): Promise<Metrics | null> {
  if (!/^\d+$/.test(id)) return null; // a private post has no video id to ask about
  const data = await call<{ videos?: Record<string, unknown>[] }>("TikTok", `${API}/video/query/?fields=id,view_count,like_count,comment_count,share_count`, account.access_token ?? "", {
    filters: { video_ids: [id] },
  });
  const v = data?.videos?.[0];
  return v ? { views: count(v.view_count), likes: count(v.like_count), comments: count(v.comment_count), shares: count(v.share_count) } : null;
}

async function followers(account: AccountWithTokens): Promise<number | null> {
  const data = await call<{ user?: User }>("TikTok", `${API}/user/info/?fields=follower_count`, account.access_token ?? "");
  return count(data?.user?.follower_count);
}

export const tiktok: NetworkModule = { publish, metrics, followers };
