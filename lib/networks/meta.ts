// Facebook Pages and Instagram (business and creator accounts linked to a
// Page), through one Facebook sign-in and the Graph API. The sign-in's token
// is traded for a long-lived one, and each Page's token from it doesn't
// expire; Instagram posts with its Page's token. Instagram makes a
// "container" for each post and needs it FINISHED before publishing: a
// picture is ready in seconds, a Reel can take minutes (the run checks back).
import type { AccountWithTokens, Metrics } from "../types";
import { callJson, count, formBody, images, NetworkError, sleep, video, type NetworkModule, type Outgoing, type Step } from "./common";
import type { AccountDraft } from "./drafts";

export function graphVersion(env: Record<string, string | undefined> = process.env) {
  const v = env.META_GRAPH_VERSION?.trim();
  return v && /^v\d+\.\d+$/.test(v) ? v : "v24.0";
}

const graph = (path: string) => `https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, "")}`;

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "read_insights",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
].join(",");

type Creds = { id: string; secret: string };

// Graph's "sign in again" answers: error code 190 (token expired or revoked)
// and the permission errors 10 and 200-299 after someone removes the app.
function signedOut(status: number, body: unknown) {
  const code = (body as { error?: { code?: number } } | null)?.error?.code;
  return code === 190 || code === 10 || (typeof code === "number" && code >= 200 && code < 300) || status === 401;
}

async function get<T>(path: string, params: Record<string, string>) {
  const u = new URL(graph(path));
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return (await callJson<T>("Facebook", u.toString(), {}, signedOut)).body;
}

async function post<T>(network: string, path: string, values: Record<string, string | number | boolean | null | undefined>) {
  return (await callJson<T>(network, graph(path), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody(values) }, signedOut)).body;
}

export function metaAuthorizeUrl(appId: string, redirect: string, state: string) {
  const u = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", META_SCOPES);
  return u.toString();
}

type PageRow = {
  id: string;
  name: string;
  access_token?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
};

export async function metaFinishConnect(creds: Creds, code: string, redirect: string): Promise<AccountDraft[]> {
  const short = await get<{ access_token: string }>("oauth/access_token", { client_id: creds.id, client_secret: creds.secret, redirect_uri: redirect, code });
  const long = await get<{ access_token: string }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: creds.id,
    client_secret: creds.secret,
    fb_exchange_token: short.access_token,
  });
  const pages = await get<{ data?: PageRow[] }>("me/accounts", {
    fields: "id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
    limit: "100",
    access_token: long.access_token,
  });
  const drafts: AccountDraft[] = [];
  for (const page of pages.data ?? []) {
    if (!page.access_token) continue;
    drafts.push({ platform: "facebook", external_id: page.id, name: page.name, handle: null, avatar_url: page.picture?.data?.url ?? null, access_token: page.access_token, refresh_token: null, expires_at: null, extra: {} });
    const ig = page.instagram_business_account;
    if (ig?.id) {
      drafts.push({
        platform: "instagram",
        external_id: ig.id,
        name: ig.name || ig.username || page.name,
        handle: ig.username ? `@${ig.username}` : null,
        avatar_url: ig.profile_picture_url ?? null,
        access_token: page.access_token,
        refresh_token: null,
        expires_at: null,
        extra: { page_id: page.id, username: ig.username ?? null },
      });
    }
  }
  if (!drafts.length) {
    throw new NetworkError("That Facebook sign-in doesn't manage any Pages Post Planner can post to. Sign in again and tick your Page (and its Instagram account) when Facebook asks which ones.");
  }
  return drafts;
}

// ---------- Facebook ----------

async function facebookPublish(out: Outgoing): Promise<Step> {
  const token = out.account.access_token ?? "";
  const pageId = out.account.external_id;
  const message = out.text || undefined;
  const clip = video(out);
  const pics = images(out);
  let postId: string | undefined;
  if (clip) {
    const r = await post<{ id: string }>("Facebook", `${pageId}/videos`, { file_url: clip.item.url, description: message, access_token: token });
    if (!r.id) throw new NetworkError("Facebook didn't say the video's id; check the Page before trying again.");
    return { done: true, id: r.id, url: `https://www.facebook.com/${pageId}/videos/${r.id}` };
  }
  if (pics.length === 1) {
    const r = await post<{ id: string; post_id?: string }>("Facebook", `${pageId}/photos`, { url: pics[0].item.url, caption: message, access_token: token });
    postId = r.post_id ?? r.id;
  } else if (pics.length > 1) {
    const ids: string[] = [];
    for (const p of pics) ids.push((await post<{ id: string }>("Facebook (picture upload)", `${pageId}/photos`, { url: p.item.url, published: false, access_token: token })).id);
    postId = (await post<{ id: string }>("Facebook", `${pageId}/feed`, { message, attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))), access_token: token })).id;
  } else {
    postId = (await post<{ id: string }>("Facebook", `${pageId}/feed`, { message, access_token: token })).id;
  }
  if (!postId) throw new NetworkError("Facebook didn't say the post's id; check the Page before trying again.");
  return { done: true, id: postId, url: `https://www.facebook.com/${postId}` };
}

