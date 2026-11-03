-- GET TO IT — Phase 11 schema
-- Optional work preferences, preference-aware suggestions, and an approved
-- daily plan built from tasks that already exist.
--
-- Ground rules encoded here:
--   * Everything is optional. A missing preference is NULL, never a guess.
--   * Preferences are only ever written by the person who owns them: RLS on the
--     table, and the daily plan is written through a security-definer function
--     that checks ownership again.
--   * Approving a daily plan only records a selection. It never changes a
--     deadline, a plan, a reminder, a task status or saved work, and a task that
--     was not selected is simply not in the selection.
--   * No sensitive traits are stored. The columns are work habits a person
--     typed: session length, days, hours, task size, style and topics.

-- ---------------------------------------------------------------------------
-- 1. Preferences
-- ---------------------------------------------------------------------------

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  session_length_minutes integer
    check (session_length_minutes is null or session_length_minutes between 5 and 240),
  -- 0 = Sunday. NULL means "no usual days chosen".
  work_days smallint[],
  work_start time,
  work_end time,
  task_size text check (task_size is null or task_size in ('small', 'medium', 'large')),
  communication_style text
    check (communication_style is null or communication_style in ('concise', 'encouraging', 'detailed')),
  help_topics text[],
  personalization_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint user_preferences_work_days_valid check (
    work_days is null
    or (
      work_days <@ '{0,1,2,3,4,5,6}'::smallint[]
      and coalesce(array_length(work_days, 1), 0) between 1 and 7
    )
  ),
  constraint user_preferences_work_hours_valid check (
    (work_start is null and work_end is null)
    or (work_start is not null and work_end is not null and work_start < work_end)
  )
);

-- Topic lists are small and each entry is a short phrase. Checked in a trigger
-- because a CHECK cannot hold the unnest subquery.
create or replace function public.user_preferences_check_topics()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.help_topics is not null then
    if cardinality(new.help_topics) > 8 then
      raise exception 'user_preferences: at most 8 topics';
    end if;
    if exists (
      select 1 from unnest(new.help_topics) as topic
       where char_length(btrim(topic)) not between 1 and 80
    ) then
      raise exception 'user_preferences: topics are 1-80 characters';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists user_preferences_check_topics on public.user_preferences;
create trigger user_preferences_check_topics
  before insert or update on public.user_preferences
  for each row execute function public.user_preferences_check_topics();

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

alter table public.user_preferences enable row level security;

create policy "people manage their own preferences"
  on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.user_preferences from anon;
grant select, insert, update, delete on public.user_preferences to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Daily plans
-- ---------------------------------------------------------------------------
-- One approved selection per local day. `task_ids` holds only ids that existed
-- and belonged to the person at the moment they approved it; the function below
-- is the only writer, and it never touches the tasks themselves.

create table if not exists public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  minutes_available integer not null check (minutes_available between 5 and 1440),
  task_ids uuid[] not null check (cardinality(task_ids) between 1 and 20),
  total_minutes integer not null default 0 check (total_minutes >= 0),
  unknown_estimates integer not null default 0 check (unknown_estimates >= 0),
  over_limit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create index if not exists daily_plans_user_day_idx
  on public.daily_plans (user_id, day desc);

drop trigger if exists daily_plans_set_updated_at on public.daily_plans;
create trigger daily_plans_set_updated_at
  before update on public.daily_plans
  for each row execute function public.set_updated_at();

alter table public.daily_plans enable row level security;

create policy "people read their own daily plans"
  on public.daily_plans for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.daily_plans from anon, authenticated;
grant select on public.daily_plans to authenticated;

-- Approving a selection ---------------------------------------------------
-- Verifies every id belongs to the caller and is still open, totals the known
-- estimates itself (the browser never sends a total), and refuses an overspend
-- of time unless the person explicitly confirmed the warning.

create or replace function public.save_daily_plan(
  p_day date,
  p_minutes integer,
  p_task_ids uuid[],
  p_allow_over_limit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
  v_total integer;
  v_unknown integer;
  v_row public.daily_plans;
  v_over boolean;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_day is null or p_day < current_date - 7 or p_day > current_date + 7 then
    return jsonb_build_object('ok', false, 'code', 'invalid-day');
  end if;

  if p_minutes is null or p_minutes < 5 or p_minutes > 1440 then
    return jsonb_build_object('ok', false, 'code', 'invalid-minutes');
  end if;

  if p_task_ids is null
     or cardinality(p_task_ids) < 1
     or cardinality(p_task_ids) > 20
     or cardinality(p_task_ids) <> cardinality(array(select distinct unnest(p_task_ids))) then
    return jsonb_build_object('ok', false, 'code', 'invalid-selection');
  end if;

  select count(*),
         coalesce(sum(coalesce(t.estimated_minutes, 0)), 0),
         count(*) filter (where t.estimated_minutes is null)
    into v_count, v_total, v_unknown
    from public.tasks t
    join public.goals g on g.id = t.goal_id
   where t.id = any (p_task_ids)
     and t.user_id = v_user
     and g.user_id = v_user
     and t.status <> 'completed';

  -- A foreign id, a deleted task, a completed task or a duplicate all fail the
  -- same way: nothing is written and the message says the list changed.
  if v_count <> cardinality(p_task_ids) then
    return jsonb_build_object('ok', false, 'code', 'unknown-task');
  end if;

  v_over := v_total > p_minutes;

  if v_over and not coalesce(p_allow_over_limit, false) then
    return jsonb_build_object(
      'ok', false,
      'code', 'over-limit',
      'total_minutes', v_total,
      'unknown_estimates', v_unknown
    );
  end if;

  insert into public.daily_plans (
    user_id, day, minutes_available, task_ids, total_minutes, unknown_estimates, over_limit
  )
  values (v_user, p_day, p_minutes, p_task_ids, v_total, v_unknown, v_over)
  on conflict (user_id, day) do update
    set minutes_available = excluded.minutes_available,
        task_ids = excluded.task_ids,
        total_minutes = excluded.total_minutes,
        unknown_estimates = excluded.unknown_estimates,
        over_limit = excluded.over_limit,
        updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'plan', jsonb_build_object(
      'id', v_row.id,
      'day', v_row.day,
      'minutes_available', v_row.minutes_available,
      'task_ids', v_row.task_ids,
      'total_minutes', v_row.total_minutes,
      'unknown_estimates', v_row.unknown_estimates,
      'over_limit', v_row.over_limit
    )
  );
end;
$$;

revoke all on function public.save_daily_plan(date, integer, uuid[], boolean) from public, anon;
grant execute on function public.save_daily_plan(date, integer, uuid[], boolean) to authenticated;
