-- GET TO IT — Phase 6 schema
-- Optional reminders and a daily check-in, delivered inside the app.
--
-- Design notes:
--   * Everything is opt-in twice: reminders exist only when made, and the whole
--     feature can be switched off in settings.
--   * Delivery is a row, once per due slot. `dedupe_key` is UNIQUE, so a
--     repeated scheduler run or a page-load catch-up cannot deliver twice.
--   * Quiet hours defer a reminder instead of dropping it: the due time and its
--     dedupe key stay the same, so it is delivered once when quiet hours end.
--   * Completed and deleted targets never deliver. Deleted targets disappear
--     through the cascading foreign keys; completed tasks are skipped and their
--     reminder is simply rescheduled.
--   * Nothing is sent anywhere: deliveries are in-app rows only, and no content
--     leaves the database for a third party.

-- Settings ----------------------------------------------------------------

create table if not exists public.reminder_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'UTC'
    check (char_length(timezone) between 1 and 64),
  remind_at time not null default '09:00',
  -- 0 = Sunday. Default: weekdays.
  weekdays smallint[] not null default '{1,2,3,4,5}',
  quiet_from time not null default '21:00',
  quiet_to time not null default '08:00',
  enabled boolean not null default true,
  daily_checkin boolean not null default false,
  checkin_at time not null default '08:00',
  updated_at timestamptz not null default now(),
  constraint reminder_settings_weekdays_valid check (
    weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]
    and array_length(weekdays, 1) between 1 and 7
  )
);

drop trigger if exists reminder_settings_set_updated_at on public.reminder_settings;
create trigger reminder_settings_set_updated_at
  before update on public.reminder_settings
  for each row execute function public.set_updated_at();

alter table public.reminder_settings enable row level security;

create policy "people manage their own reminder settings"
  on public.reminder_settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Reminders ---------------------------------------------------------------

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid references public.goals (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  enabled boolean not null default true,
  next_due_at timestamptz,
  last_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminders_target_present check (goal_id is not null or task_id is not null)
);

-- One reminder per target, so pressing the button twice cannot double up.
create unique index if not exists reminders_one_per_target
  on public.reminders (user_id, coalesce(task_id, goal_id));

create index if not exists reminders_due_idx
  on public.reminders (next_due_at)
  where enabled and next_due_at is not null;

drop trigger if exists reminders_set_updated_at on public.reminders;
create trigger reminders_set_updated_at
  before update on public.reminders
  for each row execute function public.set_updated_at();

alter table public.reminders enable row level security;

create policy "people read their own reminders"
  on public.reminders for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.reminders from anon, authenticated;

-- Deliveries (the in-app inbox) -------------------------------------------

create table if not exists public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reminder_id uuid references public.reminders (id) on delete cascade,
  kind text not null check (kind in ('reminder', 'checkin')),
  dedupe_key text not null unique,
  due_at timestamptz not null,
  state text not null default 'unread'
    check (state in ('unread', 'snoozed', 'dismissed')),
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  constraint reminder_deliveries_kind_matches_target check (
    (kind = 'reminder') = (reminder_id is not null)
  )
);

create index if not exists reminder_deliveries_inbox_idx
  on public.reminder_deliveries (user_id, state, due_at desc);

alter table public.reminder_deliveries enable row level security;

create policy "people read their own deliveries"
  on public.reminder_deliveries for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.reminder_deliveries from anon, authenticated;

-- Daily check-in answers --------------------------------------------------

