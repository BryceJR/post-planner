import { describe, expect, it } from "vitest";
import { checkPost, clock, type CheckAccount } from "./checks";

const acct = (platform: CheckAccount["platform"], status: CheckAccount["status"] = "connected", username: string | null = null): CheckAccount => ({ id: `${platform}-1`, platform, name: `My ${platform}`, status, username });
const pic = { kind: "image" as const, duration: null };
const vid = (duration: number | null = 30) => ({ kind: "video" as const, duration });
const t = (account: CheckAccount, settings: Record<string, unknown> = {}, body: string | null = null) => ({ account, body, settings });

describe("checkPost", () => {
  it("going out needs an account; a draft doesn't", () => {
    expect(checkPost({ body: "hi", media: [], targets: [] }, { publishing: true }).errors).toHaveLength(1);
    expect(checkPost({ body: "hi", media: [], targets: [] }, { publishing: false }).errors).toHaveLength(0);
  });
  it("pictures or one video, not both", () => {
    expect(checkPost({ body: "hi", media: [pic, vid()], targets: [] }, { publishing: false }).errors[0].message).toMatch(/not both/);
    expect(checkPost({ body: "hi", media: [vid(), vid()], targets: [] }, { publishing: false }).errors[0].message).toMatch(/one video/);
  });
  it("YouTube and TikTok need a video; Instagram needs media", () => {
    for (const p of ["youtube", "tiktok"] as const) expect(checkPost({ body: "hi", media: [pic], targets: [t(acct(p), { privacy: "SELF_ONLY" })] }, { publishing: true }).errors.map((e) => e.message).join()).toMatch(/videos/);
    expect(checkPost({ body: "hi", media: [], targets: [t(acct("instagram"))] }, { publishing: true }).errors[0].message).toMatch(/picture or a video/);
    expect(checkPost({ body: "hi", media: [vid()], targets: [t(acct("instagram"))] }, { publishing: true }).errors).toHaveLength(0);
  });
  it("videos aren't sent to Reddit or Bluesky yet", () => {
    const r = checkPost({ body: "hi", media: [vid()], targets: [t(acct("bluesky")), t(acct("reddit", "connected", "me"))] }, { publishing: true });
    expect(r.errors.filter((e) => /can't be sent there/.test(e.message))).toHaveLength(2);
  });
  it("video length: a warning on X, a stop elsewhere", () => {
    const r = checkPost({ body: "hi", media: [vid(200)], targets: [t(acct("x"))] }, { publishing: true });
    expect(r.warnings[0].message).toMatch(/2:20; this one is 3:20/);
    expect(checkPost({ body: "hi", media: [vid(700)], targets: [t(acct("tiktok"), { privacy: "SELF_ONLY" })] }, { publishing: true }).errors[0].message).toMatch(/10:00/);
  });
  it("long text: a warning on X (Premium), a stop on Bluesky", () => {
    const long = "a".repeat(301);
    const r = checkPost({ body: long, media: [], targets: [t(acct("x")), t(acct("bluesky"))] }, { publishing: true });
    expect(r.warnings.map((w) => w.accountId)).toEqual(["x-1"]);
    expect(r.errors.map((e) => e.accountId)).toEqual(["bluesky-1"]);
    expect(checkPost({ body: long, media: [], targets: [t(acct("bluesky"), {}, "short")] }, { publishing: true }).errors).toHaveLength(0);
  });
  it("Reddit needs a subreddit (your profile by default) and a title", () => {
    expect(checkPost({ body: "Title\nbody", media: [], targets: [t(acct("reddit", "connected", "me"))] }, { publishing: true }).errors).toHaveLength(0);
    expect(checkPost({ body: "Title", media: [], targets: [t(acct("reddit"))] }, { publishing: true }).errors[0].message).toMatch(/subreddit/);
    expect(checkPost({ body: "", media: [pic], targets: [t(acct("reddit", "connected", "me"))] }, { publishing: true }).errors[0].message).toMatch(/title/);
  });
  it("YouTube titles can't have angle brackets", () => {
    expect(checkPost({ body: "a <b>", media: [vid()], targets: [t(acct("youtube"))] }, { publishing: true }).errors[0].message).toMatch(/< or >/);
  });
  it("an account that needs connecting again stops a post going out, and only warns on a draft", () => {
    const targets = [t(acct("linkedin", "reconnect"))];
    expect(checkPost({ body: "hi", media: [], targets }, { publishing: true }).errors).toHaveLength(1);
    expect(checkPost({ body: "hi", media: [], targets }, { publishing: false }).warnings).toHaveLength(1);
  });
  it("a draft saves incomplete: what would stop it is a warning until it goes out", () => {
    const r = checkPost({ body: "hi", media: [], targets: [t(acct("youtube")), t(acct("reddit"))] }, { publishing: false });
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/videos[^]*subreddit/);
    expect(checkPost({ body: "hi", media: [pic, vid()], targets: [] }, { publishing: false }).errors).toHaveLength(1);
  });
  it("clock", () => {
    expect(clock(140)).toBe("2:20");
    expect(clock(59.6)).toBe("1:00");
  });
});
