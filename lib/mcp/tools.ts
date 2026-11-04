// What an AI assistant connected at /api/mcp (Grok, Claude…) can do with
// Post Planner: see the accounts, the calendar and the insights; write,
// schedule, change, post and remove posts. Every save goes through the same
// checks as the composer (lib/store.ts). Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysBetween, isDay } from "../calendar";
import { loadInsights, type Totals } from "../insights";
import { importFromUrl, MEDIA_BUCKET } from "../media";
import { isPlatform, PLATFORM_INFO, SHOWN_PLATFORMS } from "../platforms";
import { publishNow, type PostReport } from "../publish";
import { deletePost, listAccounts, loadPost, loadPostsBetween, loadSettings, loadUndatedDrafts, problemsBeforeSending, savePost, type PostInput, type When } from "../store";
import { POST_STATUSES, type Account, type MediaItem, type Post, type PostStatus } from "../types";
import { parseWhen, sayWhen, todayIn } from "../when";
import { addDays, startOfDayInZone } from "../zone";
import type { Server, Tool, ToolResult } from "./protocol";

type Db = SupabaseClient;
type Args = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function answer(value: unknown): ToolResult {
  return { text: JSON.stringify(value, null, 2) };
}

function problem(message: string, extra: Record<string, unknown> = {}): ToolResult {
  return { text: JSON.stringify({ error: message, ...extra }, null, 2), isError: true };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strings = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);
const networkKey = (n: string) => (n.toLowerCase() === "twitter" ? "x" : n.toLowerCase());

export function accountView(a: Account) {
  const info = PLATFORM_INFO[a.platform];
  return {
    id: a.id,
    network: a.platform,
    name: a.name,
    handle: a.handle,
    status: a.status === "connected" ? "connected" : "needs connecting again (Post Planner → Accounts)",
    max_characters: info.maxChars,
    max_pictures: info.maxImages,
    takes_video: info.maxVideos > 0,
    needs: info.needs === "video" ? "a video" : info.needs === "media" ? "a picture or a video" : "nothing besides words",
  };
}

export function postView(p: Post, accounts: Map<string, Account>, timeZone: string) {
  return {
    id: p.id,
    status: p.status,
    when: p.scheduled_at ? sayWhen(p.scheduled_at, timeZone) : "no day yet (draft)",
    when_iso: p.scheduled_at,
    text: p.body,
    media: p.media.map((m) => ({ kind: m.kind, url: m.url, alt: m.alt })),
    accounts: p.targets.map((t) => {
      const a = accounts.get(t.account_id);
      const hasMetrics = Object.values(t.metrics).some((v) => v !== null && v !== undefined);
      return {
        account_id: t.account_id,
        network: a?.platform ?? null,
        name: a?.name ?? null,
        status: t.status,
        ...(t.body ? { own_text: t.body } : {}),
        ...(Object.keys(t.settings).length ? { settings: t.settings } : {}),
        ...(t.external_url ? { link: t.external_url } : {}),
        ...(t.error ? { error: t.error } : {}),
        ...(typeof t.progress.note === "string" ? { note: t.progress.note } : {}),
        ...(hasMetrics ? { numbers: t.metrics, numbers_from: t.metrics_at } : {}),
      };
    }),
    created_by: p.created_by,
  };
}

function reportLine(r: PostReport) {
  const went = r.targets.filter((t) => t.status === "published" && t.now);
  const before = r.targets.filter((t) => t.status === "published" && !t.now);
  const processing = r.targets.filter((t) => t.status === "processing");
  const failed = r.targets.filter((t) => t.status === "failed");
  const parts: string[] = [];
  if (went.length) parts.push(`Posted to ${went.map((t) => t.account).join(", ")}.`);
  if (before.length) parts.push(`Already on ${before.map((t) => t.account).join(", ")} from before.`);
  if (processing.length) parts.push(`${processing.map((t) => t.account).join(", ")} ${processing.length === 1 ? "is" : "are"} still processing the video; it goes up when that's done.`);
  if (failed.length) parts.push(`Didn't go to ${failed.map((t) => `${t.account} (${t.error ?? "no reason given"})`).join("; ")}.`);
  for (const t of r.targets) if (t.note) parts.push(`${t.account}: ${t.note}`);
  return parts.join(" ") || "Nothing was sent.";
}

