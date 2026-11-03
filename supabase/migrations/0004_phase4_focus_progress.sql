-- GET TO IT — Phase 4 schema
-- Focus sessions, and private weekly check-ins.
--
-- The timer is deliberately server-owned:
--   * elapsed time is derived from stored timestamps, never from a browser
--     counter and never from a number the browser sends;
--   * rows are written only by the security-definer functions at the bottom of
--     this file, so a client cannot invent a duration;
--   * one open session per person (partial unique index) means a double click
--     or a second tab reuses the session instead of starting another one.
--
-- Nothing here can complete a task. `focus_sessions` never writes to `tasks`,
-- and no trigger connects the two.

-- Focus sessions ---------------------------------------------------------

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'paused', 'finished')),
  started_at timestamptz not null default now(),
  -- Whole seconds banked by previous running stretches.
  accumulated_seconds integer not null default 0
    check (accumulated_seconds between 0 and 28800),
  -- Set only while running; the elapsed time is now() minus this.
  segment_started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint focus_sessions_segment_matches_status check (
    (status = 'running' and segment_started_at is not null)
    or (status in ('paused', 'finished') and segment_started_at is null)
  ),
  constraint focus_sessions_finished_at_matches_status check (
    (status = 'finished' and finished_at is not null)
    or (status <> 'finished' and finished_at is null)
  )
);

-- One open session per person: this is what makes a double click safe.
create unique index if not exists focus_sessions_one_open_per_user
  on public.focus_sessions (user_id)
  where finished_at is null;

create index if not exists focus_sessions_user_started_idx
  on public.focus_sessions (user_id, started_at desc);

drop trigger if exists focus_sessions_set_updated_at on public.focus_sessions;
create trigger focus_sessions_set_updated_at
  before update on public.focus_sessions
  for each row execute function public.set_updated_at();

alter table public.focus_sessions enable row level security;

create policy "focus sessions are private to their owner"
  on public.focus_sessions for select to authenticated
  using (user_id = (select auth.uid()));

-- Browsers can read their own sessions but never write one directly, so the
-- recorded time always comes from the server's own clock.
revoke insert, update, delete on public.focus_sessions from anon, authenticated;

-- Weekly check-ins --------------------------------------------------------

