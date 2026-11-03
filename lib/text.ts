// How long a post is on each network, and the text each one's API wants.
// Pure; tested in text.test.ts.
import { PLATFORM_INFO, type Platform } from "./platforms";

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

// What you see: an emoji with skin tone, a flag, an accented letter is one.
export function graphemeLength(text: string): number {
  return graphemes(text).length;
}

// Links: http(s) addresses, and bare ones like example.com/pricing (X counts both as links).
const URL_RE = /\bhttps?:\/\/[^\s<>"]+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|co|app|ai|dev|us|ca|biz|info|me|tv)\b(?:\/[^\s<>"]*)?/gi;
const TRAILING_PUNCTUATION = /[.,;:!?'")\]]+$/;

export type Found = { start: number; end: number; text: string };

// The links in a post, without a sentence's closing punctuation.
export function findLinks(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(TRAILING_PUNCTUATION, "");
    if (!raw) continue;
    const start = m.index ?? 0;
    // an email address isn't a link
    if (start > 0 && text[start - 1] === "@") continue;
    out.push({ start, end: start + raw.length, text: raw });
  }
  return out;
}

// Hashtags: # then letters, digits or _ (not all digits), at the start or after a space.
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)/gu;

export function findHashtags(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const start = (m.index ?? 0) + m[1].length;
    out.push({ start, end: start + 1 + m[2].length, text: m[2] });
  }
  return out;
}

// X's count (twitter-text): every link is 23, an emoji is 2, a letter from
// Latin and the common punctuation is 1, anything else (Chinese, Japanese,
// Korean…) is 2.
const LIGHT: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function xLength(text: string): number {
  let total = 0;
  let last = 0;
  const pieces: string[] = [];
  for (const link of findLinks(text)) {
    pieces.push(text.slice(last, link.start));
    total += 23;
    last = link.end;
  }
  pieces.push(text.slice(last));
  for (const piece of pieces) {
    for (const g of graphemes(piece)) {
      if (EMOJI.test(g)) {
        total += 2;
        continue;
      }
      for (const ch of g) {
        const cp = ch.codePointAt(0) ?? 0;
        total += LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
      }
    }
  }
  return total;
}

export function lengthOn(platform: Platform, text: string): number {
  const counting = PLATFORM_INFO[platform].counting;
  if (counting === "x") return xLength(text);
  if (counting === "graphemes") return graphemeLength(text);
  return text.length;
}

// LinkedIn's posts are "little text": ( ) [ ] { } < > @ # * _ ~ | and \ mean
// something, and an unescaped one cuts the post short. Each is escaped, and
// a hashtag becomes LinkedIn's hashtag so it still links.
const LITTLE_TEXT_RESERVED = /[\\|{}@[\]()<>#*_~]/g;

export function linkedinCommentary(text: string): string {
  const tags = findHashtags(text);
  let out = "";
  let last = 0;
  const escape = (s: string) => s.replace(LITTLE_TEXT_RESERVED, (c) => `\\${c}`);
  for (const tag of tags) {
    out += escape(text.slice(last, tag.start));
    out += `{hashtag|\\#|${escape(tag.text)}}`;
    last = tag.end;
  }
  out += escape(text.slice(last));
  return out;
}

// Bluesky's links and hashtags only work as "facets": where they sit, in
// bytes of the UTF-8 text.
export type BlueskyFacet = {
  index: { byteStart: number; byteEnd: number };
  features: ({ $type: "app.bsky.richtext.facet#link"; uri: string } | { $type: "app.bsky.richtext.facet#tag"; tag: string })[];
};

const encoder = new TextEncoder();
function bytesBefore(text: string, index: number) {
  return encoder.encode(text.slice(0, index)).length;
}

export function blueskyFacets(text: string): BlueskyFacet[] {
  const facets: BlueskyFacet[] = [];
  for (const link of findLinks(text)) {
    const uri = /^https?:\/\//i.test(link.text) ? link.text : `https://${link.text}`;
    facets.push({ index: { byteStart: bytesBefore(text, link.start), byteEnd: bytesBefore(text, link.end) }, features: [{ $type: "app.bsky.richtext.facet#link", uri }] });
  }
  for (const tag of findHashtags(text)) {
    if (tag.text.length > 64) continue;
    facets.push({ index: { byteStart: bytesBefore(text, tag.start), byteEnd: bytesBefore(text, tag.end) }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: tag.text }] });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

// A short line for lists and the calendar: the first line, cut at a word.
export function excerpt(text: string, max = 80): string {
  const line = text.trim().split(/\n/)[0] ?? "";
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
