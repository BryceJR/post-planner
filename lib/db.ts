// The database, with the project's secret key. Server only: every table is
// closed to the browser (row security on, no policies), so the app's server
// is the only way in.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class SetupError extends Error {}

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new SetupError("SUPABASE_URL and SUPABASE_SECRET_KEY aren't set. Add them in Vercel → Settings → Environment Variables (README: Setup).");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
