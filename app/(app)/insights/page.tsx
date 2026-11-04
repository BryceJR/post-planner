import type { Metadata } from "next";
import Link from "next/link";
import { daysBetween } from "@/lib/calendar";
import { db } from "@/lib/db";
import { engagement, loadInsights, type Totals } from "@/lib/insights";
import { PLATFORM_INFO, type Platform } from "@/lib/platforms";
import { listAccounts, loadSettings } from "@/lib/store";
import { excerpt } from "@/lib/text";
import { sayWhen, todayIn } from "@/lib/when";
import { addDays, startOfDayInZone } from "@/lib/zone";
import { compact, NetworkMark } from "../ui";
import { BarChart } from "./bar-chart";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;
const th = "px-3 py-2 text-left font-semibold";
const td = "px-3 py-2";

function shortDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      {note && <p className="mt-1 text-xs text-ink-soft">{note}</p>}
    </div>
  );
}

// How the posts sent in a range did, from the numbers each network shares.
export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: rawDays } = await searchParams;
  const span = RANGES.find((r) => String(r) === rawDays) ?? 30;
  const { timezone: tz } = await loadSettings(db());
  const last = todayIn(tz);
  const first = addDays(last, -(span - 1));
  const days = daysBetween(first, last);
  const accounts = await listAccounts(db(), { includeOff: true });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const data = await loadInsights(db(), { fromIso: startOfDayInZone(first, tz).toISOString(), toIso: startOfDayInZone(addDays(last, 1), tz).toISOString(), days, timezone: tz, accounts });
  const followersNow = data.followers.reduce((sum, f) => sum + (f.now ?? 0), 0);
  const followersChange = data.followers.reduce((sum, f) => sum + (f.now !== null && f.before !== null ? f.now - f.before : 0), 0);
  const networks = (Object.keys(data.byPlatform) as Platform[]).sort((a, b) => (data.byPlatform[b]!.views ?? 0) - (data.byPlatform[a]!.views ?? 0));
  const eng = (t: Totals) => t.likes + t.comments + t.shares + t.saves;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Posts sent in the last {span} days, with the numbers each network shares. New posts refresh hourly, then less often. LinkedIn shares no numbers for personal profiles; X&apos;s depend on your developer plan.
          </p>
        </div>
        <nav aria-label="Range" className="flex gap-1 rounded-xl border border-line bg-surface p-1">
          {RANGES.map((r) => (
            <Link key={r} href={`/insights?days=${r}`} aria-current={r === span ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${r === span ? "bg-spruce-tint text-spruce-deep" : "text-ink-soft hover:text-ink"}`}>
              {r} days
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Posts sent" value={data.total.posts.toLocaleString("en-US")} note={`${networks.length} network${networks.length === 1 ? "" : "s"}`} />
        <Tile label="Views" value={compact(data.total.views)} />
        <Tile label="Likes, comments, shares, saves" value={compact(eng(data.total))} />
        <Tile label="Followers" value={compact(followersNow)} note={followersChange ? `${followersChange > 0 ? "+" : ""}${followersChange.toLocaleString("en-US")} in this range` : "Counted once a day"} />
      </div>

      <section className="space-y-3 rounded-card border border-line bg-surface p-4">
        <h2 className="font-semibold">Views, by the day the post went out</h2>
        {data.total.posts === 0 ? (
          <p className="text-sm text-ink-soft">Nothing was sent in this range yet.</p>
        ) : (
          <BarChart
            valueName="Views"
            bars={data.byDay.map((d) => ({
              key: d.day,
              label: shortDay(d.day),
              value: d.views,
              detail: `${d.views.toLocaleString("en-US")} views · ${d.engagement.toLocaleString("en-US")} likes, comments, shares · ${d.posts} post${d.posts === 1 ? "" : "s"}`,
            }))}
          />
        )}
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-spruce">Show as a table</summary>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className={th}>Day</th>
                  <th className={`${th} text-right`}>Posts</th>
                  <th className={`${th} text-right`}>Views</th>
                  <th className={`${th} text-right`}>Engagement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.byDay.filter((d) => d.posts > 0).map((d) => (
                  <tr key={d.day}>
                    <td className={td}>{shortDay(d.day)}</td>
                    <td className={`${td} text-right tabular-nums`}>{d.posts}</td>
                    <td className={`${td} text-right tabular-nums`}>{d.views.toLocaleString("en-US")}</td>
                    <td className={`${td} text-right tabular-nums`}>{d.engagement.toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="min-w-0 space-y-2">
          <h2 className="font-semibold">By network</h2>
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className={th}>Network</th>
                  <th className={`${th} text-right`}>Posts</th>
                  <th className={`${th} text-right`}>Views</th>
                  <th className={`${th} text-right`}>Likes</th>
                  <th className={`${th} text-right`}>Comments</th>
                  <th className={`${th} text-right`}>Shares</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {networks.length === 0 && (
                  <tr>
                    <td className={`${td} text-ink-soft`} colSpan={6}>
                      Nothing sent yet.
                    </td>
                  </tr>
                )}
                {networks.map((p) => {
                  const t = data.byPlatform[p]!;
                  return (
                    <tr key={p}>
                      <td className={td}>
                        <span className="flex items-center gap-2">
                          <NetworkMark platform={p} />
                          {PLATFORM_INFO[p].name}
                        </span>
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{t.posts}</td>
                      <td className={`${td} text-right tabular-nums`}>{compact(t.views)}</td>
                      <td className={`${td} text-right tabular-nums`}>{compact(t.likes)}</td>
                      <td className={`${td} text-right tabular-nums`}>{compact(t.comments)}</td>
                      <td className={`${td} text-right tabular-nums`}>{compact(t.shares)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="min-w-0 space-y-2">
          <h2 className="font-semibold">Followers</h2>
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className={th}>Account</th>
                  <th className={`${th} text-right`}>Followers</th>
                  <th className={`${th} text-right`}>Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.followers.filter((f) => byId.get(f.accountId)?.status !== "off").map((f) => {
                  const a = byId.get(f.accountId)!;
                  const change = f.now !== null && f.before !== null ? f.now - f.before : null;
                  return (
                    <tr key={f.accountId}>
                      <td className={td}>
                        <span className="flex items-center gap-2">
                          <NetworkMark platform={a.platform} />
                          {a.name}
                        </span>
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{f.now === null ? <span className="text-ink-soft">not shared</span> : f.now.toLocaleString("en-US")}</td>
                      <td className={`${td} text-right tabular-nums`}>{change === null ? "–" : `${change > 0 ? "+" : ""}${change.toLocaleString("en-US")}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">Best posts</h2>
        <p className="text-sm text-ink-soft">By likes, comments, shares and saves together.</p>
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className={th}>Post</th>
                <th className={th}>Sent</th>
                <th className={`${th} text-right`}>Views</th>
                <th className={`${th} text-right`}>Engagement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.top.length === 0 && (
                <tr>
                  <td className={`${td} text-ink-soft`} colSpan={4}>
                    Numbers show here once posts have gone out.
                  </td>
                </tr>
              )}
              {data.top.map((t) => (
                <tr key={t.targetId}>
                  <td className={td}>
                    <Link href={`/posts/${t.postId}`} className="flex items-center gap-2 hover:underline">
                      <NetworkMark platform={t.platform} />
                      <span className="line-clamp-1">{excerpt(t.text, 80) || "(media)"}</span>
                    </Link>
                  </td>
                  <td className={`${td} whitespace-nowrap text-ink-soft`}>{sayWhen(t.publishedAt, tz).replace(/, \d{4},/, ",")}</td>
                  <td className={`${td} text-right tabular-nums`}>{compact(t.metrics.views)}</td>
                  <td className={`${td} text-right tabular-nums`}>{engagement(t.metrics).toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
