// Connect a network (Accounts): off to its sign-in with a one-time state (and
// a PKCE verifier) in a cookie, checked on the way back.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signedIn } from "@/lib/auth";
import { newPkce, packState, STATE_COOKIE } from "@/lib/connect";
import { authorizeUrlFor, isOAuthConnection } from "@/lib/networks";
import { callbackUrl, CONNECTION_INFO, connectionCredentials, isConnection, siteOrigin } from "@/lib/platforms";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ connection: string }> }) {
  const { connection } = await params;
  if (!(await signedIn())) return NextResponse.redirect(new URL("/login?next=/accounts", request.url));
  const origin = siteOrigin(request.url);
  const back = (q: string) => NextResponse.redirect(`${origin}/accounts?${q}`);
  if (!isConnection(connection) || !isOAuthConnection(connection)) return back("problem=unknown");
  const info = CONNECTION_INFO[connection];
  const creds = connectionCredentials(info);
  if (!creds) return back(`problem=${encodeURIComponent(`${info.name} isn't set up yet: add ${info.envId} and ${info.envSecret} (see below), then redeploy.`)}`);
  const state = crypto.randomUUID();
  const { verifier, challenge } = newPkce();
  const jar = await cookies();
  jar.set(STATE_COOKIE, packState({ connection, state, verifier }), { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https"), path: "/api/callback", maxAge: 600 });
  return NextResponse.redirect(authorizeUrlFor(connection, creds.id, callbackUrl(connection, origin), state, challenge));
}
