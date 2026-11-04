// Insights: each sent post's numbers (views, likes, comments, shares,
// saves, clicks, reach, whatever its network shares), read often while the
// post is new and less often after; and each account's followers once a day
// (X: once a week). The every-minute run does a little at a time.
import type { SupabaseClient } from "@supabase/supabase-js";
import { freshTokens, NETWORKS } from "./networks";
import { NetworkError } from "./networks/common";
import type { Platform } from "./platforms";
import { accountsWithTokens, loadPostsBetween, saveSettings, updateAccount } from "./store";
import { METRIC_KEYS, type Account, type AccountWithTokens, type MetricKey, type Metrics, type Post } from "./types";
import { dayInZone } from "./zone";

type Db = SupabaseClient;

const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const TRACK_FOR_MS = 90 * DAY;

// X charges for every read (and for every follower count), so an X post's
// numbers are read four times, at these ages, and X followers once a week.
export const X_READS_AT = [HOUR, DAY, 7 * DAY, 30 * DAY];
export const X_FOLLOWERS_EVERY_DAYS = 7;

// When a post's numbers are read next, after reading them at `lastMs` (null:
// it was just sent). Most networks: hourly on its first two days, every six
// hours for two weeks, then daily until 90 days. X: at the ages above. Null:
// no more reads.
export function nextMetricsAt(platform: Platform, publishedAt: string, lastMs: number | null): string | null {
  const sent = Date.parse(publishedAt);
  if (Number.isNaN(sent)) return null;
  if (platform === "x") {
    const after = lastMs ?? sent;
    const next = X_READS_AT.map((age) => sent + age).find((at) => at > after);
    return next === undefined ? null : new Date(next).toISOString();
  }
  if (lastMs === null) return new Date(sent + HOUR).toISOString();
  const age = lastMs - sent;
  const next = lastMs + (age < 2 * DAY ? HOUR : age < 14 * DAY ? 6 * HOUR : DAY);
  return next - sent > TRACK_FOR_MS ? null : new Date(next).toISOString();
}

// New numbers over old, keeping what the network didn't say this time.
export function mergeMetrics(old: Metrics, fresh: Metrics): Metrics {
  const out: Metrics = { ...old };
  for (const k of METRIC_KEYS) if (fresh[k] !== undefined && fresh[k] !== null) out[k] = fresh[k];
  return out;
}

type Due = { id: string; account_id: string; external_id: string; published_at: string; metrics: Metrics | null };

async function fresh(db: Db, account: AccountWithTokens): Promise<AccountWithTokens> {
  const change = await freshTokens(account, async () => (await accountsWithTokens(db, [account.id]))[0] ?? null);
  if (!change) return account;
  await updateAccount(db, account.id, change);
  return { ...account, ...change, extra: change.extra ?? account.extra };
}

export async function refreshMetrics(db: Db, opts: { nowMs?: number; until: number; max?: number }): Promise<number> {
  const nowMs = opts.nowMs ?? Date.now();
  const { data, error } = await db
    .from("post_targets")
    .select("id, account_id, external_id, published_at, metrics")
    .eq("status", "published")
    .not("external_id", "is", null)
    .lte("metrics_next_at", new Date(nowMs).toISOString())
    .order("metrics_next_at", { ascending: true })
    .limit(opts.max ?? 40);
  if (error) throw new Error(error.message);
  const due = (data ?? []) as Due[];
  if (!due.length) return 0;
  const accounts = new Map((await accountsWithTokens(db, [...new Set(due.map((t) => t.account_id))])).map((a) => [a.id, a]));
  let done = 0;
  for (const t of due) {
    if (Date.now() > opts.until) break;
    let account = accounts.get(t.account_id);
    const reader = account ? NETWORKS[account.platform].metrics : undefined;
    // the next read is set before this one, so a read that fails or hangs
    // waits its turn instead of coming back every minute
    const next = account && reader ? nextMetricsAt(account.platform, t.published_at, Date.now()) : null;
    await db.from("post_targets").update({ metrics_next_at: next }).eq("id", t.id);
    if (!account || account.status !== "connected" || !reader) continue;
    try {
      account = await fresh(db, account);
      accounts.set(account.id, account);
      const m = await reader(account, t.external_id);
      const stamp = new Date().toISOString();
      if (m) {
        const merged = mergeMetrics(t.metrics ?? {}, m);
        await db.from("post_targets").update({ metrics: merged, metrics_at: stamp }).eq("id", t.id);
        await db.from("metric_snapshots").insert({ target_id: t.id, ...Object.fromEntries(METRIC_KEYS.map((k) => [k, merged[k] ?? null])) });
      } else {
        await db.from("post_targets").update({ metrics_at: stamp }).eq("id", t.id);
      }
      done++;
    } catch (e) {
      // numbers are a nicety: they're read again at the next time
      if (e instanceof NetworkError && e.reconnect) {
        await updateAccount(db, account.id, { status: "reconnect", last_error: e.message.slice(0, 2000) });
        accounts.set(account.id, { ...account, status: "reconnect" });
      }
    }
  }
  return done;
}

