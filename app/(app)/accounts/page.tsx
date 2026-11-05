import type { Metadata } from "next";
import { headers } from "next/headers";
import { CopyText } from "@/components/copy-text";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { listGrants } from "@/lib/ai/grants";
import { mcpUrl, originFromHeaders } from "@/lib/ai/oauth";
import { db } from "@/lib/db";
import { linkedinPagesOn } from "@/lib/networks/linkedin";
import { callbackUrl, CONNECTION_INFO, connectionCredentials, isHiddenConnection, PLATFORM_INFO, siteOrigin, type Connection } from "@/lib/platforms";
import { countScheduled, listAccounts, loadSettings } from "@/lib/store";
import { sayWhen } from "@/lib/when";
import { disconnectAccountAction, revokeGrantAction, saveTimezoneAction } from "../actions";
import { NetworkMark } from "../ui";
import { BlueskyForm, KeyForm } from "./forms";

export const metadata: Metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

const ZONES: [string, string][] = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona (no DST)"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
  ["Europe/London", "London"],
  ["Europe/Berlin", "Central Europe"],
  ["Australia/Sydney", "Sydney"],
];

const card = "space-y-3 rounded-card border border-line bg-surface p-4";
const OAUTH: Connection[] = (["x", "meta", "linkedin", "google", "tiktok", "reddit"] as const).filter((c) => !isHiddenConnection(c));

