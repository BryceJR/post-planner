// LinkedIn: your own profile (Sign In with LinkedIn + Share on LinkedIn, both
// self-serve), and company pages you administer once LinkedIn has approved
// the Community Management API for the app (LINKEDIN_PAGES=1). Tokens last
// 60 days with no refresh: connect again before then. Numbers only come for
// company pages: LinkedIn doesn't share them for a personal profile's posts.
import { linkedinCommentary } from "../text";
import type { AccountWithTokens, Metrics } from "../types";
import { callJson, count, expiresAt, formBody, images, NetworkError, sleep, video, type NetworkModule, type Outgoing, type Step } from "./common";
import type { AccountDraft } from "./drafts";

const REST = "https://api.linkedin.com/rest";

export function linkedinVersion(env: Record<string, string | undefined> = process.env) {
  const v = env.LINKEDIN_API_VERSION?.trim();
  return v && /^\d{6}$/.test(v) ? v : "202605";
}

export function linkedinPagesOn(env: Record<string, string | undefined> = process.env) {
  return /^(1|true|yes|on)$/i.test(env.LINKEDIN_PAGES?.trim() ?? "");
}

export function linkedinScopes(env: Record<string, string | undefined> = process.env) {
  return ["openid", "profile", "w_member_social", ...(linkedinPagesOn(env) ? ["w_organization_social", "r_organization_admin", "r_organization_social"] : [])].join(" ");
}

type Creds = { id: string; secret: string };

function headers(token: string, json = true): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": linkedinVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

export function linkedinAuthorizeUrl(clientId: string, redirect: string, state: string) {
  const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", linkedinScopes());
  return u.toString();
}

export async function linkedinFinishConnect(creds: Creds, code: string, redirect: string): Promise<AccountDraft[]> {
  const { body: t } = await callJson<{ access_token: string; expires_in?: number; refresh_token?: string }>("LinkedIn", "https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: creds.id, client_secret: creds.secret }),
  });
  const { body: me } = await callJson<{ sub: string; name?: string; given_name?: string; family_name?: string; picture?: string }>("LinkedIn", "https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${t.access_token}` },
  });
  const expires = expiresAt(t.expires_in);
  const drafts: AccountDraft[] = [
    {
      platform: "linkedin",
      external_id: me.sub,
      name: me.name || [me.given_name, me.family_name].filter(Boolean).join(" ") || "LinkedIn profile",
      handle: null,
      avatar_url: me.picture ?? null,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? null,
      expires_at: expires,
      extra: { author: `urn:li:person:${me.sub}`, kind: "person" },
    },
  ];
  if (linkedinPagesOn()) {
    const { body: acls } = await callJson<{ elements?: { organization?: string; organizationTarget?: string }[] }>("LinkedIn", `${REST}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, {
      headers: headers(t.access_token, false),
    });
    for (const acl of acls.elements ?? []) {
      const urn = acl.organization ?? acl.organizationTarget;
      const id = urn?.split(":").pop();
      if (!urn || !id) continue;
      let name = `LinkedIn page ${id}`;
      try {
        const { body: org } = await callJson<{ localizedName?: string }>("LinkedIn", `${REST}/organizations/${encodeURIComponent(id)}`, { headers: headers(t.access_token, false) });
        if (org.localizedName) name = org.localizedName;
      } catch {
        // the page still connects under its number
      }
      drafts.push({ platform: "linkedin", external_id: urn, name, handle: "Company page", avatar_url: null, access_token: t.access_token, refresh_token: t.refresh_token ?? null, expires_at: expires, extra: { author: urn, kind: "organization" } });
    }
  }
  return drafts;
}

function authorOf(account: AccountWithTokens) {
  return typeof account.extra.author === "string" ? account.extra.author : `urn:li:person:${account.external_id}`;
}

async function uploadImage(token: string, author: string, bytes: Uint8Array, mime: string): Promise<string> {
  const { body } = await callJson<{ value?: { uploadUrl?: string; image?: string } }>("LinkedIn (picture upload)", `${REST}/images?action=initializeUpload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
  });
  const { uploadUrl, image } = body.value ?? {};
  if (!uploadUrl || !image) throw new NetworkError("LinkedIn didn't give a place to upload the picture.");
  const put = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": mime }, body: bytes as BodyInit });
  if (!put.ok) throw new NetworkError(`LinkedIn didn't take the picture (${put.status}).`);
  return image;
}

