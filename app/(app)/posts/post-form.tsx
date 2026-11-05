"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { canvasToJpeg, drawResized, readImage } from "@/lib/browser-image";
import { PLATFORM_INFO } from "@/lib/platforms";
import { firstLine, TIKTOK_PRIVACY, TIKTOK_PRIVACY_LABEL, YOUTUBE_PRIVACY } from "@/lib/target-settings";
import { lengthOn } from "@/lib/text";
import type { Account, MediaItem } from "@/lib/types";
import { savePostAction } from "../actions";
import { NetworkMark } from "../ui";

export type PostFormInitial = {
  postId: string | null;
  body: string;
  media: MediaItem[];
  selected: string[];
  own: Record<string, string>;
  settings: Record<string, Record<string, unknown>>;
  when: "schedule" | "now" | "draft";
  at: string;
};

type When = PostFormInitial["when"];
type Upload = { name: string; percent: number };

const SUBMIT_LABEL: Record<When, string> = { schedule: "Schedule post", now: "Post now", draft: "Save draft" };

function Counter({ account, text }: { account: Account; text: string }) {
  const info = PLATFORM_INFO[account.platform];
  const n = lengthOn(account.platform, text.trim());
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${n > info.maxChars ? "font-semibold text-danger" : "text-ink-soft"}`}>
      <NetworkMark platform={account.platform} />
      {n.toLocaleString("en-US")}/{info.maxChars.toLocaleString("en-US")}
    </span>
  );
}

// What a video says about itself in the browser: length and size.
function videoMeta(file: File): Promise<{ duration: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const done = (d: { duration: number | null; width: number | null; height: number | null }) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onloadedmetadata = () => done({ duration: Number.isFinite(v.duration) ? v.duration : null, width: v.videoWidth || null, height: v.videoHeight || null });
    v.onerror = () => done({ duration: null, width: null, height: null });
    v.src = url;
  });
}

// PUT to storage's one-time link, with progress.
function putWithProgress(url: string, body: Blob, type: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=31536000");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`The upload was refused (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("The upload didn't go through. Check the connection and try again."));
    xhr.send(body);
  });
}

async function api<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok || json.error) throw new Error(json.error ?? "The file couldn't be saved.");
  return json;
}

