"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeLocalPath } from "@/lib/safe-path";
import { makeSession, passwordMatches, SESSION_COOKIE } from "@/lib/session";

export type LoginState = { error: string } | null;

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  if (!process.env.APP_PASSWORD || (process.env.APP_PASSWORD ?? "").length < 8) return { error: "APP_PASSWORD isn't set (at least 8 characters). Add it in Vercel → Settings → Environment Variables." };
  if ((process.env.SESSION_SECRET ?? "").length < 32) return { error: "SESSION_SECRET isn't set (a random string of at least 32 characters). Add it in Vercel → Settings → Environment Variables." };
  if (!passwordMatches(String(form.get("password") ?? ""))) {
    // a moment's pause makes guessing slow
    await new Promise((r) => setTimeout(r, 1200));
    return { error: "That's not the password." };
  }
  const session = makeSession();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: session.maxAge });
  const next = safeLocalPath(String(form.get("next") ?? ""));
  redirect(next && !next.startsWith("/login") ? next : "/");
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
