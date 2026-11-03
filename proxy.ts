// Runs before every request: signed-out visitors go to /login (and come back
// to where they were going); the API answers 401 instead. The AI connector,
// its sign-in documents and the every-minute run check their own keys.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionValid } from "@/lib/session";

const OPEN = ["/login", "/api/mcp", "/.well-known", "/api/cron"];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (OPEN.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next();
  if (sessionValid(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const to = request.nextUrl.clone();
  to.pathname = "/login";
  to.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
  return NextResponse.redirect(to);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