// A link already in the media bucket is used as is; anything else is
// downloaded and kept (AI image links often run out).
function ownMedia(url: string, alt: string | null): MediaItem | null {
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const prefix = `${base}/storage/v1/object/public/${MEDIA_BUCKET}/`;
  if (!base || !url.startsWith(prefix)) return null;
  const path = decodeURIComponent(url.slice(prefix.length).split("?")[0]);
  const video = /\.(mp4|mov|webm)$/i.test(path);
  return { url, path, kind: video ? "video" : "image", mime: video ? (path.endsWith(".mov") ? "video/quicktime" : path.endsWith(".webm") ? "video/webm" : "video/mp4") : "image/jpeg", size: null, width: null, height: null, duration: null, alt };
}

async function resolveMedia(db: Db, raw: unknown, existing: MediaItem[] = []): Promise<MediaItem[]> {
  if (!Array.isArray(raw)) return [];
  if (raw.length > 10) throw new Error("A post takes up to 10 pictures, or one video.");
  const out: MediaItem[] = [];
  for (const [i, item] of raw.entries()) {
    const url = typeof item === "string" ? item : str((item as Args | null)?.url);
    const alt = typeof item === "object" && item ? str((item as Args).alt) : null;
    if (!url) throw new Error(`Item ${i + 1} in media has no url.`);
    const known = existing.find((m) => m.url === url);
    if (known) {
      out.push(alt === null ? known : { ...known, alt });
      continue;
    }
    const own = ownMedia(url, alt);
    if (own) {
      out.push(own);
      continue;
    }
    try {
      out.push(await importFromUrl(db, url, alt));
    } catch (e) {
      throw new Error(`Media ${i + 1}: ${e instanceof Error ? e.message : "couldn't be used"}`);
    }
  }
  return out;
}

// Which accounts: by id, or every connected account on the networks named.
function pickAccounts(args: Args, accounts: Account[]): { ids: string[] } | { error: string } | null {
  const ids = strings(args.account_ids);
  const networks = strings(args.networks);
  if (!ids && !networks) return null;
  const chosen = new Set<string>();
  for (const id of ids ?? []) {
    const a = accounts.find((x) => x.id === id);
    if (!a) return { error: `No account has the id ${id}. Use list_accounts for the ids.` };
    chosen.add(a.id);
  }
  for (const n of networks ?? []) {
    const key = networkKey(n);
    if (!isPlatform(key)) return { error: `"${n}" isn't one of the networks (${SHOWN_PLATFORMS.join(", ")}).` };
    const on = accounts.filter((a) => a.platform === key && a.status !== "off");
    if (!on.length) return { error: `No ${PLATFORM_INFO[key].name} account is connected. Connect one in Post Planner → Accounts.` };
    for (const a of on) chosen.add(a.id);
  }
  return { ids: [...chosen] };
}

// Per-account values (own wording, settings): keyed by account id, or by
// network for all its accounts.
function perAccount<T>(raw: unknown, ids: string[], accounts: Account[], accept: (v: unknown) => v is T, what: string): Map<string, T> | { error: string } {
  const out = new Map<string, T>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Args)) {
    if (!accept(value)) continue;
    const network = networkKey(key);
    if (isPlatform(network)) {
      for (const id of ids) if (accounts.find((a) => a.id === id)?.platform === network) out.set(id, value);
    } else if (ids.includes(key)) out.set(key, value);
    else return { error: `${what} has "${key}", which isn't an account this post goes to (or a network name).` };
  }
  return out;
}

