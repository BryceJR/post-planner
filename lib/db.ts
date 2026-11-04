// The database, with the project's secret key. Server only: every table is
// closed to the browser (row security on, no policies), so the app's server
// is the only way in.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class SetupError extends Error {}

let client: SupabaseClient | null = null;

// A key as it was pasted: quotes, spaces and line breaks around or inside
// it (which no Supabase key has) are dropped.
export function cleanKey(raw: string | undefined | null): string {
  return (raw ?? "").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "");
}

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL?.trim();
  const key = cleanKey(process.env.SUPABASE_SECRET_KEY);
  if (!url || !key) throw new SetupError("SUPABASE_URL and SUPABASE_SECRET_KEY aren't set. Add them in Vercel → Settings → Environment Variables (README: Setup).");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

// The project a Supabase address is for: https://<ref>.supabase.co
export function projectRef(url: string | undefined | null): string | null {
  return /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec((url ?? "").trim())?.[1] ?? null;
}

// What kind of key SUPABASE_SECRET_KEY holds, told without giving the key
// away (its kind, its length, and for an older-style key, its project and
// role, which aren't secret). For the setup page when the database refuses it.
export function describeKey(raw: string | undefined | null, url: string | undefined | null): string {
  const pasted = raw ?? "";
  const key = cleanKey(pasted);
  if (!key) return "SUPABASE_SECRET_KEY is empty.";
  const notes: string[] = [];
  if (/[•…]|\.\.\./.test(key)) notes.push("it has dots (•) or … in it, so it was copied from the partly hidden text: use the copy icon next to the key instead");
  const ref = projectRef(url);
  if (key.startsWith("sb_publishable_")) return `It's the publishable key (${key.length} characters), not the secret one. Copy the key under "Secret keys".`;
  if (key.startsWith("sb_secret_")) {
    if (key.length < 36) notes.push(`it's only ${key.length} characters, so it looks cut short (a full one is about 41)`);
    return `It's a secret key (sb_secret_…, ${key.length} characters)${notes.length ? `, but ${notes.join("; ")}` : ". If the database still refuses it, it's most likely from a different project: copy it from the project whose address has " + (ref ?? "your project's id") + " in it"}.`;
  }
  if (key.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8")) as { role?: string; ref?: string };
      const parts = [`an older-style key for the "${payload.role ?? "?"}" role of project ${payload.ref ?? "?"}`];
      if (payload.role !== "service_role") parts.push(`it should be the service_role key, not ${payload.role ?? "this one"}`);
      if (ref && payload.ref && payload.ref !== ref) parts.push(`it's from a different project: this app's database is ${ref}`);
      return `It's ${parts.join("; ")}.`;
    } catch {
      return `It starts like an older-style key but can't be read (${key.length} characters): it may be cut short.`;
    }
  }
  return `It doesn't look like a Supabase API key (it starts "${key.slice(0, 3)}…", ${key.length} characters): it may be the JWT secret or a database password. Use the key under API Keys → "Secret keys" (starts with sb_secret_).`;
}

let okUntil = 0;

// Whether the database answers with this key. Checked at most every five
// minutes once it works, so pages don't pay for it.
export async function setupProblem(nowMs = Date.now()): Promise<string | null> {
  if (nowMs < okUntil) return null;
  let database: SupabaseClient;
  try {
    database = db();
  } catch (e) {
    return e instanceof Error ? e.message : "The database isn't set up.";
  }
  const { error } = await database.from("settings").select("id").limit(1);
  if (!error) {
    okUntil = nowMs + 5 * 60_000;
    return null;
  }
  if (/invalid api key|jwt|unauthorized|no api key/i.test(error.message)) {
    return `The database refused SUPABASE_SECRET_KEY ("${error.message}"). ${describeKey(process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_URL)}`;
  }
  if (/relation .* does not exist|schema cache/i.test(error.message)) {
    return `The database is missing Post Planner's tables ("${error.message}"): run supabase/migrations/0001_init.sql in Supabase → SQL Editor.`;
  }
  return `The database didn't answer as expected: ${error.message}`;
}
