// The frame for the privacy policy and the terms: public pages the networks
// ask for when an app goes live (Meta, TikTok, Google).

export function contactLine(env: Record<string, string | undefined> = process.env): string | null {
  const email = env.CONTACT_EMAIL?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  const email = contactLine();
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={40} height={40} className="rounded-xl" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-ink-soft">Post Planner · updated {updated}</p>
        </div>
      </div>
      <div className="space-y-4 text-base leading-relaxed [&_h2]:pt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
        {children}
        {email && (
          <>
            <h2>Contact</h2>
            <p>
              Questions or requests: <a className="font-semibold text-spruce underline" href={`mailto:${email}`}>{email}</a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
