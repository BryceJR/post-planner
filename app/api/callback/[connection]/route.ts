// The network sends you back here with a code: traded for tokens, and every
// account it brings (an X account; each Facebook Page and its Instagram; a
// LinkedIn profile and pages; a YouTube channel; a TikTok or Reddit account)
// is saved or connected again.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signedIn } from "@/lib/auth";
import { connectedNotice, STATE_COOKIE, unpackState } from "@/lib/connect";
import { db } from "@/lib/db";
import { finishConnect, isOAuthConnection } from "@/lib/networks";
import { callbackUrl, CONNECTION_INFO, isConnection, PLATFORM_INFO, siteOrigin } from "@/lib/platforms";
import { saveAccounts } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ connection: string }> }) {
  const { connection } = await params;
  const url = new URL(request.url);
  const origin = siteOrigin(request.url);
  const back = (q: string) => NextResponse.redirect(`${origin}/accounts?${q}`);
  if (!(await signedIn())) return NextResponse.redirect(new URL("/login?next=/accounts", request.url));
  if (!isConnection(connection) || !isOAuthConnection(connection)) return back("problem=unknown");
  const name = CONNECTION_INFO[connection].name;
  const jar = await cookies();
  const saved = unpackState(jar.get(STATE_COOKIE)?.value);
  jar.delete({ name: STATE_COOKIE, path: "/api/callback" });
  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (denied) return back(`problem=${encodeURIComponent(`${name} didn't connect: ${denied}`)}`);
  const code = url.searchParams.get("code");
  if (!code || !saved || saved.connection !== connection || url.searchParams.get("state") !== saved.state) {
    return back(`problem=${encodeURIComponent(`${name} didn't connect: the sign-in ran out or was started in another window. Try again.`)}`);
  }
  try {
    const drafts = await finishConnect(connection, code, callbackUrl(connection, origin), saved.verifier);
    const accounts = await saveAccounts(db(), drafts);
    return back(`connected=${encodeURIComponent(connectedNotice(accounts.map((a) => `${PLATFORM_INFO[a.platform].name} (${a.name})`)))}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't finish connecting.";
    console.warn(`connect ${connection}: ${message}`);
    return back(`problem=${encodeURIComponent(`${name} didn't connect: ${message}`)}`);
  }
}
