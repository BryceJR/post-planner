// Reading and writing Post Planner's rows, with the server key. The pages
// and the AI connector both come through here, so a post saved either way is
// checked the same way. Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPost, problemLines, type CheckAccount, type CheckTarget } from "./checks";
import { mediaList } from "./media";
import type { AccountDraft } from "./networks/drafts";
import { isPlatform } from "./platforms";
import { cleanSettings } from "./target-settings";
import {
  ACCOUNT_COLUMNS,
  ACCOUNT_SECRET_COLUMNS,
  POST_COLUMNS,
  TARGET_COLUMNS,
  type Account,
  type AccountWithTokens,
  type MediaItem,
  type Post,
  type PostStatus,
} from "./types";

type Db = SupabaseClient;

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

// ---------- settings ----------

export type Settings = { timezone: string; last_run_at: string | null; last_stats_day: string | null };

export async function loadSettings(db: Db): Promise<Settings> {
  const { data } = await db.from("settings").select("timezone, last_run_at, last_stats_day").eq("id", true).maybeSingle();
  const row = data as Settings | null;
  return { timezone: row?.timezone || DEFAULT_TIMEZONE, last_run_at: row?.last_run_at ?? null, last_stats_day: row?.last_stats_day ?? null };
}

export async function saveSettings(db: Db, patch: Partial<Settings>) {
  const { error } = await db.from("settings").upsert({ id: true, ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

// ---------- accounts ----------

export async function listAccounts(db: Db, opts: { includeOff?: boolean } = {}): Promise<Account[]> {
  let q = db.from("accounts").select(ACCOUNT_COLUMNS).order("platform").order("name");
  if (!opts.includeOff) q = q.neq("status", "off");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Account[]).filter((a) => isPlatform(a.platform));
}

export async function accountsWithTokens(db: Db, ids?: string[]): Promise<AccountWithTokens[]> {
  if (ids && !ids.length) return [];
  let q = db.from("accounts").select(ACCOUNT_SECRET_COLUMNS);
  q = ids ? q.in("id", ids) : q.eq("status", "connected");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as AccountWithTokens[]).map((a) => ({ ...a, extra: a.extra && typeof a.extra === "object" ? a.extra : {} }));
}

// A sign-in's accounts: new ones added, ones seen before connected again
// with the new tokens (their past posts stay theirs).
export async function saveAccounts(db: Db, drafts: AccountDraft[]): Promise<Account[]> {
  if (!drafts.length) return [];
  const now = new Date().toISOString();
  const rows = drafts.map((d) => ({ ...d, name: d.name.trim().slice(0, 200) || d.platform, status: "connected", last_error: null, connected_at: now, updated_at: now }));
  const { data, error } = await db.from("accounts").upsert(rows, { onConflict: "platform,external_id" }).select(ACCOUNT_COLUMNS);
  if (error) throw new Error(error.message);
  return (data ?? []) as Account[];
}

export async function disconnectAccount(db: Db, id: string) {
  const { error } = await db
    .from("accounts")
    .update({ status: "off", access_token: null, refresh_token: null, expires_at: null, last_error: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateAccount(db: Db, id: string, patch: Record<string, unknown>) {
  await db.from("accounts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

// What the checks need to know of an account (Reddit's default subreddit is your profile).
export function checkAccount(a: Account): CheckAccount {
  return { id: a.id, platform: a.platform, name: a.name, status: a.status, username: a.platform === "reddit" ? (a.handle ?? "").replace(/^u\//, "") || null : null };
}

// ---------- posts ----------

type PostRow = Omit<Post, "targets" | "media"> & { media: unknown; targets: Post["targets"] | null };

const POST_SELECT = `${POST_COLUMNS}, targets:post_targets(${TARGET_COLUMNS})`;

function toPost(row: PostRow): Post {
  return {
    ...row,
    media: mediaList(row.media),
    targets: (row.targets ?? []).map((t) => ({ ...t, settings: t.settings ?? {}, progress: t.progress ?? {}, metrics: t.metrics ?? {} })),
  };
}

export async function loadPost(db: Db, id: string): Promise<Post | null> {
  const { data, error } = await db.from("posts").select(POST_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toPost(data as PostRow) : null;
}

// The posts on the calendar between two instants (by when they go, or went).
export async function loadPostsBetween(db: Db, fromIso: string, toIso: string, opts: { status?: PostStatus[]; limit?: number } = {}): Promise<Post[]> {
  let q = db.from("posts").select(POST_SELECT).gte("scheduled_at", fromIso).lt("scheduled_at", toIso).order("scheduled_at").limit(opts.limit ?? 1000);
  if (opts.status?.length) q = q.in("status", opts.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as PostRow[]).map(toPost);
}

// Drafts with no day yet, newest first.
export async function loadUndatedDrafts(db: Db, limit = 50): Promise<Post[]> {
  const { data, error } = await db.from("posts").select(POST_SELECT).eq("status", "draft").is("scheduled_at", null).order("updated_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as PostRow[]).map(toPost);
}

// Posts that didn't (all) go, most recent first.
export async function loadFailedPosts(db: Db, limit = 20): Promise<Post[]> {
  const { data, error } = await db.from("posts").select(POST_SELECT).eq("status", "failed").order("scheduled_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as PostRow[]).map(toPost);
}

// How many posts are waiting for their time (the calendar's "is the run on?" check).
export async function countScheduled(db: Db): Promise<number> {
  const { count, error } = await db.from("posts").select("id", { count: "exact", head: true }).eq("status", "scheduled");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type When = { kind: "draft"; at: string | null } | { kind: "schedule"; at: string } | { kind: "now" };

export type PostInput = {
  body: string;
  media: MediaItem[];
  accounts: { id: string; body: string | null; settings: Record<string, unknown> }[];
  when: When;
};

export type SaveResult = { ok: true; post: Post; warnings: string[] } | { ok: false; errors: string[] };

const EDITABLE: PostStatus[] = ["draft", "scheduled", "failed"];
const MAX_AHEAD_MS = 2 * 366 * 24 * 3600_000;

// Checks a post against the accounts it's for, then saves it: as a draft, for
// a time, or ready to go now (the caller then publishes it, lib/publish.ts).
export async function savePost(db: Db, input: PostInput, opts: { id?: string | null; by: string; nowMs?: number }): Promise<SaveResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const body = input.body.replace(/\r\n/g, "\n");
  if (body.length > 10000) return { ok: false, errors: ["Posts are kept under 10,000 characters."] };
  if (input.media.length > 10) return { ok: false, errors: ["A post takes up to 10 pictures."] };

  const ids = [...new Set(input.accounts.map((a) => a.id))];
  const accounts = await listAccounts(db, { includeOff: true });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) return { ok: false, errors: [`No connected account has the id ${unknown.join(", ")}. List the accounts to see their ids.`] };
  const off = ids.map((id) => byId.get(id)!).filter((a) => a.status === "off");
  if (off.length) return { ok: false, errors: off.map((a) => `${a.name} was disconnected. Connect it again under Accounts.`) };

  let scheduledAt: string | null = null;
  if (input.when.kind === "schedule") {
    const at = Date.parse(input.when.at);
    if (!Number.isFinite(at)) return { ok: false, errors: ["That isn't a date and time."] };
    if (at < nowMs - 60_000) return { ok: false, errors: ["That time has already passed. Pick a later time, or post it now."] };
    if (at > nowMs + MAX_AHEAD_MS) return { ok: false, errors: ["Posts can be scheduled up to two years ahead."] };
    scheduledAt = new Date(at).toISOString();
  } else if (input.when.kind === "draft" && input.when.at) {
    const at = Date.parse(input.when.at);
    if (!Number.isFinite(at)) return { ok: false, errors: ["That isn't a date and time."] };
    scheduledAt = new Date(at).toISOString();
  } else if (input.when.kind === "now") {
    scheduledAt = new Date(nowMs).toISOString();
  }

  const per = new Map(
    input.accounts.map((a) => {
      const own = (a.body ?? "").replace(/\r\n/g, "\n");
      return [a.id, { body: own.trim() ? own : null, settings: cleanSettings(byId.get(a.id)!.platform, a.settings) }] as const;
    })
  );
  for (const [, p] of per) if (p.body && p.body.length > 10000) return { ok: false, errors: ["Each account's wording is kept under 10,000 characters."] };
  const targets: CheckTarget[] = ids.map((id) => ({ account: checkAccount(byId.get(id)!), body: per.get(id)?.body ?? null, settings: per.get(id)?.settings ?? {} }));
  const check = checkPost({ body, media: input.media, targets }, { publishing: input.when.kind !== "draft" });
  if (check.errors.length) return { ok: false, errors: problemLines(check.errors) };

  // Parked as a draft while its accounts change, so the every-minute run
  // can't send it halfway through being saved.
  const nowIso = new Date(nowMs).toISOString();
  let postId = opts.id ?? null;
  if (postId) {
    const existing = await loadPost(db, postId);
    if (!existing) return { ok: false, errors: ["That post isn't there any more."] };
    if (existing.targets.some((t) => t.status !== "pending" && t.status !== "failed")) {
      return { ok: false, errors: ["This post has already gone (or is going) to at least one account, so it can't be changed. Make a new post instead."] };
    }
    const { data, error } = await db.from("posts").update({ status: "draft", updated_at: nowIso }).eq("id", postId).in("status", EDITABLE).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) return { ok: false, errors: ["This post is going out right now, so it can't be changed."] };
    let del = db.from("post_targets").delete().eq("post_id", postId);
    if (ids.length) del = del.not("account_id", "in", `(${ids.join(",")})`);
    const { error: delError } = await del;
    if (delError) throw new Error(delError.message);
  } else {
    const { data, error } = await db.from("posts").insert({ body, media: input.media, status: "draft", scheduled_at: scheduledAt, created_by: opts.by, created_at: nowIso, updated_at: nowIso }).select("id").single();
    if (error) throw new Error(error.message);
    postId = (data as { id: string }).id;
  }

  if (ids.length) {
    const rows = ids.map((id) => ({
      post_id: postId,
      account_id: id,
      body: per.get(id)?.body ?? null,
      settings: per.get(id)?.settings ?? {},
      status: "pending",
      progress: {},
      check_at: null,
      error: null,
      external_id: null,
      external_url: null,
      attempted_at: null,
      published_at: null,
    }));
    const { error } = await db.from("post_targets").upsert(rows, { onConflict: "post_id,account_id" });
    if (error) throw new Error(error.message);
  }

  const status: PostStatus = input.when.kind === "draft" ? "draft" : "scheduled";
  const { error } = await db.from("posts").update({ body, media: input.media, scheduled_at: scheduledAt, status, published_at: null, claimed_at: null, updated_at: nowIso }).eq("id", postId);
  if (error) throw new Error(error.message);
  const post = await loadPost(db, postId);
  if (!post) throw new Error("The post was saved but couldn't be read back.");
  return { ok: true, post, warnings: problemLines(check.warnings) };
}

// What would stop a saved post going out now (a draft can be incomplete):
// checked before Post now / Try again.
export async function problemsBeforeSending(db: Db, post: Post): Promise<string[]> {
  const accounts = new Map((await listAccounts(db, { includeOff: true })).map((a) => [a.id, a]));
  const pending = post.targets.filter((t) => t.status !== "published");
  const targets: CheckTarget[] = pending.flatMap((t) => (accounts.get(t.account_id) ? [{ account: checkAccount(accounts.get(t.account_id)!), body: t.body, settings: t.settings }] : []));
  return problemLines(checkPost({ body: post.body, media: post.media, targets }, { publishing: true }).errors);
}

// Gone from the calendar. A post that already went stays on the networks:
// this only forgets it here. One going out right now can't be removed.
export async function deletePost(db: Db, id: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await db.from("posts").delete().eq("id", id).neq("status", "publishing").select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "That post is going out right now (or is already gone)." };
  return { ok: true };
}