async function facebookMetrics(account: AccountWithTokens, id: string): Promise<Metrics | null> {
  const token = account.access_token ?? "";
  const m: Metrics = {};
  try {
    const r = await get<{ reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number } }>(id, {
      fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares",
      access_token: token,
    });
    m.likes = count(r.reactions?.summary?.total_count);
    m.comments = count(r.comments?.summary?.total_count);
    m.shares = count(r.shares?.count) ?? 0;
  } catch {
    // a video's id doesn't take these fields; its views below still come
  }
  for (const metric of ["post_impressions_unique", "post_video_views"]) {
    try {
      const r = await get<{ data?: { name: string; values?: { value?: number }[] }[] }>(`${id}/insights`, { metric, access_token: token });
      const v = count(r.data?.[0]?.values?.[0]?.value);
      if (v !== null) {
        if (metric === "post_impressions_unique") m.reach = v;
        else m.views = v;
      }
    } catch {
      // not every post has every number
    }
  }
  return Object.keys(m).length ? m : null;
}

async function facebookFollowers(account: AccountWithTokens): Promise<number | null> {
  const r = await get<{ followers_count?: number; fan_count?: number }>(account.external_id, { fields: "followers_count,fan_count", access_token: account.access_token ?? "" });
  return count(r.followers_count) ?? count(r.fan_count);
}

// ---------- Instagram ----------

type ContainerState = { status_code?: string; status?: string };

async function containerState(id: string, token: string) {
  return get<ContainerState>(id, { fields: "status_code,status", access_token: token });
}

function settled(state: ContainerState): boolean {
  if (state.status_code === "ERROR" || state.status_code === "EXPIRED") {
    throw new NetworkError(`Instagram couldn't use the ${state.status?.toLowerCase().includes("video") ? "video" : "file"}${state.status ? ` (${state.status})` : ""}.`);
  }
  return state.status_code === "FINISHED" || state.status_code === "PUBLISHED";
}

// Waits a little in this run (a picture is ready in seconds); a Reel that
// takes longer is checked again by a later run.
async function readyWithin(ids: string[], token: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    let all = true;
    for (const id of ids) if (!settled(await containerState(id, token))) all = false;
    if (all) return true;
    if (Date.now() > until) return false;
    await sleep(3000);
  }
}

async function instagramFinish(igId: string, containerId: string, token: string): Promise<Step> {
  const published = await post<{ id: string }>("Instagram", `${igId}/media_publish`, { creation_id: containerId, access_token: token });
  if (!published.id) throw new NetworkError("Instagram didn't say the post's id; check the account before trying again.");
  let url: string | null = null;
  try {
    url = (await get<{ permalink?: string }>(published.id, { fields: "permalink", access_token: token })).permalink ?? null;
  } catch {
    // the post is up; the link is a nicety
  }
  return { done: true, id: published.id, url };
}

async function instagramPublish(out: Outgoing): Promise<Step> {
  const token = out.account.access_token ?? "";
  const igId = out.account.external_id;
  const waiting = typeof out.progress.container === "string" ? out.progress.container : null;
  if (waiting) {
    if (!settled(await containerState(waiting, token))) return { done: false, progress: { container: waiting }, checkInSeconds: 30 };
    return instagramFinish(igId, waiting, token);
  }
  const clip = video(out);
  const pics = images(out);
  if (!clip && !pics.length) throw new NetworkError("Instagram posts need a picture or a video.");
  let containerId: string;
  let children: string[] = [];
  if (clip) {
    containerId = (await post<{ id: string }>("Instagram", `${igId}/media`, { media_type: "REELS", video_url: clip.item.url, caption: out.text, share_to_feed: true, access_token: token })).id;
  } else if (pics.length === 1) {
    containerId = (await post<{ id: string }>("Instagram", `${igId}/media`, { image_url: pics[0].item.url, caption: out.text, access_token: token })).id;
  } else {
    for (const p of pics) children.push((await post<{ id: string }>("Instagram (picture upload)", `${igId}/media`, { image_url: p.item.url, is_carousel_item: true, access_token: token })).id);
    if (!(await readyWithin(children, token, 30_000))) throw new NetworkError("Instagram was still getting the pictures ready after 30 seconds. Try again in a minute.");
    containerId = (await post<{ id: string }>("Instagram", `${igId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: out.text, access_token: token })).id;
    children = [];
  }
  if (!(await readyWithin([containerId], token, clip ? 45_000 : 30_000))) return { done: false, progress: { container: containerId }, checkInSeconds: 30 };
  return instagramFinish(igId, containerId, token);
}

async function instagramMetrics(account: AccountWithTokens, id: string): Promise<Metrics | null> {
  const token = account.access_token ?? "";
  const m: Metrics = {};
  const base = await get<{ like_count?: number; comments_count?: number }>(id, { fields: "like_count,comments_count", access_token: token });
  m.likes = count(base.like_count);
  m.comments = count(base.comments_count);
  // Instagram renamed and retired some numbers over time: ask for the
  // current ones, then the older set
  for (const list of ["views,reach,saved,shares", "reach,saved"]) {
    try {
      const r = await get<{ data?: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[] }>(`${id}/insights`, { metric: list, access_token: token });
      for (const row of r.data ?? []) {
        const v = count(row.values?.[0]?.value) ?? count(row.total_value?.value);
        if (row.name === "views") m.views = v;
        if (row.name === "reach") m.reach = v;
        if (row.name === "saved") m.saves = v;
        if (row.name === "shares") m.shares = v;
      }
      break;
    } catch {
      // try the older set
    }
  }
  return m;
}

async function instagramFollowers(account: AccountWithTokens): Promise<number | null> {
  const r = await get<{ followers_count?: number }>(account.external_id, { fields: "followers_count", access_token: account.access_token ?? "" });
  return count(r.followers_count);
}

export const facebook: NetworkModule = { publish: facebookPublish, metrics: facebookMetrics, followers: facebookFollowers };
export const instagram: NetworkModule = { publish: instagramPublish, metrics: instagramMetrics, followers: instagramFollowers };
