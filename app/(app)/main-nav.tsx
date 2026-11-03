"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Calendar", match: (p: string) => p === "/" || p.startsWith("/posts") },
  { href: "/insights", label: "Insights", match: (p: string) => p.startsWith("/insights") },
  { href: "/accounts", label: "Accounts", match: (p: string) => p.startsWith("/accounts") },
];

export function MainNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1" aria-label="Main">
      {LINKS.map((l) => {
        const on = l.match(path);
        return (
          <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${on ? "bg-spruce-tint text-spruce-deep" : "text-ink-soft hover:text-ink"}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
