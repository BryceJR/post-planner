// Your answer on /oauth/authorize: Allow sends the assistant back with a
// one-time code, Cancel with access_denied. Only from this site's own page
// (the browser says where a POST came from), and only when signed in.
import { NextResponse } from "next/server";
import { approve, findClient } from "@/lib/ai/grants";
import { backToApp, checkAuthorize, originOf, resourceAllowedFor } from "@/lib/ai/oauth";
import { signedIn } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function page(status: number, message: string) {
  return new NextResponse(`<!doctype html><meta charset="utf-8"><title>Post Planner</title><p style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">${message}</p>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const origin = originOf(request);
  const from = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((from && from !== origin) || (site && site !== "same-origin")) return page(403, "That didn't come from Post Planner, so nothing was approved.");
  if (!(await signedIn())) return page(401, "Sign in to Post Planner first, then connect again.");

  const form = await request.formData();
  const q: Record<string, string | undefined> = {};
  for (const key of ["client_id", "redirect_uri", "state", "response_type", "code_challenge", "code_challenge_method", "resource"]) {
    const v = form.get(key);
    if (typeof v === "string" && v !== "") q[key] = v;
  }
  const client = q.client_id ? await findClient(db(), q.client_id) : null;
  const check = checkAuthorize(q, client, resourceAllowedFor(origin));
  if (!check.ok) {
    if (check.kind === "page") return page(400, check.message);
    return NextResponse.redirect(backToApp(check.redirectUri, { error: check.error, error_description: check.description, state: check.state, iss: origin }), 303);
  }
  const { value } = check;
  if (form.get("decision") !== "allow") {
    return NextResponse.redirect(backToApp(value.redirectUri, { error: "access_denied", error_description: "The owner said no.", state: value.state, iss: origin }), 303);
  }
  const code = await approve(db(), client!, { redirectUri: value.redirectUri, challenge: value.challenge });
  return NextResponse.redirect(backToApp(value.redirectUri, { code, state: value.state, iss: origin }), 303);
}