create table if not exists public.weekly_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Monday of the week, in UTC, chosen by the server.
  week_start date not null,
  moved_forward text not null default ''
    check (char_length(moved_forward) <= 2000),
  got_in_the_way text not null default ''
    check (char_length(got_in_the_way) <= 2000),
  next_step text not null default ''
    check (char_length(next_step) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists weekly_checkins_user_week_idx
  on public.weekly_checkins (user_id, week_start);

drop trigger if exists weekly_checkins_set_updated_at on public.weekly_checkins;
create trigger weekly_checkins_set_updated_at
  before update on public.weekly_checkins
  for each row execute function public.set_updated_at();

alter table public.weekly_checkins enable row level security;

create policy "check-ins are private to their owner"
  on public.weekly_checkins for select to authenticated
  using (user_id = (select auth.uid()));

create policy "people write their own check-ins"
  on public.weekly_checkins for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "people update their own check-ins"
  on public.weekly_checkins for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Timer maths -------------------------------------------------------------
-- One place that decides how long a session counts as. Eight hours is the
-- ceiling for a single session, so a forgotten timer cannot swallow a day.

create or replace function public.focus_elapsed_seconds(p_session public.focus_sessions)
returns integer
language sql
stable
set search_path = ''
as $$
  select least(
    coalesce(p_session.accumulated_seconds, 0)
      + case
          when p_session.segment_started_at is not null
            then greatest(
              0,
              extract(epoch from (now() - p_session.segment_started_at))::int
            )
          else 0
        end,
    28800
  )
$$;

create or replace function public.focus_payload(p_session public.focus_sessions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_session.id,
    'task_id', p_session.task_id,
    'goal_id', p_session.goal_id,
    'status', p_session.status,
    'started_at', p_session.started_at,
    'finished_at', p_session.finished_at,
    'elapsed_seconds', public.focus_elapsed_seconds(p_session)
  )
$$;

-- Closes sessions that ran into the ceiling, and sessions left open for more
-- than twelve hours (a closed browser, an abandoned tab). Both are recorded at
-- the time they had actually reached, so nothing is invented either way.

create or replace function public.close_stale_focus_sessions(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.focus_sessions s
     set accumulated_seconds = 28800,
         status = 'finished',
         finished_at = coalesce(s.segment_started_at, now()),
         segment_started_at = null
   where s.user_id = p_user
     and s.finished_at is null
     and least(
       s.accumulated_seconds
         + coalesce(
             greatest(0, extract(epoch from (now() - s.segment_started_at))::int),
             0
           ),
       28800
     ) >= 28800;

  update public.focus_sessions s
     set accumulated_seconds = least(
           s.accumulated_seconds
             + coalesce(
                 greatest(0, extract(epoch from (now() - s.segment_started_at))::int),
                 0
               ),
           28800
         ),
         status = 'finished',
         finished_at = coalesce(s.segment_started_at, s.updated_at, now()),
         segment_started_at = null
   where s.user_id = p_user
     and s.finished_at is null
     and coalesce(s.updated_at, s.started_at) < now() - interval '12 hours';
end;
$$;

-- Start (idempotent: an already-open session is returned, not duplicated) --

create or replace function public.start_focus_session(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_goal uuid;
  v_row public.focus_sessions;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  perform public.close_stale_focus_sessions(v_user);

  select * into v_row
    from public.focus_sessions
   where user_id = v_user
     and finished_at is null;

  if found then
    return jsonb_build_object(
      'ok', true, 'reused', true, 'session', public.focus_payload(v_row)
    );
  end if;

  select t.goal_id into v_goal
    from public.tasks t
    join public.goals g on g.id = t.goal_id
   where t.id = p_task_id
     and t.user_id = v_user
     and g.user_id = v_user;

  if v_goal is null then
    return jsonb_build_object('ok', false, 'code', 'no-task');
  end if;

  begin
    insert into public.focus_sessions (user_id, goal_id, task_id, status, segment_started_at)
    values (v_user, v_goal, p_task_id, 'running', now())
    returning * into v_row;
  exception
    when unique_violation then
      select * into v_row
        from public.focus_sessions
       where user_id = v_user
         and finished_at is null;
      return jsonb_build_object(
        'ok', true, 'reused', true, 'session', public.focus_payload(v_row)
      );
  end;

  return jsonb_build_object(
    'ok', true, 'reused', false, 'session', public.focus_payload(v_row)
  );
end;
$$;

-- Pause / resume / finish ------------------------------------------------
-- Each transition only fires from the state it belongs to, and banks the
-- running stretch in the same statement that clears it. Repeating a call is
-- therefore a no-op instead of a double count.

create or replace function public.pause_focus_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.focus_sessions;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  update public.focus_sessions
     set accumulated_seconds = least(
           accumulated_seconds
             + greatest(0, extract(epoch from (now() - segment_started_at))::int),
           28800
         ),
         status = 'paused',
         segment_started_at = null
   where id = p_session_id
     and user_id = v_user
     and status = 'running';

  select * into v_row
    from public.focus_sessions
   where id = p_session_id
     and user_id = v_user;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-session');
  end if;

  return jsonb_build_object('ok', true, 'session', public.focus_payload(v_row));
end;
$$;

create or replace function public.resume_focus_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.focus_sessions;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  update public.focus_sessions
     set status = 'running',
         segment_started_at = now()
   where id = p_session_id
     and user_id = v_user
     and status = 'paused';

  select * into v_row
    from public.focus_sessions
   where id = p_session_id
     and user_id = v_user;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-session');
  end if;

  return jsonb_build_object('ok', true, 'session', public.focus_payload(v_row));
end;
$$;

create or replace function public.finish_focus_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.focus_sessions;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  update public.focus_sessions
     set accumulated_seconds = least(
           accumulated_seconds
             + coalesce(
                 greatest(0, extract(epoch from (now() - segment_started_at))::int),
                 0
               ),
           28800
         ),
         status = 'finished',
         finished_at = now(),
         segment_started_at = null
   where id = p_session_id
     and user_id = v_user
     and finished_at is null;

  select * into v_row
    from public.focus_sessions
   where id = p_session_id
     and user_id = v_user;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-session');
  end if;

  -- A second Finish returns the stored total instead of adding more time.
  return jsonb_build_object('ok', true, 'session', public.focus_payload(v_row));
end;
$$;

-- The one call the pages use: open session (if any) plus recorded totals.

create or replace function public.focus_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.focus_sessions;
  v_today integer;
  v_week integer;
  v_total integer;
  v_count integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  perform public.close_stale_focus_sessions(v_user);

  select * into v_row
    from public.focus_sessions
   where user_id = v_user
     and finished_at is null;

  if not found then
    v_row := null;
  end if;

  select
    coalesce(
      sum(public.focus_elapsed_seconds(s)) filter (
        where s.started_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
      ),
      0
    )::int,
    coalesce(
      sum(public.focus_elapsed_seconds(s)) filter (
        where s.started_at >= (date_trunc('week', now() at time zone 'utc') at time zone 'utc')
      ),
      0
    )::int,
    coalesce(sum(public.focus_elapsed_seconds(s)), 0)::int,
    count(*)::int
  into v_today, v_week, v_total, v_count
  from public.focus_sessions s
  where s.user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'session', case
      when v_row.id is null then null
      else public.focus_payload(v_row)
    end,
    'totals', jsonb_build_object(
      'today_seconds', v_today,
      'week_seconds', v_week,
      'total_seconds', v_total,
      'session_count', v_count
    )
  );
end;
$$;

-- Only signed-in people may call these, and only these functions may write.

revoke all on function public.focus_elapsed_seconds(public.focus_sessions) from public, anon;
revoke all on function public.focus_payload(public.focus_sessions) from public, anon;
revoke all on function public.close_stale_focus_sessions(uuid) from public, anon;
revoke all on function public.start_focus_session(uuid) from public, anon;
revoke all on function public.pause_focus_session(uuid) from public, anon;
revoke all on function public.resume_focus_session(uuid) from public, anon;
revoke all on function public.finish_focus_session(uuid) from public, anon;
revoke all on function public.focus_snapshot() from public, anon;

grant execute on function public.start_focus_session(uuid) to authenticated;
grant execute on function public.pause_focus_session(uuid) to authenticated;
grant execute on function public.resume_focus_session(uuid) to authenticated;
grant execute on function public.finish_focus_session(uuid) to authenticated;
grant execute on function public.focus_snapshot() to authenticated;
