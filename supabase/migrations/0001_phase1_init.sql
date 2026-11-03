-- GET TO IT — Phase 1 schema
-- One consistent model: user profiles, goals, tasks, saved task results.
-- Every table is owned by a user and protected by Row Level Security.

create extension if not exists pgcrypto;

do $$
begin
  create type public.task_status as enum ('todo', 'in_progress', 'completed');
exception
  when duplicate_object then null;
end $$;

-- Profiles ---------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (
    display_name is null
    or char_length(btrim(display_name)) between 1 and 80
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Goals -----------------------------------------------------------------

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  desired_outcome text not null check (char_length(btrim(desired_outcome)) between 1 and 2000),
  deadline date,
  time_available_minutes integer not null check (time_available_minutes between 5 and 480),
  blocker text check (
    blocker is null
    or char_length(btrim(blocker)) between 1 and 2000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tasks -----------------------------------------------------------------

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status public.task_status not null default 'todo',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Saved task results (one saved workspace per task) ---------------------

create table if not exists public.task_results (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null default '' check (char_length(content) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists goals_user_id_created_at_idx
  on public.goals (user_id, created_at desc);
create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tasks_goal_id_idx on public.tasks (goal_id);
create index if not exists task_results_user_id_idx on public.task_results (user_id);

-- Timestamps ------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists goals_set_updated_at on public.goals;
create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists task_results_set_updated_at on public.task_results;
create trigger task_results_set_updated_at
  before update on public.task_results
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Keep completed_at consistent with status ------------------------------

create or replace function public.sync_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.completed_at = coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_sync_completed_at on public.tasks;
create trigger tasks_sync_completed_at
  before insert or update on public.tasks
  for each row execute function public.sync_task_completed_at();

-- Create a profile for every new account --------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security ----------------------------------------------------
-- Ownership is enforced here, not only in application code.

alter table public.profiles enable row level security;
alter table public.goals enable row level security;

alter table public.tasks enable row level security;

alter table public.task_results enable row level security;

drop policy if exists "profiles are private to their owner" on public.profiles;
create policy "profiles are private to their owner"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "users can create their own profile" on public.profiles;
create policy "users can create their own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "goals are private to their owner" on public.goals;
create policy "goals are private to their owner"
  on public.goals for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "tasks are private to their owner" on public.tasks;
create policy "tasks are private to their owner"
  on public.tasks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.goals g
      where g.id = tasks.goal_id
        and g.user_id = (select auth.uid())
    )
  );

drop policy if exists "task results are private to their owner" on public.task_results;
create policy "task results are private to their owner"
  on public.task_results for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.tasks t
      join public.goals g on g.id = t.goal_id
      where t.id = task_results.task_id
        and t.user_id = (select auth.uid())
        and g.user_id = (select auth.uid())
    )
  );
