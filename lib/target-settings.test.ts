import { describe, expect, it } from "vitest";
import { bodyAfterTitle, cleanSettings, cleanSubreddit, firstLine, redditSettings, tiktokSettings, youtubeSettings } from "./target-settings";

describe("network settings", () => {
  it("subreddits as people type them", () => {
    expect(cleanSubreddit("r/HVAC")).toBe("HVAC");
    expect(cleanSubreddit("/r/smallbusiness/")).toBe("smallbusiness");
    expect(cleanSubreddit("HVAC")).toBe("HVAC");
    expect(cleanSubreddit("u/brycejr")).toBe("u_brycejr");
    expect(cleanSubreddit("u_brycejr")).toBe("u_brycejr");
    expect(cleanSubreddit("not a sub!")).toBeUndefined();
  });
  it("keeps only what each network takes", () => {
    expect(cleanSettings("youtube", { title: "  Hi  ", privacy: "unlisted", tags: "a, b ,,c", madeForKids: "on", junk: 1 })).toEqual({ title: "Hi", privacy: "unlisted", tags: ["a", "b", "c"], madeForKids: true });
    expect(cleanSettings("youtube", { privacy: "everyone" })).toEqual({});
    expect(cleanSettings("reddit", { subreddit: "r/HVAC", title: "T", nsfw: false })).toEqual({ subreddit: "HVAC", title: "T", nsfw: false });
    expect(cleanSettings("tiktok", { privacy: "SELF_ONLY", allowDuet: "false" })).toEqual({ privacy: "SELF_ONLY", allowDuet: false });
    expect(cleanSettings("x", { title: "ignored" })).toEqual({});
    expect(cleanSettings("youtube", "nope")).toEqual({});
  });
  it("fills in titles from the first line", () => {
    expect(youtubeSettings({}, "Fix a leaky tap\nIn five minutes.")).toEqual({ title: "Fix a leaky tap", privacy: "public", tags: [], madeForKids: false });
    expect(redditSettings({}, "Question\nbody", "brycejr")).toEqual({ subreddit: "u_brycejr", title: "Question", nsfw: false, spoiler: false });
    expect(redditSettings({ subreddit: "HVAC", title: "Own" }, "x", null).subreddit).toBe("HVAC");
    expect(redditSettings({}, "x", null).subreddit).toBeNull();
    expect(tiktokSettings({ privacy: "SELF_ONLY" })).toEqual({ privacy: "SELF_ONLY", allowComments: true, allowDuet: true, allowStitch: true });
  });
  it("cuts a long first line at a word", () => {
    expect(firstLine("one two three four five six seven", 20)).toBe("one two three four…");
  });
  it("doesn't say the title twice", () => {
    expect(bodyAfterTitle("Title\nThe rest.", "Title")).toBe("The rest.");
    expect(bodyAfterTitle("No title here", "Something else")).toBe("No title here");
  });
});
