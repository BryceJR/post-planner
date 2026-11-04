import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={40} height={40} className="rounded-xl" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Post Planner</h1>
          <p className="text-sm text-ink-soft">Your social media calendar</p>
        </div>
      </div>
      <LoginForm next={next ?? ""} />
    </main>
  );
}
