-- Minimal, privacy-preserving sink for unhandled server exceptions.
-- Stores only routing metadata, an error class name and stack frames. It never
-- stores the error message, request body, headers, cookies, user id or email.
create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  environment text not null default 'unknown'
    check (char_length(environment) between 1 and 40),
  release text
    check (release is null or char_length(release) <= 80),
  runtime text not null
    check (runtime in ('nodejs', 'edge')),
  route_path text not null
    check (char_length(route_path) between 1 and 300),
  method text not null
    check (char_length(method) between 1 and 12),
  error_name text not null
    check (char_length(error_name) between 1 and 120),
  digest text
    check (digest is null or char_length(digest) <= 120),
  stack_frames text
    check (stack_frames is null or char_length(stack_frames) <= 8000)
);

create index if not exists error_events_occurred_at_idx
  on public.error_events (occurred_at desc);

alter table public.error_events enable row level security;

revoke all on table public.error_events from public, anon, authenticated;
grant insert, select, update, delete on table public.error_events to service_role;
