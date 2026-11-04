import { describe, expect, it } from "vitest";
import { blueskyFacets, excerpt, findHashtags, findLinks, graphemeLength, lengthOn, linkedinCommentary, xLength } from "./text";

describe("post lengths", () => {
  it("X counts a link as 23, an emoji as 2 and wide characters as 2", () => {
    expect(xLength("hello")).toBe(5);
    expect(xLength("See https://brycoops.com/pricing/plans-for-every-size-of-shop now")).toBe(4 + 23 + 4);
    expect(xLength("brycoops.com")).toBe(23);
    expect(xLength("🔧")).toBe(2);
    expect(xLength("👨‍👩‍👧")).toBe(2);
    expect(xLength("日本")).toBe(4);
    expect(xLength("café")).toBe(4);
  });
  it("Bluesky counts what you see", () => {
    expect(graphemeLength("👨‍👩‍👧 hi")).toBe(4);
    expect(lengthOn("bluesky", "🇺🇸")).toBe(1);
  });
  it("the others count characters", () => {
    expect(lengthOn("linkedin", "abc")).toBe(3);
    expect(lengthOn("x", "https://x.com")).toBe(23);
  });
});

describe("links and hashtags", () => {
  it("finds links without the sentence's last full stop, and skips emails", () => {
    expect(findLinks("Go to https://brycoops.com/start. Or mail hi@brycoops.com").map((l) => l.text)).toEqual(["https://brycoops.com/start"]);
    expect(findLinks("(see brycoops.com/pricing)").map((l) => l.text)).toEqual(["brycoops.com/pricing"]);
  });
  it("finds hashtags at the start or after a space, not all digits", () => {
    expect(findHashtags("#HVAC tips for #small_shops, not a#tag or #2026").map((t) => t.text)).toEqual(["HVAC", "small_shops"]);
  });
});

describe("LinkedIn's little text", () => {
  it("escapes the characters that would cut the post short", () => {
    expect(linkedinCommentary("Pricing (new) [beta] @team *bold* _x_ ~y~ <a> {b} | \\")).toBe(
      "Pricing \\(new\\) \\[beta\\] \\@team \\*bold\\* \\_x\\_ \\~y\\~ \\<a\\> \\{b\\} \\| \\\\"
    );
  });
  it("keeps hashtags as LinkedIn hashtags", () => {
    expect(linkedinCommentary("Tips #HVAC (and #more_tips)")).toBe("Tips {hashtag|\\#|HVAC} \\(and {hashtag|\\#|more\\_tips}\\)");
  });
});

describe("Bluesky facets", () => {
  it("places links and tags by UTF-8 bytes", () => {
    const text = "🔧 Fix it: https://brycoops.com #HVAC";
    const facets = blueskyFacets(text);
    expect(facets).toHaveLength(2);
    const bytes = new TextEncoder().encode(text);
    const slice = (f: (typeof facets)[number]) => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
    expect(slice(facets[0])).toBe("https://brycoops.com");
    expect(facets[0].features[0]).toEqual({ $type: "app.bsky.richtext.facet#link", uri: "https://brycoops.com" });
    expect(slice(facets[1])).toBe("#HVAC");
    expect(facets[1].features[0]).toEqual({ $type: "app.bsky.richtext.facet#tag", tag: "HVAC" });
  });
  it("a bare domain links to its https address", () => {
    expect(blueskyFacets("brycoops.com")[0].features[0]).toEqual({ $type: "app.bsky.richtext.facet#link", uri: "https://brycoops.com" });
  });
});

describe("excerpt", () => {
  it("the first line, cut at a word", () => {
    expect(excerpt("Short\nsecond line")).toBe("Short");
    expect(excerpt("one two three four five six seven", 20)).toBe("one two three four…");
  });
});
