// Where to send someone back to (?back=, ?next=): only a path inside this app.
// Browsers drop tabs and newlines and treat \ like /, so "/\t/evil.com" or
// "/\evil.com" would leave the site; those are refused, and the rest is read
// the way a browser reads it, against a made-up origin that must not change.
const BASE = "http://x.local";

export function safeLocalPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || !url.pathname.startsWith("/")) return null;
  return url.pathname + url.search + url.hash;
}
