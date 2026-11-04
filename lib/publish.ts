// Sending posts. A post is claimed before anything goes (scheduled →
// publishing, in one update), so two runs at once can't both send it; then
// each of its accounts gets it in turn. A network still processing a video
// leaves its account "processing", and the every-minute run checks back.
// Nothing that failed is retried by itself: it shows as failed until someone
// presses Try again (or asks the assistant to), so nothing goes out twice.
// Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStored } from "./media";
import { nextMetricsAt } from "./insights";
import { freshTokens, NETWORKS } from "./networks";
import { NetworkError, type MediaFile, type Step } from "./networks/common";
import { PLATFORM_INFO } from "./platforms";
import { accountsWithTokens, loadPost, saveSettings, updateAccount } from "./store";
import type { AccountWithTokens, Post, PostStatus, PostTarget, TargetStatus } from "./types";

type Db = SupabaseClient;

// A send that started and never said how it went (a run that died).
export const STUCK_AFTER_MS = 15 * 60_000;
// How long a network may keep processing before we stop waiting.
export const PROCESSING_LIMIT_MS = 3 * 3600_000;

// Where a post stands once its accounts have had their go.
export function outcome(targets: Pick<PostTarget, "status">[]): PostStatus {
  if (!targets.length) return "failed";
  if (targets.every((t) => t.status === "published")) return "published";
  if (targets.some((t) => t.status === "publishing" || t.status === "processing")) return "publishing";
  return "failed";
}

// Takes a post for sending, if it's still in one of these states. False when
// someone else (the every-minute run, another click) got there first.
export async function claimPost(db: Db, id: string, from: PostStatus[], nowMs = Date.now()): Promise<boolean> {
  const { data, error } = await db.from("posts").update({ status: "publishing", claimed_at: new Date(nowMs).toISOString() }).eq("id", id).in("status", from).select("id");
  if (error) throw new Error(error.message);
  return !!data?.length;
}

// `now`: this run tried it (false: it went before, or wasn't due for a try)
export type TargetReport = { accountId: string; account: string; status: TargetStatus; url: string | null; error: string | null; note: string | null; now: boolean };
export type PostReport = { postId: string; status: PostStatus; targets: TargetReport[] };

