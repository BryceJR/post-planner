// Whether a post can go to the accounts it's for: what would stop it (a
// network that would refuse it) and what's worth a second look. The composer,
// the save and the AI connector all ask here. Pure; tested in checks.test.ts.
import { PLATFORM_INFO, type Platform } from "./platforms";
import { redditSettings, youtubeSettings } from "./target-settings";
import { lengthOn } from "./text";
import type { AccountStatus, MediaKind } from "./types";

export type CheckAccount = { id: string; platform: Platform; name: string; status: AccountStatus; username?: string | null };
export type CheckTarget = { account: CheckAccount; body: string | null; settings: Record<string, unknown> };
export type CheckMedia = { kind: MediaKind; duration: number | null };
export type CheckInput = { body: string; media: CheckMedia[]; targets: CheckTarget[] };
export type Problem = { accountId: string | null; message: string };
export type CheckResult = { errors: Problem[]; warnings: Problem[] };

// 140 → "2:20"
export function clock(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function label(account: Pick<CheckAccount, "platform" | "name">) {
  return `${PLATFORM_INFO[account.platform].name} (${account.name})`;
}

export function checkPost(input: CheckInput, opts: { publishing: boolean }): CheckResult {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const images = input.media.filter((m) => m.kind === "image").length;
  const videos = input.media.filter((m) => m.kind === "video");
  // a draft can be anything; only going out needs an account
  if (opts.publishing && input.targets.length === 0) errors.push({ accountId: null, message: "Pick at least one account to post to." });
  if (images && videos.length) errors.push({ accountId: null, message: "A post has pictures or one video, not both." });
  if (videos.length > 1) errors.push({ accountId: null, message: "A post takes one video." });

  for (const target of input.targets) {
    const { account } = target;
    const info = PLATFORM_INFO[account.platform];
    const text = (target.body ?? input.body).trim();
    const where = label(account);
    const add = (list: Problem[], message: string) => list.push({ accountId: account.id, message: `${where}: ${message}` });
    // a draft saves as it is: what would stop it going out is only a warning until then
    const stop = opts.publishing ? errors : warnings;
    if (account.status !== "connected") add(stop, "needs connecting again (Accounts) before it can post.");
    if (!text && input.media.length === 0) add(stop, "there's nothing to post. Add words, a picture or a video.");
    if (info.needs === "video" && videos.length === 0) add(stop, `${info.name} posts are videos. Add one.`);
    if (info.needs === "media" && input.media.length === 0) add(stop, `${info.name} posts need a picture or a video.`);
    if (images > info.maxImages) add(stop, info.maxImages ? `takes up to ${info.maxImages} picture${info.maxImages === 1 ? "" : "s"}; this post has ${images}.` : "doesn't take pictures here, only a video.");
    if (videos.length && info.maxVideos === 0) add(stop, "videos can't be sent there from Post Planner yet. Leave it off this post, or use pictures.");
    const duration = videos[0]?.duration;
    if (duration && info.maxVideoSeconds && duration > info.maxVideoSeconds) {
      add(account.platform === "x" ? warnings : stop, `takes videos up to ${clock(info.maxVideoSeconds)}; this one is ${clock(duration)}.`);
    }
    const length = lengthOn(account.platform, text);
    if (length > info.maxChars) {
      const over = `allows ${info.maxChars.toLocaleString("en-US")} characters; this is ${length.toLocaleString("en-US")}.`;
      if (info.overLimitIsWarning) add(warnings, `${over} It only goes if the account has X Premium; otherwise give X its own shorter wording.`);
      else add(stop, `${over} Shorten it, or give ${info.name} its own wording.`);
    }
    if (account.platform === "instagram" && (text.match(/(^|\s)#\S/g)?.length ?? 0) > 30) add(stop, "Instagram allows 30 hashtags at most.");
    if (account.platform === "youtube") {
      const yt = youtubeSettings(target.settings, text);
      if (/[<>]/.test(yt.title)) add(stop, "YouTube titles can't have < or >.");
    }
    if (account.platform === "reddit") {
      const rd = redditSettings(target.settings, text, account.username ?? null);
      if (!rd.subreddit) add(stop, "pick a subreddit (or u/yourname for your profile).");
      if (!rd.title) add(stop, "Reddit posts need a title.");
    }
    if (account.platform === "tiktok" && target.settings.privacy === undefined) {
      add(warnings, "goes to everyone unless you pick who can see it. Until TikTok audits the app, only a private account works.");
    }
  }
  return { errors, warnings };
}

export function problemLines(problems: Problem[]): string[] {
  return problems.map((p) => p.message);
}
