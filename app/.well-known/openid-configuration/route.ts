// Some MCP clients look for the sign-in here first: the same document as
// /.well-known/oauth-authorization-server.
import { authorizationServerMetadata, originOf } from "@/lib/ai/oauth";
import { oauthJson } from "@/lib/ai/respond";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return oauthJson(authorizationServerMetadata(originOf(request)));
}
