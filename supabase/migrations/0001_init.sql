-- 0001: Post Planner's tables.
--
-- One person's social media calendar: the accounts it posts to, the posts
-- (with their pictures and videos), how each went on each account, the
-- numbers each network reports back (insights), and the AI assistants
-- (Grok, Claude…) allowed to work it through the connector at /api/mcp.
--
-- Only the app's server reads or writes any of it, with the project's secret
-- (service role) key: row security is on with no policies, and nothing is
-- granted to the browser's anon or signed-in roles.
-- Safe to run again.

-- ---------------------------------------------------------------
-- Settings: one row
-- ---------------------------------------------------------------
create table if not exists public.settings (
  id               boolean primary key default true check (id),
  timezone         text not null default 'America/Los_Angeles' check (char_length(timezone) between 1 and 64),
  last_run_at      timestamptz,      -- the every-minute run, last seen
  last_stats_day   date,             -- the day follower counts were last taken
  updated_at       timestamptz not null default now()
);
insert into public.settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- Accounts: an X account, a Facebook Page, an Instagram business account,
-- a LinkedIn profile or page, a YouTube channel, a TikTok account, a Reddit
-- account, a Bluesky account. Disconnecting keeps the row (status 'off',
-- tokens cleared) so past posts and their numbers stay.
-- ---------------------------------------------------------------
create table if not exists public.accounts (
  id            uuid primary key default gen_random_uuid(),
  platform      text not null check (platform in ('x', 'facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'reddit', 'bluesky')),
  external_id   text not null check (char_length(external_id) between 1 and 200),
  name          text not null check (char_length(btrim(name)) between 1 and 200),
  handle        text check (handle is null or char_length(handle) <= 200),
  avatar_url    text check (avatar_url is null or char_length(avatar_url) <= 2000),
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  extra         jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  status        text not null default 'connected' check (status in ('connected', 'reconnect', 'off')),
  last_error    text check (last_error is null or char_length(last_error) <= 2000),
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (platform, external_id)
);

-- ---------------------------------------------------------------
-- Posts. media: [{url, path, kind: image|video, mime, size, width, height,
-- duration, alt}], public URLs in the media bucket. 'publishing' is a post
-- the run has claimed; it is never claimed twice.
-- ---------------------------------------------------------------
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  body         text not null default '' check (char_length(body) <= 10000),
  media        jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 10),
  status       text not null default 'draft' check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  scheduled_at timestamptz,
  claimed_at   timestamptz,
  published_at timestamptz,
  created_by   text check (created_by is null or char_length(created_by) <= 254),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint posts_scheduled_has_time check (status <> 'scheduled' or scheduled_at is not null)
);
create index if not exists posts_due_idx on public.posts (scheduled_at) where status = 'scheduled';
create index if not exists posts_scheduled_at_idx on public.posts (scheduled_at);

-- ---------------------------------------------------------------
-- Where each post goes, one row per account: its own wording and settings
-- (a YouTube title, a subreddit, TikTok's privacy), how it went, and its
-- latest numbers. 'processing' waits on the network (a video being
-- processed): `progress` holds what's needed to carry on, `check_at` when.
-- ---------------------------------------------------------------
create table if not exists public.post_targets (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  body         text check (body is null or char_length(body) <= 10000),
  settings     jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  status       text not null default 'pending' check (status in ('pending', 'publishing', 'processing', 'published', 'failed')),
  progress     jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object'),
  check_at     timestamptz,
  external_id  text check (external_id is null or char_length(external_id) <= 500),
  external_url text check (external_url is null or char_length(external_url) <= 2000),
  error        text check (error is null or char_length(error) <= 2000),
  attempted_at timestamptz,
  published_at timestamptz,
  metrics      jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  metrics_at   timestamptz,
  unique (post_id, account_id)
);
create index if not exists post_targets_account_id_idx on public.post_targets (account_id);
create index if not exists post_targets_processing_idx on public.post_targets (check_at) where status = 'processing';
create index if not exists post_targets_metrics_idx on public.post_targets (metrics_at) where status = 'published';

-- ---------------------------------------------------------------
-- Insights over time: a post's numbers at each refresh, and each
-- account's followers once a day.
-- ---------------------------------------------------------------
create table if not exists public.metric_snapshots (
  id        bigint generated always as identity primary key,
  target_id uuid not null references public.post_targets(id) on delete cascade,
  taken_at  timestamptz not null default now(),
  views     bigint,
  likes     bigint,
  comments  bigint,
  shares    bigint,
  saves     bigint,
  clicks    bigint,
  reach     bigint
);
create index if not exists metric_snapshots_target_idx on public.metric_snapshots (target_id, taken_at);

create table if not exists public.account_stats (
  account_id uuid not null references public.accounts(id) on delete cascade,
  day        date not null,
  followers  bigint,
  extra      jsonb not null default '{}'::jsonb,
  primary key (account_id, day)
);

-- ---------------------------------------------------------------
-- The AI connector's sign-in (OAuth 2.1, so Grok's "add a connector"
-- works): the apps that registered themselves, each "Allow" (listed on
-- Accounts → AI assistants, where each can be disconnected), and the codes
-- and tokens issued under it (only their SHA-256 kept). A key made for apps
-- that take one (kind 'key') is a grant with no client.
-- ---------------------------------------------------------------
create table if not exists public.ai_clients (
  id            uuid primary key default gen_random_uuid(),
  client_id     text not null unique check (char_length(client_id) between 16 and 100),
  secret_hash   text check (secret_hash is null or secret_hash ~ '^[0-9a-f]{64}$'),
  name          text not null default 'AI assistant' check (char_length(btrim(name)) between 1 and 200),
  redirect_uris text[] not null default '{}' check (cardinality(redirect_uris) between 0 and 10),
  auth_method   text not null default 'none' check (auth_method in ('none', 'client_secret_post', 'client_secret_basic')),
  created_at    timestamptz not null default now()
);

create table if not exists public.ai_grants (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.ai_clients(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 200),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists ai_grants_client_id_idx on public.ai_grants (client_id);

create table if not exists public.ai_tokens (
  hash         text primary key check (hash ~ '^[0-9a-f]{64}$'),
  grant_id     uuid not null references public.ai_grants(id) on delete cascade,
  kind         text not null check (kind in ('code', 'access', 'refresh', 'key')),
  expires_at   timestamptz,
  used_at      timestamptz,
  redirect_uri text check (redirect_uri is null or char_length(redirect_uri) <= 2000),
  challenge    text check (challenge is null or char_length(challenge) between 43 and 128),
  created_at   timestamptz not null default now(),
  constraint ai_tokens_expiry check (kind = 'key' or expires_at is not null)
);
create index if not exists ai_tokens_grant_id_idx on public.ai_tokens (grant_id);
create index if not exists ai_tokens_expires_at_idx on public.ai_tokens (expires_at);

-- ---------------------------------------------------------------
-- Pictures and videos: public, so Instagram, Facebook and the rest can
-- fetch them by their URL. Only the server writes (signed upload links
-- for the browser). 50 MB a file, the Supabase free plan's limit.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- The server key only
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['settings', 'accounts', 'posts', 'post_targets', 'metric_snapshots', 'account_stats', 'ai_clients', 'ai_grants', 'ai_tokens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;
