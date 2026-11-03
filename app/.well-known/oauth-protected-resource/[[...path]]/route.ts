// RFC 9728: which sign-in /api/mcp takes (lib/social/ai/oauth.ts). The 401
// from /api/mcp points here.
import { originOf, protectedResourceMetadata } from "@/lib/ai/oauth";
import { oauthJson } from "@/lib/ai/respond";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return oauthJson(protectedResourceMetadata(originOf(request)));
}