const isText = (v: unknown): v is string => typeof v === "string";
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function whenFor(args: Args, timeZone: string): When | { error: string } | null {
  if (args.when === undefined || args.when === null) return null;
  const parsed = parseWhen(str(args.when), timeZone);
  if ("error" in parsed) return parsed;
  return parsed.kind === "schedule" ? { kind: "schedule", at: parsed.at } : parsed.kind === "now" ? { kind: "now" } : { kind: "draft", at: null };
}

const WHEN_HELP =
  'When it goes: "now" to post right away, "draft" to save it without sending, or a date and time like "2026-11-05T09:00" (read in the calendar\'s time zone, which list_accounts gives) or with an offset ("2026-11-05T09:00:00-08:00").';

const MEDIA_SCHEMA = {
  type: "array",
  maxItems: 10,
  description: "Pictures (up to 10) or one video, as public links (JPEG, PNG, WebP, GIF; MP4, MOV, WebM; up to 50 MB). Each is downloaded and kept. YouTube and TikTok need a video; Instagram needs a picture or a video.",
  items: { type: "object", properties: { url: { type: "string" }, alt: { type: "string", description: "A picture's description for people who can't see it." } }, required: ["url"] },
};

const TEXT_FOR_SCHEMA = {
  type: "object",
  additionalProperties: { type: "string" },
  description: 'Different wording for some accounts, e.g. {"x": "a shorter version"} or {"<account id>": "…"}. Keys are account ids or network names.',
};

const SETTINGS_FOR_SCHEMA = {
  type: "object",
  additionalProperties: { type: "object" },
  description:
    'What some networks need besides the words, keyed by network name or account id. youtube: {"title": "…" (max 100), "privacy": "public"|"unlisted"|"private", "tags": ["…"], "madeForKids": false}. tiktok: {"privacy": "PUBLIC_TO_EVERYONE"|"MUTUAL_FOLLOW_FRIENDS"|"FOLLOWER_OF_CREATOR"|"SELF_ONLY", "allowComments": true, "allowDuet": true, "allowStitch": true}. Titles default to the first line of the text.',
};

function totalsView(t: Totals) {
  return Object.fromEntries(Object.entries(t).filter(([, v]) => v !== 0));
}

