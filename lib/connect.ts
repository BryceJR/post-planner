// Connecting a network from Accounts: the state (and the PKCE verifier, for
// the networks that take one) rides in a short-lived cookie to the callback.
import { createHash, randomBytes } from "node:crypto";

export const STATE_COOKIE = "pp_connect";

export function newPkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export type StateCookie = { connection: string; state: string; verifier: string };

export function packState(s: StateCookie): string {
  return Buffer.from(JSON.stringify(s)).toString("base64url");
}

export function unpackState(raw: string | undefined): StateCookie | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as StateCookie;
    return typeof v.connection === "string" && typeof v.state === "string" && typeof v.verifier === "string" ? v : null;
  } catch {
    return null;
  }
}

// What the Connections page says after a sign-in (?connected= / ?problem=).
export function connectedNotice(names: string[]): string {
  if (!names.length) return "Connected.";
  if (names.length === 1) return `Connected ${names[0]}.`;
  return `Connected ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}.`;
}
