// One door to every network: start a sign-in, finish it, keep tokens fresh,
// post, and read the numbers back.
import { CONNECTION_INFO, connectionCredentials, type Connection, type Platform } from "../platforms";
import type { AccountWithTokens } from "../types";
import { bluesky } from "./bluesky";
import { NetworkError, needsRefresh, type NetworkModule, type TokenChange } from "./common";
import type { AccountDraft } from "./drafts";
import { linkedin, linkedinAuthorizeUrl, linkedinFinishConnect } from "./linkedin";
import { facebook, instagram, metaAuthorizeUrl, metaFinishConnect } from "./meta";
import { reddit, redditAuthorizeUrl, redditFinishConnect, redditRefresh } from "./reddit";
import { tiktok, tiktokAuthorizeUrl, tiktokFinishConnect, tiktokRefresh } from "./tiktok";
import { x, xAuthorizeUrl, xFinishConnect, xRefresh } from "./x";
import { youtube, youtubeAuthorizeUrl, youtubeFinishConnect, youtubeRefresh } from "./youtube";

export const NETWORKS: Record<Platform, NetworkModule> = { x, facebook, instagram, linkedin, youtube, tiktok, reddit, bluesky };

export type OAuthConnection = Exclude<Connection, "bluesky">;

export function isOAuthConnection(c: Connection): c is OAuthConnection {
  return c !== "bluesky";
}

// Where the sign-in starts. X and Google also take the PKCE challenge.
export function authorizeUrlFor(connection: OAuthConnection, clientId: string, redirect: string, state: string, challenge: string): string {
  switch (connection) {
    case "x":
      return xAuthorizeUrl(clientId, redirect, state, challenge);
    case "meta":
      return metaAuthorizeUrl(clientId, redirect, state);
    case "linkedin":
      return linkedinAuthorizeUrl(clientId, redirect, state);
    case "google":
      return youtubeAuthorizeUrl(clientId, redirect, state, challenge);
    case "tiktok":
      return tiktokAuthorizeUrl(clientId, redirect, state);
    case "reddit":
      return redditAuthorizeUrl(clientId, redirect, state);
  }
}

function credsFor(connection: OAuthConnection) {
  const info = CONNECTION_INFO[connection];
  const creds = connectionCredentials(info);
  if (!creds) throw new NetworkError(`${info.name} isn't set up: add ${info.envId} and ${info.envSecret}.`);
  return creds;
}

export async function finishConnect(connection: OAuthConnection, code: string, redirect: string, verifier: string): Promise<AccountDraft[]> {
  const creds = credsFor(connection);
  switch (connection) {
    case "x":
      return xFinishConnect(creds, code, redirect, verifier);
    case "meta":
      return metaFinishConnect(creds, code, redirect);
    case "linkedin":
      return linkedinFinishConnect(creds, code, redirect);
    case "google":
      return youtubeFinishConnect(creds, code, redirect, verifier);
    case "tiktok":
      return tiktokFinishConnect(creds, code, redirect);
    case "reddit":
      return redditFinishConnect(creds, code, redirect);
  }
}

const REFRESHERS: Partial<Record<Platform, { connection: OAuthConnection; refresh: (creds: { id: string; secret: string }, token: string) => Promise<TokenChange> }>> = {
  x: { connection: "x", refresh: xRefresh },
  youtube: { connection: "google", refresh: youtubeRefresh },
  tiktok: { connection: "tiktok", refresh: tiktokRefresh },
  reddit: { connection: "reddit", refresh: redditRefresh },
};

// Fresh tokens before posting or reading numbers, where the network's run
// out (X: two hours; YouTube and Reddit: an hour; TikTok: a day). `reread`
// fetches the account again, in case another run refreshed it a moment ago
// (X's old refresh token stops working then).
export async function freshTokens(account: AccountWithTokens, reread: () => Promise<AccountWithTokens | null>): Promise<TokenChange | null> {
  const r = REFRESHERS[account.platform];
  if (!r || !needsRefresh(account.expires_at)) return null;
  const name = CONNECTION_INFO[r.connection].name;
  if (!account.refresh_token) throw new NetworkError(`${name}'s sign-in ran out. Connect ${name} again.`, { reconnect: true });
  try {
    return await r.refresh(credsFor(r.connection), account.refresh_token);
  } catch (e) {
    const now = await reread();
    if (now?.access_token && now.access_token !== account.access_token && !needsRefresh(now.expires_at)) {
      return { access_token: now.access_token, refresh_token: now.refresh_token, expires_at: now.expires_at };
    }
    if (e instanceof NetworkError) throw new NetworkError(`${name}'s sign-in couldn't be renewed (${e.message}). Connect ${name} again.`, { reconnect: e.reconnect });
    throw e;
  }
}
