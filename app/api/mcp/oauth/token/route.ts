// The OAuth token endpoint: a one-time code (with its PKCE verifier) or a
// refresh token in, an access token and a new refresh token out.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientSecretOk, findClient, tradeCode, tradeRefresh } from "@/lib/ai/grants";
import { clientCredentials, OAUTH_CORS, oauthError, oauthJson, readForm } from "@/lib/ai/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await readForm(request);
  const { clientId, secret } = clientCredentials(request, form);
  let database;
  try {
    database = db();
  } catch (e) {
    return oauthError("server_error", e instanceof Error ? e.message : "The server isn't set up.", 503);
  }
  const client = clientId ? await findClient(database, clientId) : null;
  if (!client || !clientSecretOk(client, secret)) {
    return oauthError("invalid_client", "This app isn't registered here (or its secret is wrong). Connect again.", 401, { "WWW-Authenticate": 'Basic realm="Post Planner"' });
  }
  const grantType = form.grant_type ?? "";
  let result;
  if (grantType === "authorization_code") {
    if (!form.code || !form.code_verifier) return oauthError("invalid_request", "code and code_verifier are required.", 400);
    result = await tradeCode(database, client, { code: form.code, redirectUri: form.redirect_uri ?? null, verifier: form.code_verifier });
  } else if (grantType === "refresh_token") {
    if (!form.refresh_token) return oauthError("invalid_request", "refresh_token is required.", 400);
    result = await tradeRefresh(database, client, { refreshToken: form.refresh_token });
  } else {
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.", 400);
  }
  if ("error" in result) return oauthError(result.error, result.description, 400);
  return oauthJson(result);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OAUTH_CORS });
}
