// The networks Post Planner posts to, and what each one takes. Pure, so the
// composer, the checks, the AI connector and the tests agree.

export const PLATFORMS = ["x", "facebook", "instagram", "linkedin", "youtube", "tiktok", "reddit", "bluesky"] as const;
export type Platform = (typeof PLATFORMS)[number];

// How each network is connected: one sign-in can bring several accounts
// (a Facebook sign-in brings every Page and the Instagram accounts linked to
// them). Bluesky takes an app password instead of a sign-in.
export const CONNECTIONS = ["x", "meta", "linkedin", "google", "tiktok", "reddit", "bluesky"] as const;
export type Connection = (typeof CONNECTIONS)[number];

export type PlatformInfo = {
  key: Platform;
  name: string;
  connection: Connection;
  maxChars: number;
  // how the network counts: X weighs links and wide characters, Bluesky
  // counts what you see (an emoji is one), the rest count characters
  counting: "x" | "graphemes" | "chars";
  // X lets Premium accounts go past 280, so a long X post is a warning, not a stop
  overLimitIsWarning: boolean;
  maxImages: number;
  maxVideos: number;           // 0: videos aren't sent there (yet)
  needs: "nothing" | "media" | "video";
  maxVideoSeconds: number | null;
};

export const PLATFORM_INFO: Record<Platform, PlatformInfo> = {
  x: { key: "x", name: "X", connection: "x", maxChars: 280, counting: "x", overLimitIsWarning: true, maxImages: 4, maxVideos: 1, needs: "nothing", maxVideoSeconds: 140 },
  facebook: { key: "facebook", name: "Facebook", connection: "meta", maxChars: 63206, counting: "chars", overLimitIsWarning: false, maxImages: 10, maxVideos: 1, needs: "nothing", maxVideoSeconds: null },
  instagram: { key: "instagram", name: "Instagram", connection: "meta", maxChars: 2200, counting: "chars", overLimitIsWarning: false, maxImages: 10, maxVideos: 1, needs: "media", maxVideoSeconds: 900 },
  linkedin: { key: "linkedin", name: "LinkedIn", connection: "linkedin", maxChars: 3000, counting: "chars", overLimitIsWarning: false, maxImages: 9, maxVideos: 1, needs: "nothing", maxVideoSeconds: 1800 },
  youtube: { key: "youtube", name: "YouTube", connection: "google", maxChars: 5000, counting: "chars", overLimitIsWarning: false, maxImages: 0, maxVideos: 1, needs: "video", maxVideoSeconds: null },
  tiktok: { key: "tiktok", name: "TikTok", connection: "tiktok", maxChars: 2200, counting: "chars", overLimitIsWarning: false, maxImages: 0, maxVideos: 1, needs: "video", maxVideoSeconds: 600 },
  reddit: { key: "reddit", name: "Reddit", connection: "reddit", maxChars: 40000, counting: "chars", overLimitIsWarning: false, maxImages: 1, maxVideos: 0, needs: "nothing", maxVideoSeconds: null },
  bluesky: { key: "bluesky", name: "Bluesky", connection: "bluesky", maxChars: 300, counting: "graphemes", overLimitIsWarning: false, maxImages: 4, maxVideos: 0, needs: "nothing", maxVideoSeconds: null },
};

// Networks that can't be connected any more, so they're left out of the
// Accounts page, the AI connector and the docs. Their code stays, in case
// that changes. Reddit stopped taking new API apps on October 31, 2026.
export const HIDDEN_PLATFORMS: readonly Platform[] = ["reddit"];
export const SHOWN_PLATFORMS: readonly Platform[] = PLATFORMS.filter((p) => !HIDDEN_PLATFORMS.includes(p));

export function isHiddenConnection(c: Connection): boolean {
  return CONNECTION_INFO[c].platforms.every((p) => HIDDEN_PLATFORMS.includes(p));
}

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

export function isConnection(value: unknown): value is Connection {
  return typeof value === "string" && (CONNECTIONS as readonly string[]).includes(value);
}

export type ConnectionInfo = {
  key: Connection;
  name: string;
  platforms: Platform[];
  envId: string | null;      // the app's id and secret, from the network's developer site
  envSecret: string | null;
  setup: string;             // where the developer app is made
  caveat: string | null;     // what the network holds back until it reviews the app
};

