-- When each sent post's numbers are read next (lib/insights.ts: nextMetricsAt).
-- Most networks: hourly for two days, every six hours for two weeks, then
-- daily until 90 days. X charges for every read, so an X post is read four
-- times: an hour, a day, a week and a month after it goes out.
-- Empty: no more reads. Safe to run again.

alter table public.post_targets add column if not exists metrics_next_at timestamptz;

drop index if exists public.post_targets_metrics_idx;
create index if not exists post_targets_metrics_next_idx on public.post_targets (metrics_next_at) where status = 'published';

-- Posts sent before this: next read an hour after the last one.
update public.post_targets
set metrics_next_at = coalesce(metrics_at, published_at) + interval '1 hour'
where status = 'published'
  and metrics_next_at is null
  and published_at > now() - interval '90 days';