create table if not exists public.daily_intentions (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  intention text not null check (char_length(btrim(intention)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

drop trigger if exists daily_intentions_set_updated_at on public.daily_intentions;
create trigger daily_intentions_set_updated_at
  before update on public.daily_intentions
  for each row execute function public.set_updated_at();

alter table public.daily_intentions enable row level security;

create policy "people manage their own intentions"
  on public.daily_intentions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Scheduling maths --------------------------------------------------------

-- The next occurrence of p_time on one of p_weekdays, in the person's own
-- timezone. Postgres converts through the zone, so daylight saving is handled
-- by the database rather than guessed at.
create or replace function public.reminder_next_due(
  p_time time,
  p_timezone text,
  p_weekdays smallint[],
  p_after timestamptz
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_offset integer;
  v_local_date date;
  v_candidate timestamptz;
  v_best timestamptz;
begin
  for v_offset in 0..7 loop
    v_local_date := (p_after at time zone p_timezone)::date + v_offset;

    if extract(dow from v_local_date)::smallint = any (p_weekdays) then
      v_candidate := (v_local_date + p_time) at time zone p_timezone;
      if v_candidate > p_after and (v_best is null or v_candidate < v_best) then
        v_best := v_candidate;
      end if;
    end if;
  end loop;

  return v_best;
end;
$$;

-- Quiet hours may wrap midnight (21:00 to 08:00 is the default).
create or replace function public.reminder_quiet_now(
  p_timezone text,
  p_from time,
  p_to time
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_from = p_to then false
    when p_from < p_to then
      (now() at time zone p_timezone)::time >= p_from
      and (now() at time zone p_timezone)::time < p_to
    else
      (now() at time zone p_timezone)::time >= p_from
      or (now() at time zone p_timezone)::time < p_to
  end
$$;

-- Turning a reminder on or off -------------------------------------------

create or replace function public.upsert_reminder(
  p_task_id uuid,
  p_goal_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_settings public.reminder_settings;
  v_goal uuid;
  v_row public.reminders;
  v_due timestamptz;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  insert into public.reminder_settings (user_id) values (v_user)
  on conflict (user_id) do nothing;

  select * into v_settings
    from public.reminder_settings
   where user_id = v_user;

  if p_task_id is not null then
    select t.goal_id into v_goal
      from public.tasks t
      join public.goals g on g.id = t.goal_id
     where t.id = p_task_id
       and t.user_id = v_user
       and g.user_id = v_user;

    if v_goal is null then
      return jsonb_build_object('ok', false, 'code', 'no-target');
    end if;

    p_goal_id := v_goal;
  else
    if not exists (
      select 1 from public.goals g
       where g.id = p_goal_id and g.user_id = v_user
    ) then
      return jsonb_build_object('ok', false, 'code', 'no-target');
    end if;
  end if;

  if coalesce(p_enabled, true) and v_settings.enabled then
    v_due := public.reminder_next_due(
      v_settings.remind_at, v_settings.timezone, v_settings.weekdays, now()
    );
  end if;

  insert into public.reminders (user_id, goal_id, task_id, enabled, next_due_at)
  values (v_user, p_goal_id, p_task_id, coalesce(p_enabled, true), v_due)
  on conflict (user_id, coalesce(task_id, goal_id)) do update
    set enabled = excluded.enabled,
        next_due_at = excluded.next_due_at,
        updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'reminder', jsonb_build_object(
      'id', v_row.id,
      'task_id', v_row.task_id,
      'goal_id', v_row.goal_id,
      'enabled', v_row.enabled,
      'next_due_at', v_row.next_due_at
    )
  );
end;
$$;

-- A timezone change reschedules future reminders explicitly.
create or replace function public.reschedule_my_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_settings public.reminder_settings;
  v_count integer := 0;
begin
  if v_user is null then return 0; end if;

  select * into v_settings
    from public.reminder_settings
   where user_id = v_user;

  if not found then return 0; end if;

  update public.reminders r
     set next_due_at = case
           when r.enabled and v_settings.enabled then public.reminder_next_due(
             v_settings.remind_at, v_settings.timezone, v_settings.weekdays, now()
           )
           else null
         end,
         updated_at = now()
   where r.user_id = v_user;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The delivery pass -------------------------------------------------------
-- Called with a person's own id when they open the reminders page (so timely
-- delivery does not depend on a browser tab staying open being the only path),
-- and with null by the scheduler endpoint for everyone.
--
-- It is idempotent: `dedupe_key` is unique, and every branch either inserts one
-- row or changes nothing.

create or replace function public.run_reminder_pass(p_user uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_row record;
  v_settings public.reminder_settings;
  v_delivered integer := 0;
  v_checkins integer := 0;
  v_skipped integer := 0;
  v_count integer := 0;
  v_key text;
begin
  if v_caller is not null and p_user is distinct from v_caller then
    return jsonb_build_object('ok', false, 'code', 'no-owner');
  end if;

  -- Snoozes come back when their time arrives.
  update public.reminder_deliveries
     set state = 'unread', snoozed_until = null
   where state = 'snoozed'
     and snoozed_until is not null
     and snoozed_until <= now()
     and (p_user is null or user_id = p_user);

  for v_row in
    select r.id, r.user_id, r.task_id, r.next_due_at,
           s.timezone, s.quiet_from, s.quiet_to, s.remind_at, s.weekdays,
           t.status as task_status
      from public.reminders r
      join public.reminder_settings s on s.user_id = r.user_id
      left join public.tasks t on t.id = r.task_id
     where r.enabled
       and s.enabled
       and r.next_due_at is not null
       and r.next_due_at <= now()
       and (p_user is null or r.user_id = p_user)
  loop
    -- A finished task is not nagged about.
    if v_row.task_status = 'completed' then
      update public.reminders
         set next_due_at = public.reminder_next_due(
               v_row.remind_at, v_row.timezone, v_row.weekdays, now() + interval '1 second'
             ),
             updated_at = now()
       where id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Quiet hours: leave the due time alone so it delivers once afterwards.
    if public.reminder_quiet_now(v_row.timezone, v_row.quiet_from, v_row.quiet_to) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_key := 'reminder:' || v_row.id || ':' ||
             to_char(v_row.next_due_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS');

    insert into public.reminder_deliveries (user_id, reminder_id, kind, dedupe_key, due_at)
    values (v_row.user_id, v_row.id, 'reminder', v_key, v_row.next_due_at)
    on conflict (dedupe_key) do nothing;

    get diagnostics v_count = row_count;
    v_delivered := v_delivered + v_count;

    update public.reminders
       set next_due_at = public.reminder_next_due(
             v_row.remind_at, v_row.timezone, v_row.weekdays, now() + interval '1 second'
           ),
           last_delivered_at = now(),
           updated_at = now()
     where id = v_row.id;
  end loop;

  -- Optional daily check-in, one per local day.
  for v_settings in
    select * from public.reminder_settings s
     where s.daily_checkin
       and s.enabled
       and (p_user is null or s.user_id = p_user)
       and (now() at time zone s.timezone)::time >= s.checkin_at
  loop
    if public.reminder_quiet_now(v_settings.timezone, v_settings.quiet_from, v_settings.quiet_to) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_key := 'checkin:' || v_settings.user_id || ':' ||
             to_char((now() at time zone v_settings.timezone)::date, 'YYYY-MM-DD');

    insert into public.reminder_deliveries (user_id, reminder_id, kind, dedupe_key, due_at)
    values (v_settings.user_id, null, 'checkin', v_key, now())
    on conflict (dedupe_key) do nothing;

    get diagnostics v_count = row_count;
    v_checkins := v_checkins + v_count;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'delivered', v_delivered,
    'checkins', v_checkins,
    'skipped', v_skipped
  );
end;
$$;

-- Snooze and dismiss ------------------------------------------------------

create or replace function public.reminder_action(
  p_delivery_id uuid,
  p_action text,
  p_snooze_minutes integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_action = 'dismiss' then
    update public.reminder_deliveries
       set state = 'dismissed', snoozed_until = null
     where id = p_delivery_id and user_id = v_user;
  elsif p_action = 'snooze' then
    update public.reminder_deliveries
       set state = 'snoozed',
           snoozed_until = now() + make_interval(
             mins => greatest(5, least(coalesce(p_snooze_minutes, 60), 2880))
           )
     where id = p_delivery_id and user_id = v_user and state <> 'dismissed';
  else
    return jsonb_build_object('ok', false, 'code', 'invalid-action');
  end if;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'no-delivery');
  end if;

  return jsonb_build_object('ok', true, 'action', p_action);
end;
$$;

-- Grants ------------------------------------------------------------------
-- The scheduler endpoint has no session, so it calls run_reminder_pass as the
-- anonymous role with a null user, behind a bearer secret. Everything else is
-- signed-in only.

revoke all on function public.reminder_next_due(time, text, smallint[], timestamptz) from public, anon;
revoke all on function public.reminder_quiet_now(text, time, time) from public, anon;
revoke all on function public.upsert_reminder(uuid, uuid, boolean) from public, anon;
revoke all on function public.reschedule_my_reminders() from public, anon;
revoke all on function public.reminder_action(uuid, text, integer) from public, anon;

grant execute on function public.reminder_next_due(time, text, smallint[], timestamptz) to authenticated;
grant execute on function public.reminder_quiet_now(text, time, time) to authenticated;
grant execute on function public.upsert_reminder(uuid, uuid, boolean) to authenticated;
grant execute on function public.reschedule_my_reminders() to authenticated;
grant execute on function public.reminder_action(uuid, text, integer) to authenticated;

grant execute on function public.run_reminder_pass(uuid) to authenticated;
grant execute on function public.run_reminder_pass(uuid) to anon;