export const CONNECTION_INFO: Record<Connection, ConnectionInfo> = {
  x: {
    key: "x",
    name: "X",
    platforms: ["x"],
    envId: "X_CLIENT_ID",
    envSecret: "X_CLIENT_SECRET",
    setup:
      "developer.x.com → Projects & Apps → your app → User authentication settings: OAuth 2.0, type Web App, permissions Read and write. Add the callback URL below, then copy the OAuth 2.0 Client ID and Client Secret (Keys and tokens).",
    caveat:
      "X charges for each post and each read: buy credits in the X Developer Console. To keep that small, Post Planner reads an X post's numbers four times (an hour, a day, a week and a month after it goes out) and the followers once a week.",
  },
  meta: {
    key: "meta",
    name: "Facebook & Instagram",
    platforms: ["facebook", "instagram"],
    envId: "META_APP_ID",
    envSecret: "META_APP_SECRET",
    setup:
      "developers.facebook.com → My Apps → Create app → the use cases for managing a Page and for Instagram content (Instagram must be a business or creator account linked to the Page). Under Facebook Login → Settings add the callback URL below. App settings → Basic has the App ID and App secret; add your privacy policy's address there and switch the app to Live so the posts are public.",
    caveat: null,
  },
  linkedin: {
    key: "linkedin",
    name: "LinkedIn",
    platforms: ["linkedin"],
    envId: "LINKEDIN_CLIENT_ID",
    envSecret: "LINKEDIN_CLIENT_SECRET",
    setup:
      "linkedin.com/developers → Create app → Products: Sign In with LinkedIn using OpenID Connect, and Share on LinkedIn. Auth → add the callback URL below. For company pages (and their numbers), LinkedIn must approve the Community Management API for the app; then set LINKEDIN_PAGES=1.",
    caveat: "LinkedIn shares no numbers for posts on a personal profile, and its sign-in lasts 60 days.",
  },
  google: {
    key: "google",
    name: "YouTube",
    platforms: ["youtube"],
    envId: "GOOGLE_CLIENT_ID",
    envSecret: "GOOGLE_CLIENT_SECRET",
    setup:
      "console.cloud.google.com → a new project → APIs & Services: enable YouTube Data API v3 → OAuth consent screen (External; add yourself as a test user) → Credentials → OAuth client ID, type Web application, with the callback URL below as an authorized redirect URI.",
    caveat: "Until Google audits the app (a free form for YouTube API Services; weeks to months), every video it uploads is private.",
  },
  tiktok: {
    key: "tiktok",
    name: "TikTok",
    platforms: ["tiktok"],
    envId: "TIKTOK_CLIENT_KEY",
    envSecret: "TIKTOK_CLIENT_SECRET",
    setup:
      "developers.tiktok.com → Manage apps → Connect an app → add Login Kit (with the callback URL below as a redirect URI) and Content Posting API (Direct Post on). Scopes: user.info.basic, user.info.stats, video.list, video.publish. Copy the Client key and Client secret.",
    caveat: "Until TikTok audits the app, it can only post to a private TikTok account, visible only to you.",
  },
  reddit: {
    key: "reddit",
    name: "Reddit",
    platforms: ["reddit"],
    envId: "REDDIT_CLIENT_ID",
    envSecret: "REDDIT_CLIENT_SECRET",
    setup:
      "reddit.com/prefs/apps → create another app → type web app, with the callback URL below as the redirect uri. The id is under the app's name; the secret is labeled secret.",
    caveat: "Reddit stopped taking new API apps on October 31, 2026, so it's hidden (HIDDEN_PLATFORMS above).",
  },
  bluesky: {
    key: "bluesky",
    name: "Bluesky",
    platforms: ["bluesky"],
    envId: null,
    envSecret: null,
    setup: "Bluesky → Settings → Privacy and security → App passwords → Add app password. Paste your handle and that password below (never your real password).",
    caveat: null,
  },
};

export function connectionCredentials(c: ConnectionInfo, env: Record<string, string | undefined> = process.env): { id: string; secret: string } | null {
  if (!c.envId || !c.envSecret) return null;
  const id = env[c.envId]?.trim();
  const secret = env[c.envSecret]?.trim();
  return id && secret ? { id, secret } : null;
}

// The app's own address: APP_URL, else this request's.
export function siteOrigin(requestUrl: string, env: Record<string, string | undefined> = process.env) {
  return env.APP_URL?.trim().replace(/\/$/, "") || new URL(requestUrl).origin;
}

// Where a network sends you back after signing in. Registered on the
// network's developer site exactly like this.
export function callbackUrl(connection: Connection, origin: string) {
  return `${origin.replace(/\/$/, "")}/api/callback/${connection}`;
}