// The post: its words, media, accounts, each account's own wording and
// settings, and when it goes. The server checks it all again on save.
export function PostForm({ accounts, initial, timeZone }: { accounts: Account[]; initial: PostFormInitial; timeZone: string }) {
  const [state, formAction, pending] = useActionState(savePostAction, null);
  const [body, setBody] = useState(initial.body);
  const [selected, setSelected] = useState<string[]>(initial.selected.filter((id) => accounts.some((a) => a.id === id)));
  const [own, setOwn] = useState<Record<string, string>>(initial.own);
  const [media, setMedia] = useState<MediaItem[]>(initial.media);
  const [when, setWhen] = useState<When>(initial.when);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const chosen = accounts.filter((a) => selected.includes(a.id));
  const titled = [...new Set(chosen.filter((a) => a.platform === "youtube" || a.platform === "reddit").map((a) => PLATFORM_INFO[a.platform].name))];
  const sharedText = chosen.filter((a) => own[a.id] === undefined);
  const hasVideo = media.some((m) => m.kind === "video");

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function toggleOwn(id: string) {
    setOwn((o) => {
      const next = { ...o };
      if (next[id] === undefined) next[id] = body;
      else delete next[id];
      return next;
    });
  }

  async function addFile(file: File) {
    const isVideo = file.type.startsWith("video/");
    const upload: Upload = { name: file.name, percent: 0 };
    setUploads((u) => [...u, upload]);
    const progress = (percent: number) => setUploads((u) => u.map((x) => (x === upload ? Object.assign(upload, { percent }) : x)));
    try {
      let blob: Blob = file;
      let type = file.type || (isVideo ? "video/mp4" : "image/jpeg");
      let meta: { duration: number | null; width: number | null; height: number | null } = { duration: null, width: null, height: null };
      if (isVideo) meta = await videoMeta(file);
      else {
        try {
          // shrunk here first, so a phone's 8 MB photo uploads in a moment
          const src = await readImage(file);
          blob = await canvasToJpeg(drawResized(src, 2048), 0.88);
          type = "image/jpeg";
          if ("close" in src) src.close();
        } catch {
          // the server reads what the browser can't (HEIC on some browsers)
        }
      }
      const ticket = await api<{ path: string; uploadUrl: string }>({ action: "ticket", mime: type, size: blob.size });
      await putWithProgress(ticket.uploadUrl, blob, type, progress);
      const item = await api<MediaItem>({ action: "finish", path: ticket.path, ...meta });
      setMedia((m) => [...m, item]);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : "The file couldn't be saved.");
    } finally {
      setUploads((u) => u.filter((x) => x !== upload));
    }
  }

  async function addFiles(files: FileList | null) {
    setMediaError(null);
    for (const file of Array.from(files ?? [])) await addFile(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function addLink() {
    const url = link.trim();
    if (!url) return;
    setMediaError(null);
    const upload: Upload = { name: url, percent: 0 };
    setUploads((u) => [...u, upload]);
    try {
      const item = await api<MediaItem>({ action: "link", url });
      setMedia((m) => [...m, item]);
      setLink("");
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : "That link couldn't be used.");
    } finally {
      setUploads((u) => u.filter((x) => x !== upload));
    }
  }

  function confirmNow(event: React.FormEvent<HTMLFormElement>) {
    if (when === "now" && !window.confirm(`Post this now to ${chosen.map((a) => `${PLATFORM_INFO[a.platform].name} (${a.name})`).join(", ")}?`)) event.preventDefault();
  }

  if (accounts.length === 0) {
    return (
      <Notice>
        Connect an account first, under{" "}
        <Link href="/accounts" className="font-semibold underline">
          Accounts
        </Link>
        .
      </Notice>
    );
  }

  return (
    <form action={formAction} onSubmit={confirmNow} className="space-y-6">
      {initial.postId && <input type="hidden" name="post_id" value={initial.postId} />}
      <input type="hidden" name="media" value={JSON.stringify(media)} />

      {state?.errors && state.errors.length > 0 && (
        <Notice kind="error">
          <ul className="list-disc space-y-1 pl-4">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Post to</legend>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <label key={a.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${selected.includes(a.id) ? "border-spruce bg-spruce-tint" : "border-line bg-surface"}`}>
              <input type="checkbox" name="account" value={a.id} checked={selected.includes(a.id)} onChange={() => toggle(a.id)} className="h-4 w-4 accent-[var(--color-spruce)]" />
              <NetworkMark platform={a.platform} />
              <span className="font-medium">{a.name}</span>
              {a.handle && a.handle !== a.name && <span className="text-ink-soft">{a.handle}</span>}
              {a.status === "reconnect" && <span className="text-xs font-semibold text-danger">connect again</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="What it says" htmlFor="body" hint={titled.length ? `On ${titled.join(" and ")} the first line is the title unless you give one below.` : undefined}>
        <Textarea id="body" name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={7} maxLength={10000} placeholder="Write the post…" />
        {sharedText.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {[...new Map(sharedText.map((a) => [a.platform, a])).values()].map((a) => (
              <Counter key={a.platform} account={a} text={body} />
            ))}
          </div>
        )}
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium">Pictures or a video</p>
        {media.length > 0 && (
          <ul className="flex flex-wrap gap-3">
            {media.map((m, i) => (
              <li key={m.url} className="w-36 space-y-1">
                {m.kind === "video" ? (
                  <video src={m.url} className="h-36 w-36 rounded-lg border border-line bg-black object-cover" muted playsInline controls preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt={m.alt ?? ""} className="h-36 w-36 rounded-lg border border-line object-cover" />
                )}
                {m.kind === "image" ? (
                  <Input size="sm" value={m.alt ?? ""} onChange={(e) => setMedia((list) => list.map((x, j) => (j === i ? { ...x, alt: e.target.value || null } : x)))} placeholder="Describe it" aria-label={`Description of picture ${i + 1}`} />
                ) : (
                  <p className="text-xs text-ink-soft">
                    Video{m.duration ? `, ${Math.round(m.duration)} s` : ""}
                    {m.size ? `, ${(m.size / 1048576).toFixed(1)} MB` : ""}
                  </p>
                )}
                <button type="button" onClick={() => setMedia((list) => list.filter((_, j) => j !== i))} className="text-xs font-semibold text-danger">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime,video/webm"
            multiple={!hasVideo}
            onChange={(e) => addFiles(e.target.files)}
            className="max-w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:font-semibold"
          />
          <span className="text-sm text-ink-soft">or</span>
          <Input size="sm" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a link to a picture or video" className="max-w-72" aria-label="Link to a picture or video" />
          <Button type="button" variant="secondary" size="sm" onClick={addLink} disabled={!link.trim()}>
            Add
          </Button>
        </div>
        <p className="text-xs text-ink-soft">Up to 10 pictures, or one video (MP4 is safest everywhere), 50 MB at most.</p>
        {uploads.map((u) => (
          <div key={u.name} className="text-sm text-ink-soft">
            Adding {u.name.length > 40 ? `${u.name.slice(0, 40)}…` : u.name}
            {u.percent ? ` (${u.percent}%)` : "…"}
            <div className="mt-1 h-1.5 w-64 max-w-full overflow-hidden rounded bg-line">
              <div className="h-full bg-spruce transition-all" style={{ width: `${u.percent}%` }} />
            </div>
          </div>
        ))}
        {mediaError && <p className="text-sm font-medium text-danger">{mediaError}</p>}
      </div>

      {chosen.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm font-medium">For each account</p>
          {chosen.map((a) => (
            <AccountOptions key={a.id} account={a} body={body} own={own[a.id]} onToggleOwn={() => toggleOwn(a.id)} onOwn={(v) => setOwn((o) => ({ ...o, [a.id]: v }))} settings={initial.settings[a.id] ?? {}} />
          ))}
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">When</legend>
        <div className="flex flex-wrap gap-2">
          {(["schedule", "now", "draft"] as When[]).map((w) => (
            <label key={w} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${when === w ? "border-spruce bg-spruce-tint" : "border-line bg-surface"}`}>
              <input type="radio" name="when" value={w} checked={when === w} onChange={() => setWhen(w)} className="accent-[var(--color-spruce)]" />
              {w === "schedule" ? "At a time" : w === "now" ? "Right now" : "Save as a draft"}
            </label>
          ))}
        </div>
        {when !== "now" && (
          <div className="max-w-xs">
            <Field label={when === "schedule" ? "Goes at" : "Day on the calendar (optional)"} htmlFor="at" hint={timeZone.replace(/_/g, " ")}>
              <Input id="at" name="at" type="datetime-local" defaultValue={initial.at} required={when === "schedule"} />
            </Field>
          </div>
        )}
      </fieldset>

      <Button type="submit" disabled={pending || uploads.length > 0}>
        {pending ? (when === "now" ? "Posting…" : "Saving…") : SUBMIT_LABEL[when]}
      </Button>
    </form>
  );
}