export function socialServer(db: Db, caller: { name: string }): Server {
  const by = `${caller.name} (AI connector)`.slice(0, 254);
  let timezone: string | null = null;
  const zone = async () => (timezone ??= (await loadSettings(db)).timezone);

  async function finish(post: Post, when: When, warnings: string[]): Promise<ToolResult> {
    const accounts = new Map((await listAccounts(db, { includeOff: true })).map((a) => [a.id, a]));
    const tz = await zone();
    if (when.kind === "now") {
      const report = await publishNow(db, post.id);
      const after = (await loadPost(db, post.id)) ?? post;
      if (!report) return answer({ message: "It's already going out (the every-minute run picked it up).", post: postView(after, accounts, tz) });
      const nothingWent = report.targets.every((t) => t.status === "failed");
      return { ...answer({ message: reportLine(report), post: postView(after, accounts, tz), warnings }), isError: nothingWent };
    }
    const message = when.kind === "schedule" ? `Scheduled for ${sayWhen(post.scheduled_at!, tz)}.` : "Saved as a draft. Nothing was sent.";
    return answer({ message, post: postView(post, accounts, tz), warnings });
  }

  const tools: Tool[] = [
    {
      name: "list_accounts",
      title: "List social accounts",
      description: "The social accounts connected in Post Planner (X, Facebook Pages, Instagram, LinkedIn, YouTube, TikTok, Bluesky), with their ids and each network's limits, plus the calendar's time zone and the time now.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async () => {
        const tz = await zone();
        const accounts = await listAccounts(db);
        return answer({
          calendar_time_zone: tz,
          now: sayWhen(new Date().toISOString(), tz),
          accounts: accounts.map(accountView),
          ...(accounts.length ? {} : { note: "No accounts are connected yet. The owner connects them in Post Planner → Accounts." }),
        });
      },
    },
    {
      name: "list_posts",
      title: "See the posting calendar",
      description: "Posts on the calendar between two days (scheduled, sent, failed and dated drafts, with each account's numbers once sent), plus drafts with no day. Defaults to today and the next 30 days.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "First day, YYYY-MM-DD. Default: today." },
          to: { type: "string", description: "Last day, YYYY-MM-DD. Default: 30 days after from. At most 120 days." },
          status: { type: "array", items: { type: "string", enum: [...POST_STATUSES] }, description: "Only these statuses." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args) => {
        const tz = await zone();
        const from = str(args.from) ?? todayIn(tz);
        const to = str(args.to) ?? addDays(from, 30);
        if (!isDay(from) || !isDay(to)) return problem("from and to are days like 2026-11-05.");
        if (to < from) return problem("to comes before from.");
        if (addDays(from, 120) < to) return problem("Ask for 120 days at most.");
        const status = strings(args.status)?.filter((s): s is PostStatus => (POST_STATUSES as readonly string[]).includes(s));
        const [posts, undated, accounts] = await Promise.all([
          loadPostsBetween(db, startOfDayInZone(from, tz).toISOString(), startOfDayInZone(addDays(to, 1), tz).toISOString(), { status }),
          !status?.length || status.includes("draft") ? loadUndatedDrafts(db) : Promise.resolve([]),
          listAccounts(db, { includeOff: true }),
        ]);
        const byId = new Map(accounts.map((a) => [a.id, a]));
        return answer({ calendar_time_zone: tz, now: sayWhen(new Date().toISOString(), tz), from, to, posts: posts.map((p) => postView(p, byId, tz)), drafts_without_a_day: undated.map((p) => postView(p, byId, tz)) });
      },
    },
    {
      name: "get_post",
      title: "Read one post",
      description: "One post in full: its text, media, when it goes, and how it went on each account (with links to the live posts and their numbers).",
      inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"], additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args) => {
        const id = str(args.post_id) ?? "";
        if (!UUID.test(id)) return problem("post_id is the id from list_posts.");
        const post = await loadPost(db, id);
        if (!post) return problem("No post has that id.");
        const accounts = new Map((await listAccounts(db, { includeOff: true })).map((a) => [a.id, a]));
        return answer(postView(post, accounts, await zone()));
      },
    },
    {
      name: "get_insights",
      title: "See how posts are doing",
      description:
        "Totals for posts sent between two days (views, likes, comments, shares, saves, clicks, reach: whatever each network shares), by network, the best posts, and each account's followers. Defaults to the last 30 days. Numbers refresh hourly for new posts, then less often; X posts' numbers only an hour, a day, a week and a month after they go out (X charges for each read).",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "First day, YYYY-MM-DD. Default: 30 days ago." },
          to: { type: "string", description: "Last day, YYYY-MM-DD. Default: today." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args) => {
        const tz = await zone();
        const to = str(args.to) ?? todayIn(tz);
        const from = str(args.from) ?? addDays(to, -29);
        if (!isDay(from) || !isDay(to)) return problem("from and to are days like 2026-11-05.");
        if (to < from) return problem("to comes before from.");
        if (addDays(from, 366) < to) return problem("Ask for a year at most.");
        const accounts = await listAccounts(db, { includeOff: true });
        const byId = new Map(accounts.map((a) => [a.id, a]));
        const data = await loadInsights(db, { fromIso: startOfDayInZone(from, tz).toISOString(), toIso: startOfDayInZone(addDays(to, 1), tz).toISOString(), days: daysBetween(from, to), timezone: tz, accounts });
        return answer({
          from,
          to,
          total: totalsView(data.total),
          by_network: Object.fromEntries(Object.entries(data.byPlatform).map(([k, v]) => [k, totalsView(v!)])),
          best_posts: data.top.map((t) => ({ post_id: t.postId, network: t.platform, account: byId.get(t.accountId)?.name ?? null, sent: sayWhen(t.publishedAt, tz), text: t.text.slice(0, 200), link: t.url, numbers: t.metrics })),
          followers: data.followers
            .filter((f) => f.now !== null)
            .map((f) => ({ account: byId.get(f.accountId)?.name ?? f.accountId, network: byId.get(f.accountId)?.platform ?? null, followers: f.now, change_in_range: f.before !== null && f.now !== null ? f.now - f.before : null })),
          note: "LinkedIn shares no numbers for personal profiles; X's depend on the developer plan.",
        });
      },
    },
    {
      name: "create_post",
      title: "Write a post",
      description:
        "Writes a post for one or more accounts and posts it now, schedules it, or saves it as a draft. Checks each network's rules first (length, media, titles) and says what to fix. Use text_for to give a network shorter or different wording (X allows 280 characters, Bluesky 300) and settings_for for YouTube titles and TikTok's privacy.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The post's words (a video's description on YouTube, its caption on TikTok)." },
          when: { type: "string", description: WHEN_HELP },
          account_ids: { type: "array", items: { type: "string" }, description: "Accounts to post to, by id (list_accounts)." },
          networks: { type: "array", items: { type: "string", enum: [...SHOWN_PLATFORMS] }, description: "Or: every connected account on these networks." },
          media: MEDIA_SCHEMA,
          text_for: TEXT_FOR_SCHEMA,
          settings_for: SETTINGS_FOR_SCHEMA,
        },
        required: ["text", "when"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async (args) => {
        const tz = await zone();
        const when = whenFor(args, tz);
        if (!when) return problem(`Say when: ${WHEN_HELP}`);
        if ("error" in when) return problem(when.error);
        const accounts = await listAccounts(db);
        const picked = pickAccounts(args, accounts);
        if (picked && "error" in picked) return problem(picked.error);
        const ids = picked?.ids ?? [];
        if (!ids.length && when.kind !== "draft") return problem("Say which accounts: account_ids (from list_accounts) or networks.", { accounts: accounts.map(accountView) });
        const texts = perAccount(args.text_for, ids, accounts, isText, "text_for");
        if (!(texts instanceof Map)) return problem(texts.error);
        const settings = perAccount(args.settings_for, ids, accounts, isObject, "settings_for");
        if (!(settings instanceof Map)) return problem(settings.error);
        let media: MediaItem[];
        try {
          media = await resolveMedia(db, args.media ?? args.images);
        } catch (e) {
          return problem(e instanceof Error ? e.message : "A file couldn't be used.");
        }
        const input: PostInput = { body: str(args.text) ?? "", media, accounts: ids.map((id) => ({ id, body: texts.get(id) ?? null, settings: settings.get(id) ?? {} })), when };
        const saved = await savePost(db, input, { by });
        if (!saved.ok) return problem("The post wasn't saved.", { fix: saved.errors });
        return finish(saved.post, when, saved.warnings);
      },
    },
    {
      name: "update_post",
      title: "Change a post",
      description:
        "Changes a draft, a scheduled post, or one that failed everywhere: its text, media (the list given replaces it; [] removes it all), accounts, own wording, settings or time. Anything left out stays as it is. A post that has gone to any account can't be changed.",
      inputSchema: {
        type: "object",
        properties: {
          post_id: { type: "string" },
          text: { type: "string" },
          when: { type: "string", description: WHEN_HELP },
          account_ids: { type: "array", items: { type: "string" } },
          networks: { type: "array", items: { type: "string", enum: [...SHOWN_PLATFORMS] } },
          media: MEDIA_SCHEMA,
          text_for: TEXT_FOR_SCHEMA,
          settings_for: SETTINGS_FOR_SCHEMA,
        },
        required: ["post_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async (args) => {
        const tz = await zone();
        const id = str(args.post_id) ?? "";
        if (!UUID.test(id)) return problem("post_id is the id from list_posts.");
        const post = await loadPost(db, id);
        if (!post) return problem("No post has that id.");
        const accounts = await listAccounts(db, { includeOff: true });
        const picked = pickAccounts(args, accounts);
        if (picked && "error" in picked) return problem(picked.error);
        const ids = picked?.ids ?? post.targets.map((t) => t.account_id);
        const texts = perAccount(args.text_for, ids, accounts, isText, "text_for");
        if (!(texts instanceof Map)) return problem(texts.error);
        const settings = perAccount(args.settings_for, ids, accounts, isObject, "settings_for");
        if (!(settings instanceof Map)) return problem(settings.error);
        const old = new Map(post.targets.map((t) => [t.account_id, t]));
        let when = whenFor(args, tz);
        if (when && "error" in when) return problem(when.error);
        if (!when) {
          when =
            post.status === "scheduled" && post.scheduled_at
              ? Date.parse(post.scheduled_at) > Date.now()
                ? { kind: "schedule", at: post.scheduled_at }
                : { kind: "now" }
              : { kind: "draft", at: post.scheduled_at };
        }
        let media = post.media;
        const given = args.media ?? args.images;
        if (given !== undefined) {
          try {
            media = await resolveMedia(db, given, post.media);
          } catch (e) {
            return problem(e instanceof Error ? e.message : "A file couldn't be used.");
          }
        }
        const input: PostInput = {
          body: str(args.text) ?? post.body,
          media,
          accounts: ids.map((a) => ({ id: a, body: texts.get(a) ?? old.get(a)?.body ?? null, settings: { ...(old.get(a)?.settings ?? {}), ...(settings.get(a) ?? {}) } })),
          when,
        };
        const saved = await savePost(db, input, { id, by });
        if (!saved.ok) return problem("The post wasn't changed.", { fix: saved.errors });
        return finish(saved.post, when, saved.warnings);
      },
    },
    {
      name: "publish_post_now",
      title: "Post it now",
      description: "Sends a draft or scheduled post right away, or tries a failed post again (accounts that already have it are skipped).",
      inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async (args) => {
        const id = str(args.post_id) ?? "";
        if (!UUID.test(id)) return problem("post_id is the id from list_posts.");
        const post = await loadPost(db, id);
        if (!post) return problem("No post has that id.");
        if (post.status === "published") return problem("That post already went to every account.");
        if (post.status === "publishing") return problem("That post is going out right now.");
        if (!post.targets.length) return problem("That post has no accounts yet. Use update_post to add some.");
        const blocking = await problemsBeforeSending(db, post);
        if (blocking.length) return problem("It can't go out yet. Fix it with update_post first.", { fix: blocking });
        return finish(post, { kind: "now" }, []);
      },
    },
    {
      name: "delete_post",
      title: "Remove a post",
      description: "Removes a post from the calendar. A post that already went stays on the networks; this only removes it from Post Planner (delete it on the network itself).",
      inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      run: async (args) => {
        const id = str(args.post_id) ?? "";
        if (!UUID.test(id)) return problem("post_id is the id from list_posts.");
        const done = await deletePost(db, id);
        return done.ok ? answer({ message: "Removed from the calendar." }) : problem(done.error ?? "It couldn't be removed.");
      },
    },
  ];

  return {
    name: "post-planner",
    title: "Post Planner",
    version: "1.0.0",
    instructions: async () => {
      const tz = await zone();
      const names = SHOWN_PLATFORMS.map((p) => PLATFORM_INFO[p].name).join(", ");
      return [
        `Post Planner is the owner's social media calendar. It posts to their own ${names} accounts and tracks how the posts do.`,
        "Start with list_accounts for the account ids. list_posts shows the calendar, get_insights how posts are doing. create_post writes a post and either posts it now, schedules it, or saves a draft; update_post, publish_post_now and delete_post change what's there.",
        `Times without an offset are read in the calendar's time zone, ${tz}. It's ${sayWhen(new Date().toISOString(), tz)} now.`,
        "Each network has its own limits: X 280 characters (unless the account has Premium), Bluesky 300, Instagram 2,200 and needs a picture or video, YouTube and TikTok need a video. Use text_for and settings_for rather than cutting the post everywhere.",
        "Pictures and videos are public links; they're downloaded and kept (up to 50 MB).",
        'Posting goes out under the owner\'s name: unless they asked to post right away, show them the wording and get a yes before using when="now" or publish_post_now.',
      ].join("\n");
    },
    tools,
  };
}