async function setTarget(db: Db, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("post_targets").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

function nameOf(account: AccountWithTokens | undefined) {
  return account ? `${PLATFORM_INFO[account.platform].name} (${account.name})` : "An account";
}

// Each file's bytes read at most once, and only if a network asks.
function mediaFiles(db: Db, post: Post): MediaFile[] {
  const cache = new Map<string, Promise<Uint8Array>>();
  return post.media.map((item) => ({
    item,
    bytes: () => {
      let p = cache.get(item.url);
      if (!p) {
        p = readStored(db, item);
        cache.set(item.url, p);
      }
      return p;
    },
  }));
}

// One account's go: sign-in kept fresh, the network asked, the answer kept.
async function sendTo(db: Db, post: Post, target: PostTarget, account: AccountWithTokens | undefined, media: MediaFile[]): Promise<void> {
  const now = () => new Date().toISOString();
  if (!account || account.status === "off") {
    await setTarget(db, target.id, { status: "failed", error: `${nameOf(account)} was disconnected.`, attempted_at: now(), check_at: null });
    return;
  }
  const continuing = target.status === "processing";
  if (!continuing) await setTarget(db, target.id, { status: "publishing", error: null, attempted_at: now(), progress: {} });
  try {
    const change = await freshTokens(account, async () => (await accountsWithTokens(db, [account.id]))[0] ?? null);
    if (change) {
      await updateAccount(db, account.id, change);
      Object.assign(account, change, { extra: change.extra ?? account.extra });
    }
    const step: Step = await NETWORKS[account.platform].publish({
      account,
      text: (target.body ?? post.body).trim(),
      media,
      settings: target.settings,
      progress: continuing ? target.progress : {},
    });
    if (step.done) {
      const sentAt = now();
      await setTarget(db, target.id, {
        status: "published",
        external_id: step.id,
        external_url: step.url,
        error: null,
        published_at: sentAt,
        metrics_next_at: nextMetricsAt(account.platform, sentAt, null),
        check_at: null,
        progress: step.note ? { note: step.note } : {},
      });
    } else {
      await setTarget(db, target.id, { status: "processing", progress: step.progress, check_at: new Date(Date.now() + step.checkInSeconds * 1000).toISOString() });
    }
    if (account.status !== "connected" || account.last_error) {
      await updateAccount(db, account.id, { status: "connected", last_error: null });
      Object.assign(account, { status: "connected", last_error: null });
    }
  } catch (e) {
    const message = (e instanceof Error ? e.message : "Something went wrong.").slice(0, 2000);
    await setTarget(db, target.id, { status: "failed", error: message, check_at: null });
    if (e instanceof NetworkError && e.reconnect) {
      await updateAccount(db, account.id, { status: "reconnect", last_error: message });
      Object.assign(account, { status: "reconnect", last_error: message });
    }
    console.warn(`post ${post.id} → ${nameOf(account)}: ${message}`);
  }
}

// The post's own status from its accounts', and its report.
async function settle(db: Db, postId: string, tried: Set<string>, accounts: Map<string, AccountWithTokens>): Promise<PostReport> {
  const after = await loadPost(db, postId);
  const targets = after?.targets ?? [];
  const status = outcome(targets);
  const went = targets.map((t) => t.published_at).filter((v): v is string => !!v).sort();
  await db
    .from("posts")
    .update({ status, published_at: went.length ? went[went.length - 1] : null, updated_at: new Date().toISOString(), ...(status === "publishing" ? { claimed_at: new Date().toISOString() } : {}) })
    .eq("id", postId);
  return {
    postId,
    status,
    targets: targets.map((t) => ({
      accountId: t.account_id,
      account: nameOf(accounts.get(t.account_id)),
      status: t.status,
      url: t.external_url,
      error: t.error,
      note: typeof t.progress.note === "string" ? t.progress.note : null,
      now: tried.has(t.id),
    })),
  };
}

// Sends a claimed post to every account it hasn't reached yet.
export async function publishClaimed(db: Db, postId: string): Promise<PostReport> {
  const post = await loadPost(db, postId);
  if (!post) return { postId, status: "failed", targets: [] };
  const todo = post.targets.filter((t) => t.status === "pending" || t.status === "failed");
  const accounts = new Map((await accountsWithTokens(db, post.targets.map((t) => t.account_id))).map((a) => [a.id, a]));
  const media = mediaFiles(db, post);
  for (const target of todo) await sendTo(db, post, target, accounts.get(target.account_id), media);
  return settle(db, postId, new Set(todo.map((t) => t.id)), accounts);
}

// Post it now: a draft, a scheduled post, or one that failed (its accounts
// that already have it are skipped). Null when it's already going.
export async function publishNow(db: Db, id: string): Promise<PostReport | null> {
  if (!(await claimPost(db, id, ["draft", "scheduled", "failed"]))) return null;
  await db.from("posts").update({ scheduled_at: new Date().toISOString() }).eq("id", id).is("scheduled_at", null);
  return publishClaimed(db, id);
}

// Accounts whose network was still processing (a video): checked again.
export async function continueProcessing(db: Db, opts: { nowMs?: number; until: number }): Promise<PostReport[]> {
  const nowMs = opts.nowMs ?? Date.now();
  const { data, error } = await db.from("post_targets").select("id, post_id, attempted_at").eq("status", "processing").lte("check_at", new Date(nowMs).toISOString()).order("check_at").limit(20);
  if (error) throw new Error(error.message);
  const byPost = new Map<string, { id: string; attempted_at: string | null }[]>();
  for (const row of (data ?? []) as { id: string; post_id: string; attempted_at: string | null }[]) byPost.set(row.post_id, [...(byPost.get(row.post_id) ?? []), row]);
  const reports: PostReport[] = [];
  for (const [postId, rows] of byPost) {
    if (Date.now() > opts.until) break;
    const post = await loadPost(db, postId);
    if (!post) continue;
    const accounts = new Map((await accountsWithTokens(db, post.targets.map((t) => t.account_id))).map((a) => [a.id, a]));
    const media = mediaFiles(db, post);
    const ids = new Set(rows.map((r) => r.id));
    for (const target of post.targets.filter((t) => ids.has(t.id))) {
      if (target.attempted_at && nowMs - Date.parse(target.attempted_at) > PROCESSING_LIMIT_MS) {
        await setTarget(db, target.id, { status: "failed", error: `${nameOf(accounts.get(target.account_id))} was still processing it after 3 hours. Look on the account before trying again.`, check_at: null });
        continue;
      }
      await sendTo(db, post, target, accounts.get(target.account_id), media);
    }
    reports.push(await settle(db, postId, ids, accounts));
  }
  return reports;
}

// A run that died partway (a timeout, a deploy) leaves accounts "publishing".
// Those may or may not have it, so they're marked failed with a note to
// check, never sent again by themselves.
export async function rescueStuck(db: Db, nowMs = Date.now()): Promise<number> {
  const before = new Date(nowMs - STUCK_AFTER_MS).toISOString();
  const { data, error } = await db
    .from("post_targets")
    .update({ status: "failed", error: "Stopped partway through sending. It may or may not have gone: look on the account before trying again." })
    .eq("status", "publishing")
    .lt("attempted_at", before)
    .select("post_id");
  if (error) throw new Error(error.message);
  const posts = [...new Set(((data ?? []) as { post_id: string }[]).map((r) => r.post_id))];
  for (const id of posts) await settle(db, id, new Set(), new Map());
  // a claimed post whose accounts never started (the run died before them)
  const { data: idle } = await db.from("posts").select("id").eq("status", "publishing").lt("claimed_at", before).limit(50);
  for (const { id } of (idle ?? []) as { id: string }[]) {
    const post = await loadPost(db, id);
    if (post && !post.targets.some((t) => t.status === "processing" || t.status === "publishing")) {
      await db.from("post_targets").update({ status: "failed", error: "The run stopped before sending this. Try again." }).eq("post_id", id).eq("status", "pending");
      await settle(db, id, new Set(), new Map());
    }
  }
  return posts.length;
}

export type RunReport = { due: number; sent: PostReport[]; continued: PostReport[]; rescued: number; leftForNextRun: number };

// The every-minute run: anything stuck, then what's being processed, then
// everything due, oldest first, one post at a time, until the time's nearly
// up (the rest wait a minute for the next run).
export async function publishDue(db: Db, opts: { nowMs?: number; until?: number } = {}): Promise<RunReport> {
  const nowMs = opts.nowMs ?? Date.now();
  const until = opts.until ?? Date.now() + 180_000;
  const rescued = await rescueStuck(db, nowMs);
  const continued = await continueProcessing(db, { nowMs, until });
  const { data, error } = await db.from("posts").select("id").eq("status", "scheduled").lte("scheduled_at", new Date(nowMs).toISOString()).order("scheduled_at").limit(25);
  if (error) throw new Error(error.message);
  const due = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const sent: PostReport[] = [];
  let left = 0;
  for (const id of due) {
    if (Date.now() > until) {
      left++;
      continue;
    }
    if (!(await claimPost(db, id, ["scheduled"], nowMs))) continue;
    sent.push(await publishClaimed(db, id));
  }
  await saveSettings(db, { last_run_at: new Date(nowMs).toISOString() });
  return { due: due.length, sent, continued, rescued, leftForNextRun: left };
}

// When scheduled posts are waiting and the run hasn't come in 10 minutes.
export function runLooksOff(lastRunAt: string | null, scheduledCount: number, nowMs = Date.now()): boolean {
  if (scheduledCount === 0) return false;
  return !lastRunAt || nowMs - Date.parse(lastRunAt) > 10 * 60_000;
}
