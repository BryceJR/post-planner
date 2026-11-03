import { describe, expect, it } from "vitest";
import { parsePostForm } from "./form";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const LA = "America/Los_Angeles";

function form(fields: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
}

describe("parsePostForm", () => {
  it("reads accounts, own wording, settings, media and the time", () => {
    const r = parsePostForm(
      form([
        ["body", "Hello"],
        ["account", A],
        ["account", B],
        ["account", "not-an-id"],
        [`own_${B}`, "on"],
        [`text_${B}`, "Hi X"],
        [`text_${A}`, "ignored: own_ not ticked"],
        [`set_${A}_title`, "My video"],
        [`set_${A}_madeForKids__present`, "1"],
        [`set_${B}_allowDuet__present`, "1"],
        [`set_${B}_allowDuet`, "on"],
        ["media", JSON.stringify([{ url: "https://x.supabase.co/storage/v1/object/public/media/a.mp4", path: "a.mp4", kind: "video", mime: "video/mp4", duration: 12 }, { url: "javascript:1" }])],
        ["when", "schedule"],
        ["at", "2026-11-05T09:00"],
      ]),
      LA
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.accounts).toEqual([
      { id: A, body: null, settings: { title: "My video", madeForKids: false } },
      { id: B, body: "Hi X", settings: { allowDuet: true } },
    ]);
    expect(r.input.media).toEqual([{ url: "https://x.supabase.co/storage/v1/object/public/media/a.mp4", path: "a.mp4", kind: "video", mime: "video/mp4", size: null, width: null, height: null, duration: 12, alt: null }]);
    expect(r.input.when).toEqual({ kind: "schedule", at: "2026-11-05T17:00:00.000Z" });
  });
  it("schedule needs a time; now and draft don't", () => {
    expect(parsePostForm(form([["when", "schedule"]]), LA)).toMatchObject({ ok: false });
    expect(parsePostForm(form([["when", "now"]]), LA)).toMatchObject({ ok: true, input: { when: { kind: "now" } } });
    expect(parsePostForm(form([["when", "draft"], ["at", "2026-11-05T09:00"]]), LA)).toMatchObject({ ok: true, input: { when: { kind: "draft", at: "2026-11-05T17:00:00.000Z" } } });
  });
  it("keeps an edited post's id and refuses a broken one", () => {
    expect(parsePostForm(form([["post_id", A]]), LA)).toMatchObject({ ok: true, id: A });
    expect(parsePostForm(form([["post_id", "x"]]), LA)).toMatchObject({ ok: false });
  });
});