// One account's own wording, and its network's settings.
function AccountOptions({
  account,
  body,
  own,
  onToggleOwn,
  onOwn,
  settings,
}: {
  account: Account;
  body: string;
  own: string | undefined;
  onToggleOwn: () => void;
  onOwn: (v: string) => void;
  settings: Record<string, unknown>;
}) {
  const info = PLATFORM_INFO[account.platform];
  const name = (key: string) => `set_${account.id}_${key}`;
  const text = own ?? body;
  const s = (k: string) => (typeof settings[k] === "string" ? (settings[k] as string) : "");
  const b = (k: string, fallback: boolean) => (typeof settings[k] === "boolean" ? (settings[k] as boolean) : fallback);
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <NetworkMark platform={account.platform} />
        {info.name} · {account.name}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={`own_${account.id}`} checked={own !== undefined} onChange={onToggleOwn} className="h-4 w-4 accent-[var(--color-spruce)]" />
        Different wording here
      </label>
      {own !== undefined && (
        <div className="space-y-1">
          <Textarea name={`text_${account.id}`} value={own} onChange={(e) => onOwn(e.target.value)} rows={4} maxLength={10000} compact />
          <Counter account={account} text={own} />
        </div>
      )}

      {account.platform === "youtube" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" htmlFor={name("title")} hint={`Blank: "${firstLine(text, 100) || "New video"}"`}>
            <Input id={name("title")} name={name("title")} size="sm" maxLength={100} defaultValue={s("title")} />
          </Field>
          <Field label="Who can watch" htmlFor={name("privacy")}>
            <Select id={name("privacy")} name={name("privacy")} size="sm" defaultValue={s("privacy") || "public"}>
              {YOUTUBE_PRIVACY.map((p) => (
                <option key={p} value={p}>
                  {p === "public" ? "Everyone (public)" : p === "unlisted" ? "Anyone with the link (unlisted)" : "Only me (private)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tags" htmlFor={name("tags")} hint="Separated by commas.">
            <Input id={name("tags")} name={name("tags")} size="sm" defaultValue={Array.isArray(settings.tags) ? (settings.tags as string[]).join(", ") : ""} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="hidden" name={`${name("madeForKids")}__present`} value="1" />
            <input type="checkbox" name={name("madeForKids")} defaultChecked={b("madeForKids", false)} className="h-4 w-4 accent-[var(--color-spruce)]" />
            Made for kids
          </label>
        </div>
      )}

      {account.platform === "reddit" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Subreddit" htmlFor={name("subreddit")} hint="Like r/HVAC. Blank: your own profile.">
            <Input id={name("subreddit")} name={name("subreddit")} size="sm" defaultValue={s("subreddit") ? (s("subreddit").startsWith("u_") ? `u/${s("subreddit").slice(2)}` : `r/${s("subreddit")}`) : ""} placeholder="r/…" />
          </Field>
          <Field label="Title" htmlFor={name("title")} hint={`Blank: "${firstLine(text, 300) || "(needs one)"}"`}>
            <Input id={name("title")} name={name("title")} size="sm" maxLength={300} defaultValue={s("title")} />
          </Field>
          <div className="flex gap-4 text-sm">
            {(["nsfw", "spoiler"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="hidden" name={`${name(k)}__present`} value="1" />
                <input type="checkbox" name={name(k)} defaultChecked={b(k, false)} className="h-4 w-4 accent-[var(--color-spruce)]" />
                {k === "nsfw" ? "NSFW" : "Spoiler"}
              </label>
            ))}
          </div>
        </div>
      )}

      {account.platform === "tiktok" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who can watch" htmlFor={name("privacy")} hint="Until TikTok audits the app, only Only me works (on a private account).">
            <Select id={name("privacy")} name={name("privacy")} size="sm" defaultValue={s("privacy") || "SELF_ONLY"}>
              {TIKTOK_PRIVACY.map((p) => (
                <option key={p} value={p}>
                  {TIKTOK_PRIVACY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-4 self-end pb-2 text-sm">
            {(["allowComments", "allowDuet", "allowStitch"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="hidden" name={`${name(k)}__present`} value="1" />
                <input type="checkbox" name={name(k)} defaultChecked={b(k, true)} className="h-4 w-4 accent-[var(--color-spruce)]" />
                {k === "allowComments" ? "Comments" : k === "allowDuet" ? "Duet" : "Stitch"}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
