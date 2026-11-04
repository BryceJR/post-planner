// RFC 7009: an assistant giving back a token it no longer needs. Always 200,
// as the RFC asks, whether or not the token was known.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { revokeToken } from "@/lib/ai/grants";
import { OAUTH_CORS, readForm } from "@/lib/ai/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await readForm(request);
  if (form.token) {
    try {
      await revokeToken(db(), form.token);
    } catch {
      // nothing to say back either way
    }
  }
  return new NextResponse(null, { status: 200, headers: OAUTH_CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OAUTH_CORS });
}
