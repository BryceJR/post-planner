// The AI connector: Post Planner as MCP tools, for Grok (grok.com →
// Connectors → New connector → Custom), Claude, ChatGPT or anything else that
// speaks MCP. Add https://<site>/api/mcp; the assistant signs in through
// /oauth/authorize (you say yes once) or sends a key made under Accounts →
// AI assistants. Plain JSON answers, no sessions.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bearerGrant } from "@/lib/ai/grants";
import { originOf, wwwAuthenticate } from "@/lib/ai/oauth";
import { handleBody, INVALID_REQUEST, PARSE_ERROR, rpcError } from "@/lib/mcp/protocol";
import { socialServer } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store", ...headers } });
}

function signIn(request: Request, invalid: boolean) {
  return json(
    { error: invalid ? "invalid_token" : "unauthorized", error_description: invalid ? "That token isn't valid any more. Connect again." : "Connect this assistant to Post Planner first." },
    401,
    { "WWW-Authenticate": wwwAuthenticate(originOf(request), invalid ? "invalid_token" : undefined) }
  );
}

export async function POST(request: Request) {
  const raw = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  if (!raw) return signIn(request, false);
  let database;
  try {
    database = db();
  } catch (e) {
    return json(rpcError(null, -32000, e instanceof Error ? e.message : "The server isn't set up."), 503);
  }
  const caller = await bearerGrant(database, raw);
  if (!caller) return signIn(request, true);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, PARSE_ERROR, "The body must be JSON-RPC 2.0 JSON."), 400);
  }
  if (!body || typeof body !== "object") return json(rpcError(null, INVALID_REQUEST, "Not a JSON-RPC 2.0 message."), 400);
  const answer = await handleBody(socialServer(database, { name: caller.name }), body);
  // notifications and responses get "accepted" and nothing else
  if (answer === null) return new NextResponse(null, { status: 202, headers: CORS });
  return json(answer);
}

// No server-to-client stream and no sessions: GET and DELETE aren't offered.
export function GET() {
  return new NextResponse(null, { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
}

export const DELETE = GET;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
