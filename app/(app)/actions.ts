"use server";

// The pages' buttons. Each checks the sign-in first, then works through lib/.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { makeKey, revokeGrant } from "@/lib/ai/grants";
import { requireSignedIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePostForm } from "@/lib/form";
import { blueskyConnect, looksLikeAppPassword } from "@/lib/networks/bluesky";
import { publishDue, publishNow } from "@/lib/publish";
import { deletePost, disconnectAccount, loadPost, loadSettings, problemsBeforeSending, saveAccounts, savePost, saveSettings } from "@/lib/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PostFormState = { errors: string[] } | null;
export type SimpleState = { error?: string; notice?: string; key?: string } | null;

function id(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return UUID.test(value) ? value : null;
}

function isTimeZone(value: string) {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function refresh() {
  revalidatePath("/", "layout");
}

// The post form: save as a draft, schedule, or post now.
export async function savePostAction(_prev: PostFormState, formData: FormData): Promise<PostFormState> {
  await requireSignedIn();
  const { timezone } = await loadSettings(db());
  const parsed = parsePostForm(formData, timezone);
  if (!parsed.ok) return { errors: [parsed.error] };
  const saved = await savePost(db(), parsed.input, { id: parsed.id, by: "You" });
  if (!saved.ok) return { errors: saved.errors };
  if (parsed.input.when.kind === "now") await publishNow(db(), saved.post.id);
  refresh();
  redirect(`/posts/${saved.post.id}?saved=${parsed.input.when.kind}`);
}

// Post now, or Try again on one that failed.
export async function postNowAction(formData: FormData) {
  await requireSignedIn();
  const postId = id(formData, "post_id");
  if (!postId) redirect("/");
  const post = await loadPost(db(), postId);
  const blocking = post ? await problemsBeforeSending(db(), post) : [];
  if (blocking.length) redirect(`/posts/${postId}?problem=${encodeURIComponent(`It can't go out yet: ${blocking.join(" ")}`)}`);
  await publishNow(db(), postId);
  refresh();
  redirect(`/posts/${postId}?saved=now`);
}

export async function deletePostAction(formData: FormData) {
  await requireSignedIn();
  const postId = id(formData, "post_id");
  const back = String(formData.get("month") ?? "");
  if (postId) {
    const done = await deletePost(db(), postId);
    if (!done.ok) redirect(`/posts/${postId}?problem=${encodeURIComponent(done.error ?? "It couldn't be removed.")}`);
  }
  refresh();
  redirect(`/?${/^\d{4}-\d{2}$/.test(back) ? `month=${back}&` : ""}removed=1`);
}

// "Send what's due now", for when the every-minute run isn't set up yet.
export async function runDueAction() {
  await requireSignedIn();
  const report = await publishDue(db());
  refresh();
  const sent = report.sent.length;
  redirect(`/?ran=${encodeURIComponent(sent ? `Sent ${sent} post${sent === 1 ? "" : "s"} that ${sent === 1 ? "was" : "were"} due.` : "Nothing was due.")}`);
}

export async function disconnectAccountAction(formData: FormData) {
  await requireSignedIn();
  const accountId = id(formData, "account_id");
  if (accountId) await disconnectAccount(db(), accountId);
  refresh();
  redirect("/accounts?connected=Disconnected.");
}

export async function connectBlueskyAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireSignedIn();
  const handle = String(formData.get("handle") ?? "").trim();
  const password = String(formData.get("app_password") ?? "").trim();
  if (!handle) return { error: "Enter your Bluesky handle, like yourname.bsky.social." };
  if (!looksLikeAppPassword(password)) return { error: "Use an app password (it looks like abcd-efgh-ijkl-mnop), never your real Bluesky password." };
  try {
    await saveAccounts(db(), [await blueskyConnect(handle, password)]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Bluesky didn't connect." };
  }
  refresh();
  redirect(`/accounts?connected=${encodeURIComponent("Connected Bluesky.")}`);
}

export async function makeKeyAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireSignedIn();
  const name = String(formData.get("name") ?? "").trim() || "Key";
  const key = await makeKey(db(), name);
  refresh();
  return { key, notice: `Made "${name}". Copy it now: it's only shown this once.` };
}

export async function revokeGrantAction(formData: FormData) {
  await requireSignedIn();
  const grantId = id(formData, "grant_id");
  if (grantId) await revokeGrant(db(), grantId);
  refresh();
  redirect("/accounts?connected=Disconnected.");
}

export async function saveTimezoneAction(formData: FormData) {
  await requireSignedIn();
  const tz = String(formData.get("timezone") ?? "").trim();
  if (isTimeZone(tz)) await saveSettings(db(), { timezone: tz });
  refresh();
  redirect("/accounts?connected=Time%20zone%20saved.");
}
