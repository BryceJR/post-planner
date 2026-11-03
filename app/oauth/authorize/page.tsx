import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui/notice";
import { findClient } from "@/lib/ai/grants";
import { backToApp, checkAuthorize, originFromHeaders, resourceAllowedFor } from "@/lib/ai/oauth";
import { requireSignedIn } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Connect an assistant" };
export const dynamic = "force-dynamic";

// Where an AI assistant (Grok, Claude…) sends you to ask for Post Planner.
// Signed out, the sign-in comes first and brings you back here.
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSignedIn();
  const raw = await searchParams;
  const q = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const origin = originFromHeaders(await headers());
  const client = q.client_id ? await findClient(db(), q.client_id) : null;
  const check = checkAuthorize(q, client, resourceAllowedFor(origin));

  if (!check.ok && check.kind === "redirect") {
    redirect(backToApp(check.redirectUri, { error: check.error, error_description: check.description, state: check.state, iss: origin }));
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-12">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={36} height={36} className="rounded-xl" />
        <h1 className="text-2xl font-semibold tracking-tight">Connect an assistant</h1>
      </div>
      {!check.ok ? (
        <Notice kind="error">{check.message}</Notice>
      ) : (
        <form method="post" action="/api/mcp/oauth/approve" className="space-y-5 rounded-2xl border border-line bg-surface p-5">
          <p className="text-lg">
            <span className="font-semibold">{client!.name}</span> wants to use your Post Planner.
          </p>
          <div className="space-y-2 text-sm">
            <p className="font-medium">It will be able to:</p>
            <ul className="list-disc space-y-1 pl-5 text-ink-soft">
              <li>see your connected social accounts, the posts on the calendar and how they&apos;re doing</li>
              <li>write, schedule, change and remove posts</li>
              <li>post to your accounts, under your name</li>
            </ul>
            <p className="text-ink-soft">Disconnect it any time under Accounts → AI assistants.</p>
          </div>
          <p className="text-xs text-ink-soft">You&apos;ll go back to {new URL(check.value.redirectUri).host}.</p>
          {Object.entries({
            client_id: check.value.clientId,
            redirect_uri: check.value.redirectUri,
            state: check.value.state ?? "",
            response_type: "code",
            code_challenge: check.value.challenge,
            code_challenge_method: "S256",
            resource: check.value.resource ?? "",
          }).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div className="flex flex-wrap gap-3">
            <button type="submit" name="decision" value="allow" className="h-12 rounded-xl bg-spruce px-5 font-semibold text-on-spruce hover:brightness-110">
              Allow
            </button>
            <button type="submit" name="decision" value="deny" className="h-12 rounded-xl border border-line bg-surface px-5 font-semibold text-ink hover:bg-paper">
              Cancel
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