async function uploadVideo(token: string, author: string, bytes: Uint8Array): Promise<string> {
  const { body } = await callJson<{ value?: { video?: string; uploadToken?: string; uploadInstructions?: { uploadUrl: string; firstByte: number; lastByte: number }[] } }>(
    "LinkedIn (video upload)",
    `${REST}/videos?action=initializeUpload`,
    { method: "POST", headers: headers(token), body: JSON.stringify({ initializeUploadRequest: { owner: author, fileSizeBytes: bytes.byteLength, uploadCaptions: false, uploadThumbnail: false } }) }
  );
  const v = body.value;
  if (!v?.video || !v.uploadInstructions?.length) throw new NetworkError("LinkedIn didn't give a place to upload the video.");
  const parts: string[] = [];
  for (const part of v.uploadInstructions) {
    const res = await fetch(part.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes.subarray(part.firstByte, part.lastByte + 1) as BodyInit });
    if (!res.ok) throw new NetworkError(`LinkedIn didn't take part of the video (${res.status}).`);
    parts.push(res.headers.get("etag") ?? "");
  }
  await callJson("LinkedIn (video upload)", `${REST}/videos?action=finalizeUpload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken ?? "", uploadedPartIds: parts } }),
  });
  return v.video;
}

async function videoReady(token: string, urn: string): Promise<boolean> {
  const { body } = await callJson<{ status?: string }>("LinkedIn (video)", `${REST}/videos/${encodeURIComponent(urn)}`, { headers: headers(token, false) });
  if (body.status === "PROCESSING_FAILED") throw new NetworkError("LinkedIn couldn't process the video.");
  return body.status === "AVAILABLE";
}

async function createPost(out: Outgoing, token: string, author: string, content: Record<string, unknown> | null): Promise<Step> {
  const payload: Record<string, unknown> = {
    author,
    commentary: linkedinCommentary(out.text),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (content) payload.content = content;
  const { res } = await callJson<unknown>("LinkedIn", `${REST}/posts`, { method: "POST", headers: headers(token), body: JSON.stringify(payload) });
  const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
  if (!urn) throw new NetworkError("LinkedIn didn't say the post's id; check the profile before trying again.");
  return { done: true, id: urn, url: `https://www.linkedin.com/feed/update/${urn}/` };
}

async function publish(out: Outgoing): Promise<Step> {
  const token = out.account.access_token ?? "";
  if (out.account.expires_at && Date.parse(out.account.expires_at) < Date.now()) {
    throw new NetworkError("LinkedIn's sign-in ran out (it lasts 60 days). Connect LinkedIn again.", { reconnect: true });
  }
  const author = authorOf(out.account);
  // a video LinkedIn was still processing last time
  const waiting = typeof out.progress.video === "string" ? out.progress.video : null;
  if (waiting) {
    if (!(await videoReady(token, waiting))) return { done: false, progress: { video: waiting }, checkInSeconds: 30 };
    return createPost(out, token, author, { media: { id: waiting } });
  }
  const clip = video(out);
  if (clip) {
    const urn = await uploadVideo(token, author, await clip.bytes());
    for (let i = 0; i < 6; i++) {
      if (await videoReady(token, urn)) return createPost(out, token, author, { media: { id: urn } });
      await sleep(5000);
    }
    return { done: false, progress: { video: urn }, checkInSeconds: 30 };
  }
  const ids: { id: string; altText?: string }[] = [];
  for (const p of images(out)) {
    const id = await uploadImage(token, author, await p.bytes(), p.item.mime);
    ids.push(p.item.alt ? { id, altText: p.item.alt.slice(0, 4086) } : { id });
  }
  return createPost(out, token, author, ids.length === 1 ? { media: ids[0] } : ids.length > 1 ? { multiImage: { images: ids } } : null);
}

// Company pages only: LinkedIn shares no numbers for a personal profile.
async function metrics(account: AccountWithTokens, id: string): Promise<Metrics | null> {
  if (account.extra.kind !== "organization") return null;
  const org = authorOf(account);
  const param = id.includes(":ugcPost:") ? "ugcPosts" : "shares";
  const { body } = await callJson<{ elements?: { totalShareStatistics?: Record<string, unknown> }[] }>(
    "LinkedIn",
    `${REST}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(org)}&${param}=List(${encodeURIComponent(id)})`,
    { headers: headers(account.access_token ?? "", false) }
  );
  const s = body.elements?.[0]?.totalShareStatistics;
  if (!s) return null;
  return { views: count(s.impressionCount), reach: count(s.uniqueImpressionsCount), likes: count(s.likeCount), comments: count(s.commentCount), shares: count(s.shareCount), clicks: count(s.clickCount) };
}

async function followers(account: AccountWithTokens): Promise<number | null> {
  if (account.extra.kind !== "organization") return null;
  const { body } = await callJson<{ firstDegreeSize?: number }>("LinkedIn", `${REST}/networkSizes/${encodeURIComponent(authorOf(account))}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, {
    headers: headers(account.access_token ?? "", false),
  });
  return count(body.firstDegreeSize);
}

export const linkedin: NetworkModule = { publish, metrics, followers };
