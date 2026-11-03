// The rows behind Post Planner (supabase/migrations/0001_init.sql).
import type { Platform } from "./platforms";

export type AccountStatus = "connected" | "reconnect" | "off";

// What the pages and the AI connector see of an account: never its tokens.
export type Account = {
  id: string;
  platform: Platform;
  external_id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  status: AccountStatus;
  last_error: string | null;
  expires_at: string | null;
  connected_at: string;
};

// The same row with what it takes to post as it (server only).
export type AccountWithTokens = Account & {
  access_token: string | null;
  refresh_token: string | null;
  extra: Record<string, unknown>;
};

export const ACCOUNT_COLUMNS = "id, platform, external_id, name, handle, avatar_url, status, last_error, expires_at, connected_at";
export const ACCOUNT_SECRET_COLUMNS = `${ACCOUNT_COLUMNS}, access_token, refresh_token, extra`;

// A picture or video on a post: a public URL in the media bucket (path is
// its place there), so every network can fetch it.
export type MediaKind = "image" | "video";
export type MediaItem = {
  url: string;
  path: string | null;
  kind: MediaKind;
  mime: string;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;   // seconds, for a video (read by the browser)
  alt: string | null;
};

export const POST_STATUSES = ["draft", "scheduled", "publishing", "published", "failed"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const TARGET_STATUSES = ["pending", "publishing", "processing", "published", "failed"] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

// The numbers a network gives back for a post. null: it doesn't say.
export const METRIC_KEYS = ["views", "likes", "comments", "shares", "saves", "clicks", "reach"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Partial<Record<MetricKey, number | null>>;

export type PostTarget = {
  id: string;
  account_id: string;
  body: string | null;                  // this account's own wording; null: the post's
  settings: Record<string, unknown>;    // lib/target-settings.ts
  status: TargetStatus;
  progress: Record<string, unknown>;
  check_at: string | null;
  external_id: string | null;
  external_url: string | null;
  error: string | null;
  attempted_at: string | null;
  published_at: string | null;
  metrics: Metrics;
  metrics_at: string | null;
};

export type Post = {
  id: string;
  body: string;
  media: MediaItem[];
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  targets: PostTarget[];
};

export const POST_COLUMNS = "id, body, media, status, scheduled_at, published_at, created_by, created_at, updated_at";
export const TARGET_COLUMNS = "id, account_id, body, settings, status, progress, check_at, external_id, external_url, error, attempted_at, published_at, metrics, metrics_at";
