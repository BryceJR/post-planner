# Post Planner

Your own social media calendar: plan posts for X, Facebook, Instagram,
LinkedIn, YouTube, TikTok, Reddit and Bluesky; schedule them or post them now;
see how they did (views, likes, comments, shares, followers). An AI assistant
(Grok, Claude, ChatGPT…) can do all of it from a chat, through the connector at
`/api/mcp`.

It's a Next.js app with a Supabase database, made to run on Vercel. One person
signs in, with a password.

## What each network allows

Each network needs its own developer app (the **Accounts** page says where to
make it and which callback URL to register). Some hold things back until they
review that app. This is the part a paid service like Postiz does for you.

| Network | Posts | Insights | Until the network reviews the app |
|---|---|---|---|
| X | text, up to 4 pictures, or a video | views, likes, replies, reposts, bookmarks; followers | depends on your X developer plan (posting and reading are limited or paid) |
| Facebook Pages | text, pictures, or a video | reactions, comments, shares, reach; followers | works for your own Pages; switch the Meta app to Live so posts are public |
| Instagram (business or creator, linked to a Page) | pictures (carousel), or a Reel | likes, comments, views, reach, saves, shares; followers | works for your own accounts |
| LinkedIn | text, pictures, or a video | company pages only (LinkedIn shares none for personal profiles) | company pages need LinkedIn's approval (Community Management API) |
| YouTube | one video, with title, privacy, tags | views, likes, comments; subscribers | **every upload is private** until Google audits the app (free form; weeks to months) |
| TikTok | one video, with privacy and comments / duet / stitch | views, likes, comments, shares; followers | **only to a private account, visible to you**, until TikTok audits the app |
| Reddit | a text post or a picture post, to a subreddit or your profile | score, comments; profile followers | Reddit now reviews new API apps and may ask you to request access |
| Bluesky | text, up to 4 pictures | likes, replies, reposts; followers | nothing to review: an app password |

Videos aren't sent to Reddit or Bluesky yet. Files are up to 50 MB (the
Supabase free plan's limit); MP4 works everywhere.

## Setup

1. **Database.** A Supabase project (the free plan is fine). In its SQL Editor,
   run `supabase/migrations/0001_init.sql`. It's safe to run again.
2. **Vercel.** New Project → import this repository → add these Environment
   Variables (see `.env.example`), then Deploy:
   - `APP_PASSWORD`: the password you'll sign in with.
   - `SESSION_SECRET`: a random string of 32+ characters (`openssl rand -base64 32`).
   - `SUPABASE_URL` and `SUPABASE_SECRET_KEY`: Supabase → Project Settings → API (the secret / service_role key).
   - `APP_URL`: the address Vercel gives the app, like `https://post-planner.vercel.app`.
   - `CRON_SECRET`: any long random string.
3. **The every-minute run.** Scheduled posts go out, videos that a network is
   still processing are checked, and insights refresh when something calls
   `/api/cron/run` every minute. Sign in → **Accounts → Scheduled posts → Set
   up the every-minute run**: paste that SQL into Supabase's SQL Editor with
   your `CRON_SECRET`. (Vercel Pro can do it instead with a `vercel.json`
   cron; Vercel's free plan only runs crons once a day.)
4. **Networks.** For each one you use, make its developer app, add its two
   keys in Vercel (names on the Accounts page and in `.env.example`), redeploy,
   then press **Connect** on the Accounts page. Bluesky only needs an app password.
5. **Your AI assistant.** Accounts → AI assistants has the connector address.
   - **Grok:** grok.com → Connectors → New connector → Custom → paste the address → Connect → sign in and **Allow**.
   - **Claude:** claude.ai → Settings → Connectors → Add custom connector → paste → Connect → **Allow**.
   - Apps that send a key instead (Claude Code, the xAI API): make one under Accounts → AI assistants.

## How it behaves

- **Nothing posts twice.** A post is claimed before it's sent. A send that
  fails shows as **Didn't go** with the network's reason, and goes again only
  when you press **Try again** (or ask the assistant to).
- **Drafts can be incomplete.** What a network needs (a video for YouTube, a
  subreddit for Reddit) is checked when the post is scheduled or sent.
- **Videos the network is still processing** (TikTok, Instagram Reels, X,
  LinkedIn) show as *being processed*, and the every-minute run finishes them.
- **Insights** refresh hourly for a post's first two days, every six hours
  for two weeks, then daily until 90 days. Followers are counted once a day.

## Working on it

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
npm test                     # the rules, the sign-in, the connector, the networks' helpers
```

Code map: `lib/networks/*` (each network: sign-in, posting, numbers),
`lib/publish.ts` (sending and the every-minute run), `lib/insights.ts`,
`lib/store.ts` (the database), `lib/checks.ts` (each network's rules),
`lib/mcp/*` and `lib/ai/*` (the AI connector and its sign-in), `app/` (pages
and routes).
