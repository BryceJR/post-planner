// Pictures and videos for the composer. The browser asks for a one-time
// upload link (ticket), uploads straight to storage, then says it's done
// (finish): a picture is made post-ready, a video is kept as it is. Or it
// hands over a link to a file already online (link). lib/media.ts.
import { NextResponse } from "next/server";
import { signedIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { finishUpload, importFromUrl, uploadTicket } from "@/lib/media";

export const dynamic = "force-dynamic";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export async function POST(request: Request) {
  if (!(await signedIn())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    if (body.action === "ticket") {
      return NextResponse.json(await uploadTicket(db(), { mime: String(body.mime ?? ""), size: Number(body.size ?? 0) }));
    }
    if (body.action === "finish") {
      return NextResponse.json(await finishUpload(db(), String(body.path ?? ""), { width: num(body.width), height: num(body.height), duration: num(body.duration) }));
    }
    if (body.action === "link") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) return NextResponse.json({ error: "Paste a link to a picture or video." }, { status: 400 });
      return NextResponse.json(await importFromUrl(db(), url));
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The file couldn't be saved." }, { status: 400 });
  }
}
