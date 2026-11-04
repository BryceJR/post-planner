import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Notice } from "@/components/ui/notice";
import { isDay, monthGrid, stepMonth } from "@/lib/calendar";
import { db } from "@/lib/db";
import { runLooksOff } from "@/lib/publish";
import { countScheduled, listAccounts, loadFailedPosts, loadPostsBetween, loadSettings, loadUndatedDrafts } from "@/lib/store";
import { excerpt } from "@/lib/text";
import type { Account, Post } from "@/lib/types";
import { clockIn, sayWhen, todayIn } from "@/lib/when";
import { addDays, dayInZone, startOfDayInZone } from "@/lib/zone";
import { runDueAction } from "./actions";
import { NetworkMark, POST_STATUS_STYLE, PostStatusChip } from "./ui";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

// The month's posts on a calendar, what didn't go, and drafts.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; ran?: string; removed?: string }> }) {
  const params = await searchParams;
  const settings = await loadSettings(db());
  const tz = settings.timezone;
  const today = todayIn(tz);
  const month = params.month && isDay(`${params.month}-01`) ? params.month : today.slice(0, 7);
  const grid = monthGrid(`${month}-01`);
  const from = startOfDayInZone(grid[0], tz).toISOString();
  const to = startOfDayInZone(addDays(grid[grid.length - 1], 1), tz).toISOString();

  const [posts, drafts, failed, accounts, scheduled] = await Promise.all([
    loadPostsBetween(db(), from, to),
    loadUndatedDrafts(db()),
    loadFailedPosts(db(), 10),
    listAccounts(db(), { includeOff: true }),
    countScheduled(db()),
  ]);
  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  const byDay = new Map<string, Post[]>();
  for (const p of posts) {
    const day = dayInZone(p.scheduled_at!, tz);
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  const prev = stepMonth(`${month}-01`, -1).slice(0, 7);
  const next = stepMonth(`${month}-01`, 1).slice(0, 7);
  const connected = accounts.filter((a) => a.status !== "off");
  const needsReconnect = accounts.filter((a) => a.status === "reconnect");
  const monthPosts = posts.filter((p) => dayInZone(p.scheduled_at!, tz).startsWith(month));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-ink-soft">Times are {tz.replace(/_/g, " ")}.</p>
        </div>
      </div>

      {params.ran && <Notice>{params.ran}</Notice>}
      {params.removed && <Notice>Removed from the calendar.</Notice>}
      {connected.length === 0 && (
        <Notice>
          No accounts are connected yet.{" "}
          <Link href="/accounts" className="font-semibold underline">
            Connect your accounts
          </Link>
          , and your AI assistant, under Accounts.
        </Notice>
      )}
      {needsReconnect.length > 0 && (
        <Notice kind="error">
          {needsReconnect.map((a) => a.name).join(", ")} {needsReconnect.length === 1 ? "needs" : "need"} connecting again before {needsReconnect.length === 1 ? "it" : "they"} can post.{" "}
          <Link href="/accounts" className="font-semibold underline">
            Accounts
          </Link>
        </Notice>
      )}
      {runLooksOff(settings.last_run_at, scheduled) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-tint px-4 py-3 text-sm text-danger">
          <p>
            Scheduled posts aren&apos;t going out by themselves yet: the every-minute run {settings.last_run_at ? `last came ${sayWhen(settings.last_run_at, tz)}` : "hasn't been set up"}. See{" "}
            <Link href="/accounts#schedule" className="font-semibold underline">
              Accounts → Scheduled posts
            </Link>
            .
          </p>
          <form action={runDueAction}>
            <Button type="submit" size="sm" variant="secondary">
              Send what&apos;s due now
            </Button>
          </form>
        </div>
      )}
      {failed.length > 0 && (
        <section className="rounded-xl border border-danger/30 bg-surface px-4 py-3">
          <h2 className="text-sm font-semibold text-danger">Didn&apos;t go</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {failed.map((p) => (
              <li key={p.id}>
                <PostLine post={p} accounts={byAccount} tz={tz} withDay />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={monthLabel(month)} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href={`/?month=${prev}`} variant="secondary" size="sm" aria-label="Previous month">
            ‹
          </LinkButton>
          <LinkButton href={`/?month=${next}`} variant="secondary" size="sm" aria-label="Next month">
            ›
          </LinkButton>
          <h2 className="ml-1 text-lg font-semibold">{monthLabel(month)}</h2>
          {month !== today.slice(0, 7) && (
            <Link href="/" className="ml-2 text-sm font-semibold text-spruce underline-offset-4 hover:underline">
              Today
            </Link>
          )}
        </div>

        {/* the month on a laptop */}
        <div className="hidden overflow-hidden rounded-card border border-line bg-surface md:block">
          <div className="grid grid-cols-7 border-b border-line text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.map((day, i) => {
              const inMonth = day.startsWith(month);
              const dayPosts = byDay.get(day) ?? [];
              return (
                <div key={day} className={`group min-h-28 border-line p-1.5 ${i % 7 !== 6 ? "border-r" : ""} ${i < 35 ? "border-b" : ""} ${inMonth ? "" : "bg-paper/60"}`}>
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${day === today ? "bg-spruce text-on-spruce" : inMonth ? "text-ink" : "text-ink-soft/60"}`}>{Number(day.slice(8))}</span>
                    {day >= today && (
                      <Link href={`/posts/new?day=${day}`} className="rounded px-1.5 text-xs font-semibold text-spruce opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`New post on ${day}`}>
                        + Post
                      </Link>
                    )}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {dayPosts.map((p) => (
                      <li key={p.id}>
                        <Link href={`/posts/${p.id}`} className={`block rounded-md px-1.5 py-1 text-xs leading-snug hover:brightness-95 ${POST_STATUS_STYLE[p.status]}`}>
                          <span className="flex items-center gap-1">
                            <span className="font-semibold">{clockIn(p.scheduled_at!, tz)}</span>
                            <Marks post={p} accounts={byAccount} />
                          </span>
                          <span className="mt-0.5 line-clamp-2">{excerpt(p.body, 70) || mediaLabel(p)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        {/* the month as a list on a phone */}
        <div className="md:hidden">
          {monthPosts.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing on the calendar this month.</p>
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line bg-surface">
              {monthPosts.map((p) => (
                <li key={p.id} className="px-3 py-2.5 text-sm">
                  <PostLine post={p} accounts={byAccount} tz={tz} withDay />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {drafts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Drafts with no day yet</h2>
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {drafts.map((p) => (
              <li key={p.id} className="px-3 py-2.5 text-sm">
                <PostLine post={p} accounts={byAccount} tz={tz} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function mediaLabel(post: Post) {
  if (post.media.some((m) => m.kind === "video")) return "(video)";
  return post.media.length ? "(pictures)" : "(empty)";
}

function Marks({ post, accounts }: { post: Post; accounts: Map<string, Account> }) {
  const platforms = [...new Set(post.targets.map((t) => accounts.get(t.account_id)?.platform).filter((p) => !!p))];
  return (
    <span className="flex flex-wrap gap-0.5">
      {platforms.map((p) => (
        <NetworkMark key={p} platform={p!} />
      ))}
    </span>
  );
}

function PostLine({ post, accounts, tz, withDay = false }: { post: Post; accounts: Map<string, Account>; tz: string; withDay?: boolean }) {
  return (
    <Link href={`/posts/${post.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 hover:underline">
      <PostStatusChip status={post.status} />
      {withDay && post.scheduled_at && <span className="whitespace-nowrap text-ink-soft">{sayWhen(post.scheduled_at, tz)}</span>}
      <Marks post={post} accounts={accounts} />
      <span className="min-w-0 flex-1 truncate">{excerpt(post.body, 90) || mediaLabel(post)}</span>
    </Link>
  );
}
