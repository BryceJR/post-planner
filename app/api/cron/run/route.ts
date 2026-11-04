// The every-minute run: posts that are due go out, videos a network was
// processing are checked, and a few posts' numbers (and once a day, the
// followers) are refreshed. Called with `Authorization: Bearer <CRON_SECRET>`
// (Accounts → Scheduled posts has the Supabase setup).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { refreshFollowers, refreshMetrics } from "@/lib/insights";
import { publishDue } from "@/lib/publish";
import { loadSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET isn't set; scheduled posts can't go out by themselves." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const started = Date.now();
  let database;
  try {
    database = db();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "not set up" }, { status: 503 });
  }
  const settings = await loadSettings(database);
  const report = await publishDue(database, { until: started + 150_000 });
  // numbers are a nicety: only with the time posting left over
  const metrics = await refreshMetrics(database, { until: started + 200_000 }).catch(() => 0);
  const followers = await refreshFollowers(database, { timezone: settings.timezone, lastDay: settings.last_stats_day, until: started + 230_000 }).catch(() => 0);
  return NextResponse.json({
    due: report.due,
    rescued: report.rescued,
    leftForNextRun: report.leftForNextRun,
    sent: report.sent.map((p) => ({ post: p.postId, status: p.status, accounts: p.targets.map((t) => ({ account: t.account, status: t.status, error: t.error })) })),
    continued: report.continued.map((p) => ({ post: p.postId, status: p.status })),
    metricsRefreshed: metrics,
    followersCounted: followers,
  });
}

export const POST = GET;
