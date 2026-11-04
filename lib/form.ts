// The post form (New post) as a save: its fields read into what
// lib/store.ts savePost takes. Each account's fields are named after it:
// own_<id> and text_<id> for its own wording, set_<id>_<setting> for its
// network's settings (a YouTube title, a subreddit…). Pure; tested in
// form.test.ts.
import { mediaList } from "./media";
import type { PostInput } from "./store";
import { parseWhen } from "./when";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedPostForm = { ok: true; id: string | null; input: PostInput } | { ok: false; error: string };

function settingsFor(form: FormData, accountId: string): Record<string, unknown> {
  const prefix = `set_${accountId}_`;
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith(prefix) || typeof value !== "string") continue;
    const name = key.slice(prefix.length);
    // a checkbox sends "on" when ticked; its hidden twin says it was there at all
    if (name.endsWith("__present")) {
      const base = name.slice(0, -"__present".length);
      if (!(base in out)) out[base] = false;
      continue;
    }
    out[name] = value === "on" ? true : value;
  }
  return out;
}

export function parsePostForm(form: FormData, timeZone: string): ParsedPostForm {
  const rawId = String(form.get("post_id") ?? "").trim();
  const id = UUID.test(rawId) ? rawId : null;
  if (rawId && !id) return { ok: false, error: "That post's id is broken. Open it again from the calendar." };

  const accountIds = [...new Set(form.getAll("account").map(String).filter((v) => UUID.test(v)))];
  const accounts = accountIds.map((accountId) => {
    const own = form.get(`own_${accountId}`) === "on";
    const text = String(form.get(`text_${accountId}`) ?? "");
    return { id: accountId, body: own && text.trim() ? text : null, settings: settingsFor(form, accountId) };
  });

  let media: PostInput["media"] = [];
  const rawMedia = String(form.get("media") ?? "").trim();
  if (rawMedia) {
    try {
      media = mediaList(JSON.parse(rawMedia));
    } catch {
      return { ok: false, error: "The pictures and videos didn't come through. Add them again." };
    }
  }

  const kind = String(form.get("when") ?? "draft");
  const at = String(form.get("at") ?? "").trim();
  let when: PostInput["when"];
  if (kind === "now") when = { kind: "now" };
  else if (kind === "schedule") {
    if (!at) return { ok: false, error: "Pick the day and time it goes." };
    const parsed = parseWhen(at, timeZone);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    if (parsed.kind !== "schedule") return { ok: false, error: "Pick the day and time it goes." };
    when = { kind: "schedule", at: parsed.at };
  } else {
    let day: string | null = null;
    if (at) {
      const parsed = parseWhen(at, timeZone);
      if ("error" in parsed) return { ok: false, error: parsed.error };
      day = parsed.kind === "schedule" ? parsed.at : null;
    }
    when = { kind: "draft", at: day };
  }

  return { ok: true, id, input: { body: String(form.get("body") ?? ""), media, accounts, when } };
}
