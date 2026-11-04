// Reddit: an OAuth "web app" (permanent, so it comes with a refresh token;
// access tokens last an hour). A text post, or a picture post through
// Reddit's media upload. Each post needs a subreddit and a title (your own
// profile, u_name, when no subreddit is given). Numbers: score and comments.
import { bodyAfterTitle, redditSettings } from "../target-settings";
import type { AccountWithTokens, Metrics } from "../types";
import { basicAuth, blobOf, callJson, count, expiresAt, formBody, images, NetworkError, sleep, video, type NetworkModule, type Outgoing, type Step, type TokenChange } from "./common";
import type { AccountDraft } from "./drafts";

const OAUTH = "https://oauth.reddit.com";
export const REDDIT_SCOPES = "identity submit read";

type Creds = { id: string; secret: string };
type TokenAnswer = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };

// Reddit asks every app to name itself: platform:app:version (by /u/name).
export function userAgent(username?: string | null, env: Record<string, string | undefined> = process.env) {
  return env.REDDIT_USER_AGENT?.trim() || `web:post-planner:1.0${username ? ` (by /u/${username})` : ""}`;
}

export function redditAuthorizeUrl(clientId: string, redirect: string, state: string) {
  const u = new URL("https://www.reddit.com/api/v1/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("duration", "permanent");
  u.searchParams.set("scope", REDDIT_SCOPES);
  return u.toString();
}

async function token(creds: Creds, values: Record<string, string>): Promise<TokenAnswer> {
  const { body } = await callJson<TokenAnswer>(
    "Reddit",
    "https://www.reddit.com/api/v1/access_token",
    { method: "POST", headers: { Authorization: basicAuth(creds.id, creds.secret), "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent() }, body: formBody(values) },
    (status) => status === 400 || status === 401
  );
  if (body.error || !body.access_token) throw new NetworkError(`Reddit didn't accept the sign-in: ${body.error ?? "no token"}.`, { reconnect: true });
  return body;
}

export async function redditFinishConnect(creds: Creds, code: string, redirect: string): Promise<AccountDraft[]> {
  const t = await token(creds, { grant_type: "authorization_code", code, redirect_uri: redirect });
  const { body: me } = await callJson<{ id: string; name: string; icon_img?: string }>("Reddit", `${OAUTH}/api/v1/me`, {
    headers: { Authorization: `Bearer ${t.access_token}`, "User-Agent": userAgent() },
  });
  return [
    {
      platform: "reddit",
      external_id: me.id,
      name: `u/${me.name}`,
      handle: `u/${me.name}`,
      avatar_url: me.icon_img ? me.icon_img.split("?")[0] : null,
      access_token: t.access_token!,
      refresh_token: t.refresh_token ?? null,
      expires_at: expiresAt(t.expires_in),
      extra: { username: me.name },
    },
  ];
}

export async function redditRefresh(creds: Creds, refreshToken: string): Promise<TokenChange> {
  const t = await token(creds, { grant_type: "refresh_token", refresh_token: refreshToken });
  return { access_token: t.access_token!, refresh_token: t.refresh_token ?? refreshToken, expires_at: expiresAt(t.expires_in) };
}

function usernameOf(account: AccountWithTokens) {
  return typeof account.extra.username === "string" ? account.extra.username : null;
}

function headers(account: AccountWithTokens): Record<string, string> {
  return { Authorization: `Bearer ${account.access_token ?? ""}`, "User-Agent": userAgent(usernameOf(account)) };
}

// A picture for an image post goes to Reddit's own storage first.
async function uploadImage(account: AccountWithTokens, bytes: Uint8Array, mime: string): Promise<string> {
  const { body } = await callJson<{ args?: { action?: string; fields?: { name: string; value: string }[] } }>("Reddit (picture upload)", `${OAUTH}/api/media/asset.json`, {
    method: "POST",
    headers: { ...headers(account), "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ filepath: mime === "image/png" ? "picture.png" : "picture.jpg", mimetype: mime }),
  });
  const action = body.args?.action;
  const fields = body.args?.fields ?? [];
  if (!action) throw new NetworkError("Reddit didn't give a place to upload the picture.");
  const target = action.startsWith("//") ? `https:${action}` : action;
  const form = new FormData();
  for (const f of fields) form.set(f.name, f.value);
  form.set("file", blobOf(bytes, mime), "picture.jpg");
  const res = await fetch(target, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new NetworkError(`Reddit didn't take the picture (${res.status}).`);
  const key = fields.find((f) => f.name === "key")?.value;
  if (!key) throw new NetworkError("Reddit took the picture but didn't say where it is.");
  return `${target}/${key}`;
}

type SubmitAnswer = { json?: { errors?: [string, string, string?][]; data?: { id?: string; name?: string; url?: string } } };

// An image post's answer has no id; it's found among your newest posts.
async function findNewest(account: AccountWithTokens, title: string): Promise<{ id: string; url: string } | null> {
  const username = usernameOf(account);
  if (!username) return null;
  for (let i = 0; i < 4; i++) {
    const { body } = await callJson<{ data?: { children?: { data: { id: string; title: string; permalink: string; created_utc: number } }[] } }>(
      "Reddit",
      `${OAUTH}/user/${encodeURIComponent(username)}/submitted?limit=5&sort=new&raw_json=1`,
      { headers: headers(account) }
    );
    const hit = body.data?.children?.map((c) => c.data).find((p) => p.title === title && Date.now() / 1000 - p.created_utc < 600);
    if (hit) return { id: hit.id, url: `https://www.reddit.com${hit.permalink}` };
    await sleep(2000);
  }
  return null;
}

async function publish(out: Outgoing): Promise<Step> {
  if (video(out)) throw new NetworkError("Videos can't be sent to Reddit from Post Planner yet.");
  const s = redditSettings(out.settings, out.text, usernameOf(out.account));
  if (!s.subreddit) throw new NetworkError("Pick a subreddit for Reddit (or u/yourname for your profile).");
  if (!s.title) throw new NetworkError("Reddit posts need a title.");
  const picture = images(out)[0];
  const values: Record<string, string | boolean> = { sr: s.subreddit, title: s.title, api_type: "json", resubmit: true, sendreplies: true, nsfw: s.nsfw, spoiler: s.spoiler };
  if (picture) {
    values.kind = "image";
    values.url = await uploadImage(out.account, await picture.bytes(), picture.item.mime);
  } else {
    values.kind = "self";
    values.text = bodyAfterTitle(out.text, s.title);
  }
  const { body } = await callJson<SubmitAnswer>("Reddit", `${OAUTH}/api/submit`, {
    method: "POST",
    headers: { ...headers(out.account), "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody(values),
  });
  const errors = body.json?.errors ?? [];
  if (errors.length) throw new NetworkError(`Reddit said no: ${errors.map((e) => e[1] || e[0]).join("; ")}`);
  const data = body.json?.data;
  if (data?.id) return { done: true, id: data.id, url: data.url ?? `https://www.reddit.com/comments/${data.id}` };
  const found = await findNewest(out.account, s.title);
  if (found) return { done: true, id: found.id, url: found.url };
  return { done: true, id: `pending:${Date.now()}`, url: null, note: "Reddit took it but didn't say its link yet; look on your Reddit profile." };
}

async function metrics(account: AccountWithTokens, id: string): Promise<Metrics | null> {
  if (id.startsWith("pending:")) return null;
  const { body } = await callJson<{ data?: { children?: { data: { score?: number; num_comments?: number; view_count?: number | null } }[] } }>(
    "Reddit",
    `${OAUTH}/api/info?id=t3_${encodeURIComponent(id)}&raw_json=1`,
    { headers: headers(account) }
  );
  const p = body.data?.children?.[0]?.data;
  return p ? { likes: count(p.score), comments: count(p.num_comments), views: count(p.view_count) } : null;
}

async function followers(account: AccountWithTokens): Promise<number | null> {
  const { body } = await callJson<{ subreddit?: { subscribers?: number } }>("Reddit", `${OAUTH}/api/v1/me`, { headers: headers(account) });
  return count(body.subreddit?.subscribers);
}

export const reddit: NetworkModule = { publish, metrics, followers };
