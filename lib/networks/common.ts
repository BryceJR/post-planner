// What every network's module shares: the shape of a post going out, what
// comes back, and how a refusal is told apart (sign in again, or not).
import type { AccountWithTokens, MediaItem, Metrics } from "../types";

// A picture or video on the post. Its bytes are read only by the networks
// that upload bytes (the rest fetch the public URL), and only once.
export type MediaFile = { item: MediaItem; bytes: () => Promise<Uint8Array> };

export type Outgoing = {
  account: AccountWithTokens;
  text: string;
  media: MediaFile[];
  settings: Record<string, unknown>;
  // where an earlier run left off, while the network was still processing
  progress: Record<string, unknown>;
};

// Posted (with the network's id and link), or still being processed by the
// network: `progress` is kept and the run comes back after `checkInSeconds`.
export type Step =
  | { done: true; id: string; url: string | null; note?: string | null }
  | { done: false; progress: Record<string, unknown>; checkInSeconds: number };

// New tokens to keep on the account (a refresh on the way).
export type TokenChange = { access_token?: string | null; refresh_token?: string | null; expires_at?: string | null; extra?: Record<string, unknown> };

export type NetworkModule = {
  publish: (out: Outgoing) => Promise<Step>;
  metrics?: (account: AccountWithTokens, externalId: string) => Promise<Metrics | null>;
  followers?: (account: AccountWithTokens) => Promise<number | null>;
};

export class NetworkError extends Error {
  // the account's sign-in is gone: it needs connecting again
  reconnect: boolean;
  constructor(message: string, opts: { reconnect?: boolean } = {}) {
    super(message);
    this.reconnect = !!opts.reconnect;
  }
}

export const TIMEOUT_MS = 60_000;

// The message inside a network's error body, whatever shape it has.
export function errorText(body: unknown): string | null {
  if (!body || typeof body !== "object") return typeof body === "string" && body.trim() ? body.trim().slice(0, 400) : null;
  const b = body as Record<string, unknown>;
  const inner = b.error && typeof b.error === "object" ? (b.error as Record<string, unknown>) : null;
  const errors = Array.isArray(b.errors) ? (b.errors as Record<string, unknown>[]) : null;
  const pick = [
    inner?.error_user_msg,
    inner?.message,
    b.error_description,
    b.detail,
    b.message,
    errors?.[0]?.message,
    errors?.[0]?.detail,
    typeof b.error === "string" ? b.error : null,
    b.title,
  ].find((v) => typeof v === "string" && v.trim());
  return typeof pick === "string" ? pick.trim().slice(0, 400) : null;
}

// Ids bigger than JavaScript's numbers hold exactly (TikTok's post ids are
// 19 digits) are read as text, so they aren't rounded off.
export function quoteBigIntegers(json: string): string {
  return json.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"');
}

export async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    try {
      return JSON.parse(quoteBigIntegers(text));
    } catch {
      // a long number inside some text tripped the quoting: read it as it is
      return JSON.parse(text);
    }
  } catch {
    return text;
  }
}

// A call to a network. Anything but 2xx is a NetworkError with the network's
// own words; `signedOut` says which answers mean "sign in again".
export async function callJson<T>(
  network: string,
  url: string,
  init: RequestInit,
  signedOut: (status: number, body: unknown) => boolean = (status) => status === 401
): Promise<{ body: T; res: Response }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new NetworkError(timedOut ? `${network} didn't answer in time.` : `Couldn't reach ${network}.`);
  }
  const body = await readBody(res);
  if (!res.ok) {
    const said = errorText(body);
    throw new NetworkError(`${network} said no (${res.status})${said ? `: ${said}` : "."}`, { reconnect: signedOut(res.status, body) });
  }
  return { body: body as T, res };
}

export function formBody(values: Record<string, string | number | boolean | null | undefined>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) body.set(k, String(v));
  return body;
}

export function expiresAt(seconds: number | null | undefined, nowMs = Date.now()): string | null {
  return typeof seconds === "number" && seconds > 0 ? new Date(nowMs + seconds * 1000).toISOString() : null;
}

// A token with under five minutes left is refreshed before it's used.
export function needsRefresh(expires: string | null, nowMs = Date.now()) {
  return !expires || Date.parse(expires) - nowMs < 5 * 60_000;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function blobOf(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes as BlobPart], { type });
}

export function basicAuth(id: string, secret: string) {
  return `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}`;
}

// A count from a network's answer: a number, or a number in a string.
export function count(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

export function images(out: Outgoing) {
  return out.media.filter((m) => m.item.kind === "image");
}

export function video(out: Outgoing) {
  return out.media.find((m) => m.item.kind === "video") ?? null;
}