function day(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

// The accounts posts go to, the AI assistants that can write them, and the
// every-minute run that sends scheduled posts.
export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; problem?: string }> }) {
  const query = await searchParams;
  const origin = originFromHeaders(await headers());
  const site = siteOrigin(`${origin}/`);
  const [settings, accounts, grants, scheduled] = await Promise.all([loadSettings(db()), listAccounts(db()), listGrants(db()), countScheduled(db())]);
  const tz = settings.timezone;
  const zones = ZONES.some(([z]) => z === tz) ? ZONES : [[tz, tz] as [string, string], ...ZONES];
  const cronSql = `-- Supabase → SQL Editor. Replace PASTE-YOUR-CRON-SECRET with the CRON_SECRET from Vercel.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select vault.create_secret('PASTE-YOUR-CRON-SECRET', 'post_planner_cron_secret');
select cron.schedule('post-planner', '* * * * *', $$
  select net.http_get(
    url := '${site}/api/cron/run',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'post_planner_cron_secret')),
    timeout_milliseconds := 60000
  );
$$);`;

  return (
    <div className="max-w-5xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <p className="mt-1 text-ink-soft">The accounts your posts go to, and the AI assistants that can write and post them for you.</p>
      </div>

      {query.connected && <Notice>{query.connected}</Notice>}
      {query.problem && <Notice kind="error">{query.problem}</Notice>}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Connected</h2>
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-soft">None yet. Connect one below.</p>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
                <NetworkMark platform={a.platform} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {a.name} {a.handle && a.handle !== a.name && <span className="font-normal text-ink-soft">{a.handle}</span>}
                  </p>
                  <p className={a.status === "reconnect" ? "text-danger" : "text-ink-soft"}>
                    {a.status === "reconnect"
                      ? `Needs connecting again${a.last_error ? `: ${a.last_error}` : "."}`
                      : `${PLATFORM_INFO[a.platform].name} · connected ${day(a.connected_at, tz)}${a.expires_at && a.platform === "linkedin" ? ` · connect again by ${day(a.expires_at, tz)}` : ""}`}
                  </p>
                </div>
                <ConfirmForm action={disconnectAccountAction} message={`Disconnect ${a.name}? Posts waiting for it won't go there.`}>
                  <input type="hidden" name="account_id" value={a.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Disconnect
                  </Button>
                </ConfirmForm>
              </li>
            ))}
          </ul>
        )}

        <h2 className="pt-2 text-lg font-semibold">Connect a network</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {OAUTH.map((c) => {
            const info = CONNECTION_INFO[c];
            const ready = !!connectionCredentials(info);
            const has = accounts.some((a) => info.platforms.includes(a.platform));
            return (
              <div key={c} className={card}>
                <div className="flex items-center gap-2">
                  {info.platforms.map((p) => (
                    <NetworkMark key={p} platform={p} size="md" />
                  ))}
                  <h3 className="font-semibold">{info.name}</h3>
                </div>
                {ready ? (
                  <a href={`/api/connect/${c}`} className={buttonClasses({ size: "sm" })}>
                    {has ? `Connect ${info.name} again` : `Connect ${info.name}`}
                  </a>
                ) : (
                  <p className="text-sm text-ink-soft">
                    Not set up yet. Add <code>{info.envId}</code> and <code>{info.envSecret}</code> in Vercel → Settings → Environment Variables, then redeploy.
                  </p>
                )}
                {c === "meta" && <p className="text-sm text-ink-soft">One sign-in brings every Page you tick and the Instagram business account linked to each.</p>}
                {c === "linkedin" && <p className="text-sm text-ink-soft">{linkedinPagesOn() ? "Your profile and the company pages you run." : "Your own profile. Company pages need LinkedIn's approval first."}</p>}
                {info.caveat && <p className="text-sm text-ink-soft">{info.caveat}</p>}
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold text-spruce">{ready ? "How it's set up" : "How to set it up"}</summary>
                  <p className="mt-2 text-ink-soft">{info.setup}</p>
                  <p className="mt-2 font-medium">Callback URL to add there:</p>
                  <CopyText text={callbackUrl(c, site)} />
                </details>
              </div>
            );
          })}
          <div className={card}>
            <div className="flex items-center gap-2">
              <NetworkMark platform="bluesky" size="md" />
              <h3 className="font-semibold">Bluesky</h3>
            </div>
            <p className="text-sm text-ink-soft">{CONNECTION_INFO.bluesky.setup}</p>
            <BlueskyForm />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">AI assistants</h2>
        <div className={card}>
          <p className="text-sm">Your assistant writes, schedules and posts from a chat, and tells you how posts are doing, using this connector address:</p>
          <CopyText text={mcpUrl(origin)} />
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div>
              <p className="font-semibold">Grok</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-soft">
                <li>On grok.com, open Connectors (grok.com/connectors).</li>
                <li>New connector → Custom. Paste the address above.</li>
                <li>Connect. Post Planner asks you to sign in (if you aren&apos;t) and to Allow.</li>
                <li>In a chat, ask: &ldquo;What&apos;s on my posting calendar this week?&rdquo;</li>
              </ol>
            </div>
            <div>
              <p className="font-semibold">Claude</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-soft">
                <li>claude.ai → Settings → Connectors → Add custom connector.</li>
                <li>Paste the address above, then Connect and Allow.</li>
              </ol>
              <p className="mt-2 text-ink-soft">Other apps that speak MCP (ChatGPT, Cursor…) take the same address.</p>
            </div>
          </div>
        </div>

        {grants.length > 0 && (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {g.name} <span className="font-normal text-ink-soft">{g.kind === "key" ? "· key" : ""}</span>
                  </p>
                  <p className="text-ink-soft">
                    Allowed {day(g.created_at, tz)} · {g.last_used_at ? `last used ${sayWhen(g.last_used_at, tz)}` : "not used yet"}
                  </p>
                </div>
                <ConfirmForm action={revokeGrantAction} message={`Disconnect ${g.name}? It can't use Post Planner until it connects again.`}>
                  <input type="hidden" name="grant_id" value={g.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Disconnect
                  </Button>
                </ConfirmForm>
              </li>
            ))}
          </ul>
        )}

        <details className={card}>
          <summary className="cursor-pointer text-sm font-semibold text-spruce">For apps that take a key instead (Claude Code, the xAI API, scripts)</summary>
          <p className="text-sm text-ink-soft">
            They send it as <code>Authorization: Bearer bok_…</code> to the connector address. It works until you disconnect it here.
          </p>
          <KeyForm />
        </details>
      </section>

      <section id="schedule" className="space-y-3">
        <h2 className="text-lg font-semibold">Scheduled posts</h2>
        <div className={card}>
          <form action={saveTimezoneAction} className="flex flex-wrap items-end gap-2">
            <div className="min-w-56">
              <label htmlFor="tz" className="mb-1.5 block text-sm font-medium">
                Calendar time zone
              </label>
              <Select id="tz" name="timezone" size="sm" defaultValue={tz}>
                {zones.map(([z, label]) => (
                  <option key={z} value={z}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" size="sm" variant="secondary">
              Save
            </Button>
          </form>
          <p className="text-sm">
            {settings.last_run_at ? (
              <>The every-minute run last came {sayWhen(settings.last_run_at, tz)}.</>
            ) : (
              <>The every-minute run hasn&apos;t come yet{scheduled ? `, and ${scheduled} post${scheduled === 1 ? " is" : "s are"} waiting for it` : ""}.</>
            )}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-spruce">Set up the every-minute run (once)</summary>
            <p className="mt-2 text-ink-soft">
              Scheduled posts go out, and insights refresh, when something calls <code>{site}/api/cron/run</code> with your <code>CRON_SECRET</code>. Supabase can do that every minute on any plan: run this in Supabase → SQL Editor.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-paper p-3 text-xs">{cronSql}</pre>
          </details>
        </div>
      </section>
    </div>
  );
}
