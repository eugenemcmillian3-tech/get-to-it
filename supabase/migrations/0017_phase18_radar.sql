-- GET TO IT — Phase 18 schema
-- The opt-in "what's changing?" radar.
--
-- Ground rules encoded here:
--   * Nothing is fetched. There is no feed table, no crawler credential, no
--     remote-account link and no column where a scraped private account could be
--     stored. A signal exists because a person recorded it after reading a
--     source, and the source link is kept for attribution only.
--   * Publication and retrieval are separate columns, so an old item can never
--     be displayed as new.
--   * `kind` is a closed list, so an announcement stays an announcement and is
--     never silently stored as a released capability or a research result.
--   * `dedupe_key` is unique per person, so the same source at the same
--     publication date cannot be stored twice under a retyped headline.
--   * Topic opt-in lives in its own table. A person who follows no topic has no
--     radar, and muting hides a topic's signals without deleting anything.
--   * Preparing a task or a learning goal is a separate record created by an
--     explicit action; nothing changes a plan on its own.
--   * Owner-only under RLS, and every write is also checked against the session.

create table if not exists public.radar_topics (
  user_id uuid not null references auth.users (id) on delete cascade,
  topic text not null check (topic in ('ai', 'work', 'business', 'education', 'community', 'policy')),
  muted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, topic)
);

comment on table public.radar_topics is
  'Opt-in radar topics. A row means the person follows it; muted_at hides its signals without deleting them.';

create table if not exists public.radar_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  topic text not null check (topic in ('ai', 'work', 'business', 'education', 'community', 'policy')),
  kind text not null check (kind in ('announced', 'released', 'research', 'opinion', 'speculation', 'observed')),
  headline text not null check (char_length(btrim(headline)) between 8 and 200),
  source_name text not null check (char_length(btrim(source_name)) between 2 and 80),
  source_url text not null check (
    source_url ~* '^https?://[^[:space:]]+$' and char_length(source_url) <= 500
  ),
  published_on date not null,
  retrieved_at timestamptz not null default now(),
  geography text check (geography is null or char_length(geography) <= 80),
  sector text check (sector is null or char_length(sector) <= 80),
  uncertainty text not null check (char_length(btrim(uncertainty)) between 10 and 600),
  goal_id uuid references public.goals (id) on delete set null,
  dedupe_key text not null check (char_length(dedupe_key) between 8 and 300),
  saved_at timestamptz,
  dismissed_at timestamptz,
  experiment_task_id uuid references public.tasks (id) on delete set null,
  learning_goal_id uuid references public.goals (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

comment on table public.radar_signals is
  'One record of something a person read, with its source, both dates and its own uncertainty. Never fetched by the app.';

comment on column public.radar_signals.published_on is
  'The date the source says the item appeared. Never replaced by the retrieval date.';

comment on column public.radar_signals.retrieved_at is
  'When the person recorded the signal in GET TO IT.';

create index if not exists radar_signals_user_idx
  on public.radar_signals (user_id, published_on desc);

create index if not exists radar_signals_user_topic_idx
  on public.radar_signals (user_id, topic, published_on desc);

drop trigger if exists radar_signals_set_updated_at on public.radar_signals;
create trigger radar_signals_set_updated_at before update on public.radar_signals
  for each row execute function public.set_updated_at();

alter table public.radar_topics enable row level security;
alter table public.radar_signals enable row level security;

drop policy if exists "people read their own radar topics" on public.radar_topics;
create policy "people read their own radar topics" on public.radar_topics
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people add their own radar topics" on public.radar_topics;
create policy "people add their own radar topics" on public.radar_topics
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "people update their own radar topics" on public.radar_topics;
create policy "people update their own radar topics" on public.radar_topics
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people remove their own radar topics" on public.radar_topics;
create policy "people remove their own radar topics" on public.radar_topics
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people read their own radar signals" on public.radar_signals;
create policy "people read their own radar signals" on public.radar_signals
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people add their own radar signals" on public.radar_signals;
create policy "people add their own radar signals" on public.radar_signals
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.radar_topics t
       where t.user_id = (select auth.uid()) and t.topic = radar_signals.topic
    )
  );

drop policy if exists "people update their own radar signals" on public.radar_signals;
create policy "people update their own radar signals" on public.radar_signals
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people delete their own radar signals" on public.radar_signals;
create policy "people delete their own radar signals" on public.radar_signals
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.radar_topics to authenticated;
grant select, insert, update, delete on public.radar_signals to authenticated;

revoke all on public.radar_topics from anon;
revoke all on public.radar_signals from anon;
