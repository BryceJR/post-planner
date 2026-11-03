// RFC 7591: an assistant registers itself (its name and where to send the
// admin back) before asking to connect. Registering grants nothing: the
// admin still has to say yes on /oauth/authorize.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { registerClient } from "@/lib/ai/grants";
import { parseRegistration } from "@/lib/ai/oauth";
import { OAUTH_CORS, oauthError } from "@/lib/ai/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError("invalid_client_metadata", "Send the registration as JSON.", 400);
  }
  const reg = parseRegistration(body);
  if (!reg.ok) return oauthError(reg.error, reg.description, 400);
  try {
    const answer = await registerClient(db(), reg.value);
    return NextResponse.json(answer, { status: 201, headers: { ...OAUTH_CORS, "Cache-Control": "no-store" } });
  } catch (e) {
    return oauthError("server_error", e instanceof Error ? e.message : "Couldn't register.", 500);
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OAUTH_CORS });
}
