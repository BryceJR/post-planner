import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { Notice } from "@/components/ui/notice";
import { isDay } from "@/lib/calendar";
import { checkPost, problemLines } from "@/lib/checks";
import { db } from "@/lib/db";
import { PLATFORM_INFO } from "@/lib/platforms";
import { checkAccount, listAccounts, loadPost, loadSettings } from "@/lib/store";
import { METRIC_KEYS, type Post } from "@/lib/types";
import { sayWhen, todayIn, wallInput } from "@/lib/when";
import { dayInZone } from "@/lib/zone";
import { deletePostAction, postNowAction } from "../../actions";
import { compact, NetworkMark, PostStatusChip, TARGET_STATUS_LABEL } from "../../ui";
import { PostForm, type PostFormInitial } from "../post-form";

export const metadata: Metadata = { title: "Post" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const METRIC_LABEL = { views: "views", likes: "likes", comments: "comments", shares: "shares", saves: "saves", clicks: "clicks", reach: "reached" } as const;

// the first whole hour at least 15 minutes away
function nextHour(nowMs: number, tz: string) {
  return wallInput(new Date(Math.ceil((nowMs + 15 * 60_000) / 3_600_000) * 3_600_000).toISOString(), tz);
}

function editable(post: Post) {
  return ["draft", "scheduled", "failed"].includes(post.status) && post.targets.every((t) => t.status === "pending" || t.status === "failed");
}

function now() {
  return Date.now();
}

// /posts/new (?day=2026-11-05 starts on that day) and /posts/<id>: write a
// post, or see how one went.
export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ day?: string; saved?: string; problem?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const [{ timezone: tz }, accounts] = await Promise.all([loadSettings(db()), listAccounts(db(), { includeOff: true })]);
  const usable = accounts.filter((a) => a.status !== "off");
  const byId = new Map(accounts.map((a) => [a.id, a]));

  let post: Post | null = null;
  if (id !== "new") {
    if (!UUID.test(id)) notFound();
    post = await loadPost(db(), id);
    if (!post) notFound();
  }

  const nowMs = now();
  const initial: PostFormInitial = post
    ? {
        postId: post.id,
        body: post.body,
        media: post.media,
        selected: post.targets.map((t) => t.account_id),
        own: Object.fromEntries(post.targets.filter((t) => t.body).map((t) => [t.account_id, t.body!])),
        settings: Object.fromEntries(post.targets.map((t) => [t.account_id, t.settings])),
        when: post.status === "scheduled" && post.scheduled_at && Date.parse(post.scheduled_at) > nowMs ? "schedule" : "draft",
        at: post.scheduled_at ? wallInput(post.scheduled_at, tz) : "",
      }
    : {
        postId: null,
        body: "",
        media: [],
        selected: usable.length === 1 ? [usable[0].id] : [],
        own: {},
        settings: {},
        when: "schedule",
        at: query.day && isDay(query.day) && query.day > todayIn(tz) ? `${query.day}T09:00` : nextHour(nowMs, tz),
      };

  const checks = post
    ? checkPost(
        {
          body: post.body,
          media: post.media,
          targets: post.targets.flatMap((t) => (byId.get(t.account_id) ? [{ account: checkAccount(byId.get(t.account_id)!), body: t.body, settings: t.settings }] : [])),
        },
        { publishing: post.status === "scheduled" }
      )
    : null;
  const month = post?.scheduled_at ? dayInZone(post.scheduled_at, tz).slice(0, 7) : "";
  const whenWord = post ? { published: "Went", draft: "Pencilled in for", failed: "Was due", publishing: "Going out", scheduled: "Goes" }[post.status] : "";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={month ? `/?month=${month}` : "/"} className="text-sm font-semibold text-ink-soft underline-offset-4 hover:underline">
          ← Calendar
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
          {post ? "Post" : "New post"}
          {post && <PostStatusChip status={post.status} />}
        </h1>
        {post && (
          <p className="mt-1 text-sm text-ink-soft">
            {post.scheduled_at ? `${whenWord} ${sayWhen(post.scheduled_at, tz)}` : "No day yet"}
            {post.created_by ? ` · by ${post.created_by}` : ""}
          </p>
        )}
      </div>

      {query.saved === "schedule" && post?.scheduled_at && <Notice>Scheduled for {sayWhen(post.scheduled_at, tz)}.</Notice>}
      {query.saved === "draft" && <Notice>Saved as a draft. Nothing was sent.</Notice>}
      {query.saved === "now" && post && (
        <Notice kind={post.status === "failed" ? "error" : "info"}>
          {post.status === "published" ? "Posted." : post.status === "publishing" ? "Sending now: a network is still processing the video. This page shows it when it's up." : "Not everything went. See each account below."}
        </Notice>
      )}
      {query.problem && <Notice kind="error">{query.problem}</Notice>}
      {checks && [...checks.errors, ...checks.warnings].length > 0 && post?.status !== "published" && (
        <Notice kind="error">
          <ul className="list-disc space-y-1 pl-4">
            {problemLines([...checks.errors, ...checks.warnings]).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Notice>
      )}

      {post && post.targets.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Where it goes</h2>
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {post.targets.map((t) => {
              const a = byId.get(t.account_id);
              const numbers = METRIC_KEYS.filter((k) => t.metrics[k] !== null && t.metrics[k] !== undefined);
              return (
                <li key={t.id} className="space-y-1 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {a && <NetworkMark platform={a.platform} />}
                    <span className="font-medium">{a ? `${a.name}${a.handle && a.handle !== a.name ? ` ${a.handle}` : ""}` : "A removed account"}</span>
                    <span className={t.status === "failed" ? "font-semibold text-danger" : "text-ink-soft"}>{TARGET_STATUS_LABEL[t.status]}</span>
                    {t.external_url && (
                      <a href={t.external_url} target="_blank" rel="noreferrer" className="font-semibold text-spruce underline-offset-4 hover:underline">
                        See it on {a ? PLATFORM_INFO[a.platform].name : "the network"}
                      </a>
                    )}
                  </div>
                  {numbers.length > 0 && (
                    <p className="text-ink-soft">
                      {numbers.map((k) => `${compact(t.metrics[k])} ${METRIC_LABEL[k]}`).join(" · ")}
                      {t.metrics_at ? ` (as of ${sayWhen(t.metrics_at, tz)})` : ""}
                    </p>
                  )}
                  {t.error && <p className="text-danger">{t.error}</p>}
                  {typeof t.progress.note === "string" && <p className="text-ink-soft">{t.progress.note}</p>}
                  {t.body && <p className="whitespace-pre-wrap text-ink-soft">Own wording: {t.body}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {post && (post.status === "draft" || post.status === "scheduled" || post.status === "failed") && post.targets.length > 0 && (
        <ConfirmForm action={postNowAction} message={post.status === "failed" ? "Try again now? Accounts that already have it are skipped." : "Post this now, to every account it's for?"}>
          <input type="hidden" name="post_id" value={post.id} />
          <Button type="submit" variant="secondary" size="sm">
            {post.status === "failed" ? "Try again now" : "Post now"}
          </Button>
        </ConfirmForm>
      )}

      {post && !editable(post) ? (
        <section className="space-y-3 rounded-card border border-line bg-surface p-4">
          <p className="whitespace-pre-wrap">{post.body || <span className="text-ink-soft">(no words)</span>}</p>
          {post.media.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {post.media.map((m) =>
                m.kind === "video" ? (
                  <video key={m.url} src={m.url} className="h-40 rounded-lg border border-line bg-black" controls preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={m.url} src={m.url} alt={m.alt ?? ""} className="h-28 w-28 rounded-lg border border-line object-cover" />
                )
              )}
            </div>
          )}
        </section>
      ) : (
        <PostForm accounts={usable} initial={initial} timeZone={tz} />
      )}

      {post && post.status !== "publishing" && (
        <ConfirmForm
          action={deletePostAction}
          message={post.status === "published" ? "Remove this from the calendar? It stays on the networks; delete it there too if you want it gone." : "Delete this post? It won't go out."}
          className="border-t border-line pt-4"
        >
          <input type="hidden" name="post_id" value={post.id} />
          <input type="hidden" name="month" value={month} />
          <Button type="submit" variant="danger" size="sm">
            {post.status === "published" ? "Remove from the calendar" : "Delete post"}
          </Button>
        </ConfirmForm>
      )}
    </div>
  );
}
