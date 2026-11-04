// Pictures and videos for posts, kept in the public `media` bucket so every
// network can fetch them by URL. Pictures are made into JPEGs no wider than
// 2048 px and under 1 MB (Instagram only takes JPEGs, Bluesky only 1 MB);
// videos are kept as they are, up to 50 MB (the Supabase free plan's limit).
// The browser uploads straight to storage with a one-time link, so big
// videos never pass through the app. Server only.
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { MediaItem, MediaKind } from "./types";

export const MEDIA_BUCKET = "media";
export const MAX_BYTES = 50 * 1024 * 1024;
const TARGET_IMAGE_BYTES = 950_000;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export function kindOf(mime: string): MediaKind | null {
  const m = mime.toLowerCase().split(";")[0].trim();
  if (IMAGE_TYPES.includes(m)) return "image";
  if (VIDEO_TYPES.includes(m)) return "video";
  return null;
}

const EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

function newPath(ext: string, nowMs = Date.now()) {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
}

export type Normalized = { bytes: Buffer; width: number; height: number };

// Turned upright (phone pictures), flattened onto white (a JPEG has no
// see-through), sized down and compressed until it's under 1 MB.
export async function normalizeImage(input: Uint8Array): Promise<Normalized> {
  const attempts: [number, number][] = [
    [2048, 85],
    [2048, 75],
    [1600, 75],
    [1280, 70],
    [1080, 65],
  ];
  let last: Normalized | null = null;
  for (const [edge, quality] of attempts) {
    const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    last = { bytes: data, width: info.width, height: info.height };
    if (data.byteLength <= TARGET_IMAGE_BYTES) return last;
  }
  if (!last) throw new Error("That picture couldn't be read.");
  return last;
}

function publicUrl(db: SupabaseClient, path: string) {
  return db.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function storeImage(db: SupabaseClient, input: Uint8Array, alt: string | null = null): Promise<MediaItem> {
  let img: Normalized;
  try {
    img = await normalizeImage(input);
  } catch {
    throw new Error("That file isn't a picture Post Planner can read (JPEG, PNG, WebP, GIF or HEIC).");
  }
  const path = newPath("jpg");
  const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, img.bytes, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  if (error) throw new Error(`The picture couldn't be saved: ${error.message}`);
  return { url: publicUrl(db, path), path, kind: "image", mime: "image/jpeg", size: img.bytes.byteLength, width: img.width, height: img.height, duration: null, alt: alt?.trim().slice(0, 1000) || null };
}

async function storeVideo(db: SupabaseClient, bytes: Uint8Array, mime: string, meta: { width?: number | null; height?: number | null; duration?: number | null } = {}): Promise<MediaItem> {
  const path = newPath(EXT[mime] ?? "mp4");
  const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(`The video couldn't be saved: ${error.message}`);
  return { url: publicUrl(db, path), path, kind: "video", mime, size: bytes.byteLength, width: meta.width ?? null, height: meta.height ?? null, duration: meta.duration ?? null, alt: null };
}

// ---------- uploads from the browser ----------

export type UploadTicket = { path: string; uploadUrl: string };

// A one-time link the browser uploads the file to.
export async function uploadTicket(db: SupabaseClient, file: { mime: string; size: number }): Promise<UploadTicket> {
  const kind = kindOf(file.mime);
  if (!kind) throw new Error("Post Planner takes pictures (JPEG, PNG, WebP, GIF, HEIC) and videos (MP4, MOV, WebM).");
  if (file.size > MAX_BYTES) throw new Error("That file is over 50 MB, the most the free storage plan takes. Export a smaller video (1080p, a lower bitrate) and try again.");
  const path = `incoming/${newPath(kind === "image" ? "img" : (EXT[file.mime] ?? "mp4"))}`;
  const { data, error } = await db.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Couldn't start the upload: ${error?.message ?? "no link"}`);
  return { path, uploadUrl: data.signedUrl };
}

// After the browser's upload: a picture is made post-ready (and the
// original let go); a video is checked and kept.
export async function finishUpload(db: SupabaseClient, path: string, meta: { width?: number | null; height?: number | null; duration?: number | null }): Promise<MediaItem> {
  if (!/^incoming\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(img|mp4|mov|webm)$/.test(path)) throw new Error("That upload isn't one Post Planner started.");
  const { data, error } = await db.storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) throw new Error("The upload didn't arrive. Try again.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (path.endsWith(".img")) {
    const item = await storeImage(db, bytes);
    await db.storage.from(MEDIA_BUCKET).remove([path]);
    return item;
  }
  const mime = data.type && kindOf(data.type) === "video" ? data.type : path.endsWith(".mov") ? "video/quicktime" : path.endsWith(".webm") ? "video/webm" : "video/mp4";
  return { url: publicUrl(db, path), path, kind: "video", mime, size: bytes.byteLength, width: meta.width ?? null, height: meta.height ?? null, duration: meta.duration ?? null, alt: null };
}

// ---------- from a link (the AI connector) ----------

// Only http(s) on the open internet.
export function publicHttpUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return null;
  if (isIP(host) && privateAddress(host)) return null;
  return u;
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

// Downloads a picture or video from a link (an AI-made picture, a video
// already online), up to 50 MB, and keeps a copy: the networks fetch it
// later, and a link that runs out mustn't take the post with it.
export async function importFromUrl(db: SupabaseClient, raw: string, alt: string | null = null): Promise<MediaItem> {
  const url = publicHttpUrl(raw);
  if (!url) throw new Error(`"${raw.slice(0, 120)}" isn't a public web address for a picture or video.`);
  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000), headers: { Accept: "image/*,video/*" } });
  } catch {
    throw new Error(`Couldn't download from ${url.host}.`);
  }
  if (!res.ok) throw new Error(`The file at ${url.host} didn't download (${res.status}).`);
  if (res.url && !publicHttpUrl(res.url)) throw new Error("That link leads somewhere that isn't public.");
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error("That file is over 50 MB.");
  const reader = res.body?.getReader();
  if (!reader) throw new Error("The file came back empty.");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error("That file is over 50 MB.");
    }
    parts.push(value);
  }
  const bytes = Buffer.concat(parts);
  const kind = kindOf(mime) ?? (/\.(mp4|mov|webm)(\?|$)/i.test(url.pathname) ? "video" : "image");
  if (kind === "video") return storeVideo(db, bytes, kindOf(mime) === "video" ? mime : "video/mp4");
  return storeImage(db, bytes, alt);
}

// ---------- reading them back ----------

// The bytes of a file in the bucket, for the networks that upload bytes.
export async function readStored(db: SupabaseClient, item: MediaItem): Promise<Uint8Array> {
  if (item.path) {
    const { data, error } = await db.storage.from(MEDIA_BUCKET).download(item.path);
    if (!error && data) return new Uint8Array(await data.arrayBuffer());
  }
  const res = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`A file on this post couldn't be read (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

export function mediaList(value: unknown): MediaItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof (m as Record<string, unknown>).url === "string" && /^https?:\/\//.test(String((m as Record<string, unknown>).url)))
    .map((m) => {
      const mime = typeof m.mime === "string" ? m.mime : m.kind === "video" ? "video/mp4" : "image/jpeg";
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      return {
        url: String(m.url),
        path: typeof m.path === "string" ? m.path : null,
        kind: m.kind === "video" || kindOf(mime) === "video" ? "video" : "image",
        mime,
        size: num(m.size),
        width: num(m.width),
        height: num(m.height),
        duration: num(m.duration),
        alt: typeof m.alt === "string" ? m.alt : null,
      } satisfies MediaItem;
    });
}
