// What some networks need besides the words: a YouTube video's title and
// who sees it, a Reddit post's subreddit and title, a TikTok's privacy and
// whether people can comment, duet and stitch. Kept per account on a post
// (post_targets.settings). Pure; tested in target-settings.test.ts.
import type { Platform } from "./platforms";

export const YOUTUBE_PRIVACY = ["public", "unlisted", "private"] as const;
export type YouTubePrivacy = (typeof YOUTUBE_PRIVACY)[number];
export type YouTubeSettings = { title?: string; privacy?: YouTubePrivacy; tags?: string[]; madeForKids?: boolean };

export type RedditSettings = { subreddit?: string; title?: string; nsfw?: boolean; spoiler?: boolean };

export const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
export type TikTokPrivacy = (typeof TIKTOK_PRIVACY)[number];
export const TIKTOK_PRIVACY_LABEL: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};
export type TikTokSettings = { privacy?: TikTokPrivacy; allowComments?: boolean; allowDuet?: boolean; allowStitch?: boolean };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : v === "on" || v === "true" ? true : v === "false" ? false : undefined);

// A subreddit as people type it ("r/HVAC", "/r/hvac", "HVAC", "u/name" for
// your own profile): Reddit's own name for it ("HVAC", "u_name").
export function cleanSubreddit(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim().replace(/^\/+/, "");
  const user = /^u(?:ser)?\/([A-Za-z0-9_-]{3,20})\/?$/i.exec(s) ?? /^u_([A-Za-z0-9_-]{3,20})$/i.exec(s);
  if (user) return `u_${user[1]}`;
  const sub = /^(?:r\/)?([A-Za-z0-9][A-Za-z0-9_]{1,20})\/?$/i.exec(s);
  return sub ? sub[1] : undefined;
}

// Only what each network takes, cleaned; anything else is dropped.
export function cleanSettings(platform: Platform, raw: unknown): Record<string, unknown> {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== "") out[k] = v;
  };
  if (platform === "youtube") {
    put("title", str(r.title, 100));
    put("privacy", (YOUTUBE_PRIVACY as readonly string[]).includes(String(r.privacy)) ? r.privacy : undefined);
    const tags = Array.isArray(r.tags) ? r.tags : typeof r.tags === "string" ? r.tags.split(",") : [];
    const clean = tags.map((t) => str(t, 60)).filter((t): t is string => !!t).slice(0, 30);
    if (clean.length) out.tags = clean;
    put("madeForKids", bool(r.madeForKids));
  } else if (platform === "reddit") {
    put("subreddit", cleanSubreddit(str(r.subreddit, 60)));
    put("title", str(r.title, 300));
    put("nsfw", bool(r.nsfw));
    put("spoiler", bool(r.spoiler));
  } else if (platform === "tiktok") {
    put("privacy", (TIKTOK_PRIVACY as readonly string[]).includes(String(r.privacy)) ? r.privacy : undefined);
    put("allowComments", bool(r.allowComments));
    put("allowDuet", bool(r.allowDuet));
    put("allowStitch", bool(r.allowStitch));
  }
  return out;
}

export function firstLine(text: string, max: number): string {
  const line = (text.trim().split(/\n/)[0] ?? "").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// What each network will really get, with the defaults filled in.
export function youtubeSettings(s: Record<string, unknown>, text: string): Required<Omit<YouTubeSettings, "tags">> & { tags: string[] } {
  const v = s as YouTubeSettings;
  return {
    title: v.title?.trim() || firstLine(text, 100) || "New video",
    privacy: v.privacy ?? "public",
    tags: v.tags ?? [],
    madeForKids: v.madeForKids ?? false,
  };
}

// Your own profile ("u_name") when no subreddit is given.
export function redditSettings(s: Record<string, unknown>, text: string, username: string | null): { subreddit: string | null; title: string; nsfw: boolean; spoiler: boolean } {
  const v = s as RedditSettings;
  return {
    subreddit: v.subreddit ?? (username ? `u_${username}` : null),
    title: v.title?.trim() || firstLine(text, 300),
    nsfw: v.nsfw ?? false,
    spoiler: v.spoiler ?? false,
  };
}

export function tiktokSettings(s: Record<string, unknown>): Required<TikTokSettings> {
  const v = s as TikTokSettings;
  return { privacy: v.privacy ?? "PUBLIC_TO_EVERYONE", allowComments: v.allowComments ?? true, allowDuet: v.allowDuet ?? true, allowStitch: v.allowStitch ?? true };
}

// The text that goes with a YouTube video or a Reddit post: everything after
// the first line when that line became the title, so it isn't said twice.
export function bodyAfterTitle(text: string, title: string): string {
  const lines = text.trim().split(/\n/);
  return lines[0]?.trim() === title.trim() ? lines.slice(1).join("\n").trim() : text.trim();
}
