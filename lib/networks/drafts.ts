// An account as a sign-in brings it back, before it's saved.
import type { Platform } from "../platforms";

export type AccountDraft = {
  platform: Platform;
  external_id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  extra: Record<string, unknown>;
};
