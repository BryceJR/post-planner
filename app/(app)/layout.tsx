import Link from "next/link";
import { requireSignedIn } from "@/lib/auth";
import { signOut } from "../login/actions";
import { MainNav } from "./main-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSignedIn();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={28} height={28} className="rounded-lg" />
            Post Planner
          </Link>
          <MainNav />
          <div className="ml-auto flex items-center gap-4 text-sm">
            <Link href="/posts/new" className="rounded-lg bg-spruce px-3.5 py-2 font-semibold text-on-spruce hover:brightness-110">
              New post
            </Link>
            <form action={signOut}>
              <button type="submit" className="font-semibold text-ink-soft hover:text-ink">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
