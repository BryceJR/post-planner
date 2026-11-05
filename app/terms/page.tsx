import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="November 5, 2026">
      <p>
        Post Planner is a personal tool for its owner, who uses it to plan and publish posts to their own social media accounts. It isn&apos;t offered
        to anyone else.
      </p>
      <h2>Using it</h2>
      <ul>
        <li>What&apos;s posted through Post Planner is the owner&apos;s, and the owner is responsible for it.</li>
        <li>Each network&apos;s own terms and rules apply to what&apos;s posted there.</li>
        <li>Post Planner only acts on accounts its owner connected, and only does what the owner (or an assistant the owner allowed) asks.</li>
      </ul>
      <h2>No warranty</h2>
      <p>
        It&apos;s provided as is. A network can change or limit what it allows at any time, so a post may not go out, or its numbers may not be
        available.
      </p>
      <p>
        See the <a className="font-semibold text-spruce underline" href="/privacy">privacy policy</a> for what it keeps and how to delete it.
      </p>
    </LegalPage>
  );
}
