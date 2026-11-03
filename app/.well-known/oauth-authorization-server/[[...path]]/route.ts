// RFC 8414: how an AI assistant signs in to the connector at /api/mcp
// (lib/social/ai/oauth.ts). Answered at the root and under any path, since
// clients try both.
import { authorizationServerMetadata, originOf } from "@/lib/ai/oauth";
import { oauthJson } from "@/lib/ai/respond";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return oauthJson(authorizationServerMetadata(originOf(request)));
}