// Followers, once a day (in the calendar's time zone); X, once a week.
export async function refreshFollowers(db: Db, opts: { timezone: string; lastDay: string | null; nowMs?: number; until: number }): Promise<number> {
  const nowMs = opts.nowMs ?? Date.now();
  const today = dayInZone(nowMs, opts.timezone);
  if (opts.lastDay === today) return 0;
  await saveSettings(db, { last_stats_day: today });
  const accounts = await accountsWithTokens(db);
  const counted = await countedSince(db, accounts.filter((a) => a.platform === "x").map((a) => a.id), dayInZone(nowMs - (X_FOLLOWERS_EVERY_DAYS - 1) * DAY, opts.timezone));
  let done = 0;
  for (let account of accounts) {
    if (Date.now() > opts.until) break;
    const reader = NETWORKS[account.platform].followers;
    if (!reader || counted.has(account.id)) continue;
    try {
      account = await fresh(db, account);
      const n = await reader(account);
      if (n !== null) {
        await db.from("account_stats").upsert({ account_id: account.id, day: today, followers: n }, { onConflict: "account_id,day" });
        done++;
      }
    } catch {
      // next time, then
    }
  }
  return done;
}

// Which of these accounts have a follower count from `day` on.
async function countedSince(db: Db, ids: string[], day: string): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await db.from("account_stats").select("account_id").in("account_id", ids).gte("day", day).not("followers", "is", null);
  return new Set(((data ?? []) as { account_id: string }[]).map((r) => r.account_id));
}

// ---------- the Insights page and the assistant ----------

export type Totals = Record<MetricKey, number> & { posts: number };

export function emptyTotals(): Totals {
  return { posts: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, reach: 0 };
}

// Likes, comments, shares and saves: what people did, not just saw.
export function engagement(m: Metrics): number {
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
}

export type TopPost = { postId: string; targetId: string; accountId: string; platform: Platform; text: string; publishedAt: string; url: string | null; metrics: Metrics; engagement: number };
export type FollowerLine = { accountId: string; now: number | null; before: number | null; day: string | null };

export type Insights = {
  byPlatform: Partial<Record<Platform, Totals>>;
  total: Totals;
  byDay: { day: string; views: number; engagement: number; posts: number }[];
  top: TopPost[];
  followers: FollowerLine[];
};

// The numbers for posts sent between two days (in the zone), added up.
export function summarize(posts: Post[], accounts: Map<string, Pick<Account, "platform">>, days: string[], timeZone: string): Omit<Insights, "followers"> {
  const total = emptyTotals();
  const byPlatform: Partial<Record<Platform, Totals>> = {};
  const byDay = new Map(days.map((d) => [d, { day: d, views: 0, engagement: 0, posts: 0 }]));
  const top: TopPost[] = [];
  for (const post of posts) {
    for (const t of post.targets) {
      if (t.status !== "published" || !t.published_at) continue;
      const platform = accounts.get(t.account_id)?.platform;
      if (!platform) continue;
      const totals = (byPlatform[platform] ??= emptyTotals());
      for (const bucket of [total, totals]) {
        bucket.posts++;
        for (const k of METRIC_KEYS) bucket[k] += t.metrics[k] ?? 0;
      }
      const row = byDay.get(dayInZone(t.published_at, timeZone));
      if (row) {
        row.posts++;
        row.views += t.metrics.views ?? 0;
        row.engagement += engagement(t.metrics);
      }
      top.push({ postId: post.id, targetId: t.id, accountId: t.account_id, platform, text: (t.body ?? post.body).trim(), publishedAt: t.published_at, url: t.external_url, metrics: t.metrics, engagement: engagement(t.metrics) });
    }
  }
  top.sort((a, b) => b.engagement - a.engagement || (b.metrics.views ?? 0) - (a.metrics.views ?? 0));
  return { total, byPlatform, byDay: [...byDay.values()], top: top.slice(0, 10) };
}

export async function loadInsights(db: Db, opts: { fromIso: string; toIso: string; days: string[]; timezone: string; accounts: Account[] }): Promise<Insights> {
  const posts = await loadPostsBetween(db, opts.fromIso, opts.toIso, { status: ["published", "failed", "publishing"] });
  const summary = summarize(posts, new Map(opts.accounts.map((a) => [a.id, a])), opts.days, opts.timezone);
  const first = opts.days[0];
  const { data } = await db.from("account_stats").select("account_id, day, followers").gte("day", first).order("day");
  const rows = (data ?? []) as { account_id: string; day: string; followers: number | null }[];
  const followers: FollowerLine[] = opts.accounts.map((a) => {
    const mine = rows.filter((r) => r.account_id === a.id && r.followers !== null);
    return { accountId: a.id, now: mine.at(-1)?.followers ?? null, before: mine.length > 1 ? mine[0].followers : null, day: mine.at(-1)?.day ?? null };
  });
  return { ...summary, followers };
}
