// OAuth's answers: JSON, never cached, open to browser-based clients.
import { NextResponse } from "next/server";

export const OAUTH_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function oauthError(error: string, description: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json({ error, error_description: description }, { status, headers: { ...OAUTH_CORS, "Cache-Control": "no-store", ...headers } });
}

export function oauthJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { ...OAUTH_CORS, "Cache-Control": "no-store", Pragma: "no-cache" } });
}

// The form fields of a token or revoke request (form-encoded, or JSON from
// clients that send that), and the client's credentials from either place.
export async function readForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(body ?? {})) if (typeof v === "string") out[k] = v;
    } else {
      const params = new URLSearchParams(await request.text());
      for (const [k, v] of params) out[k] = v;
    }
  } catch {
    // an empty or broken body: the checks below say what's missing
  }
  return out;
}

export function clientCredentials(request: Request, form: Record<string, string>): { clientId: string | null; secret: string | null } {
  const basic = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (basic) {
    try {
      const decoded = Buffer.from(basic, "base64").toString("utf8");
      const i = decoded.indexOf(":");
      if (i > 0) return { clientId: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) };
    } catch {
      // fall through to the form
    }
  }
  return { clientId: form.client_id ?? null, secret: form.client_secret ?? null };
}
