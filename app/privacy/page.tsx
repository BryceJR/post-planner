import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="November 5, 2026">
      <p>
        Post Planner is a personal tool. Its owner uses it to plan posts and publish them to their own social media accounts (Facebook Pages,
        Instagram, LinkedIn, X, YouTube, TikTok and Bluesky), and to see how those posts do. Nobody else signs in to it.
      </p>

      <h2>What it keeps</h2>
      <ul>
        <li>The sign-in tokens each network gives when the owner connects an account, so it can post and read that account&apos;s numbers.</li>
        <li>The account&apos;s name, handle and picture, as the network shares them.</li>
        <li>The posts the owner writes or schedules: their text, pictures and videos, and when they go out.</li>
        <li>The numbers the networks share about those posts (views, likes, comments, shares and the like) and the accounts&apos; follower counts.</li>
      </ul>
      <p>All of it is stored in the app&apos;s own database and file storage, and only the owner can see it.</p>

      <h2>How it&apos;s used</h2>
      <p>
        Only to publish the owner&apos;s posts to the owner&apos;s accounts and to show the owner how they did. Post Planner doesn&apos;t sell or share
        any of it, doesn&apos;t show ads, and doesn&apos;t read anyone else&apos;s accounts. The only cookie it sets is the owner&apos;s sign-in.
      </p>

      <h2>Deleting your data</h2>
      <ul>
        <li>Disconnecting an account on the Accounts page deletes its sign-in tokens right away.</li>
        <li>Deleting a post removes it and its numbers from Post Planner. A post that already went out stays on the network until it&apos;s deleted there.</li>
        <li>
          You can also remove Post Planner&apos;s access from the network itself, for example Facebook → Settings → Apps and websites, or LinkedIn →
          Settings → Data privacy → Permitted services. It can&apos;t reach the account after that.
        </li>
      </ul>
    </LegalPage>
  );
}
