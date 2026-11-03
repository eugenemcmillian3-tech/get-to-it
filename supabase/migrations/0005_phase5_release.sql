-- GET TO IT — Phase 5 schema
-- Account deletion, a durable usage ledger, and a feedback form.
--
-- The subtle problem this solves: AI allowances are counted from
-- `public.ai_requests`, and those rows cascade away with the account. If the
-- global daily total were still counted from that table, deleting an account
-- would hand the shared allowance back and let the same requests be spent
-- again. The ledger below is the authoritative global count and has no foreign
-- key to `auth.users`, so deleting an account never refunds a request.
--
-- Per-person counting still comes from `ai_requests`: once the person is gone,
-- their personal allowance is meaningless.

-- Durable global usage ------------------------------------------------

create table if not exists public.ai_usage_daily (
  day date primary key,
  requests integer not null default 0 check (requests >= 0),
  updated_at timestamptz not null default now()
);

-- Server-only: no policies and no grants, same treatment as `ai_limits`.
alter table public.ai_usage_daily enable row level security;
revoke all on public.ai_usage_daily from anon, authenticated;

-- Seed from whatever has already happened, so the switch changes nothing.
insert into public.ai_usage_daily (day, requests)
select (started_at at time zone 'utc')::date, count(*)::int
  from public.ai_requests
 group by 1
on conflict (day) do nothing;

-- Feedback -------------------------------------------------------------
-- Kept if the account is deleted: `user_id` becomes null, the message stays.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  area text not null default 'other'
    check (area in ('starting', 'working', 'stuck', 'returning', 'other')),
  message text not null
    check (char_length(btrim(message)) between 1 and 2000),
  contact_ok boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_idx
  on public.feedback (created_at desc);

alter table public.feedback enable row level security;

create policy "people write their own feedback"
  on public.feedback for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "people read their own feedback"
  on public.feedback for select to authenticated
  using (user_id = (select auth.uid()));

revoke update, delete on public.feedback from anon, authenticated;

-- Reservation function ------------------------------------------------
-- Same rules as Phase 2/3, except the global ceiling is read from, and
-- charged to, the durable ledger.

create or replace function public.reserve_ai_request(
  p_kind text,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_limits public.ai_limits;
  v_day_start timestamptz;
  v_day date;
  v_used_by_user integer;
  v_used_globally integer;
  v_in_flight integer;
  v_request_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_kind not in ('unstuck', 'plan', 'task_help') then
    return jsonb_build_object('ok', false, 'code', 'invalid-kind');
  end if;

  select * into v_limits from public.ai_limits where id = 1;
  if not found then
    v_limits.per_user_daily := 15;
    v_limits.global_daily := 200;
    v_limits.in_flight_seconds := 120;
  end if;

  v_day := (now() at time zone 'utc')::date;
  v_day_start := v_day::timestamp at time zone 'utc';

  -- A crashed or abandoned call must not lock someone out for the whole day.
  update public.ai_requests
     set status = 'failed',
         error_code = 'timeout',
         finished_at = now()
   where user_id = v_user
     and status = 'in_flight'
     and started_at < now() - make_interval(secs => v_limits.in_flight_seconds);

  select count(*) into v_used_by_user
    from public.ai_requests
   where user_id = v_user
     and started_at >= v_day_start;

  -- Global usage survives account deletion by design.
  select coalesce(requests, 0) into v_used_globally
    from public.ai_usage_daily
   where day = v_day;

  select count(*) into v_in_flight
    from public.ai_requests
   where user_id = v_user
     and status = 'in_flight';

  if v_in_flight > 0 then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
  end if;

  if v_used_by_user >= v_limits.per_user_daily then
    return jsonb_build_object(
      'ok', false,
      'code', 'user-daily',
      'limit', v_limits.per_user_daily,
      'remaining', 0
    );
  end if;

  if v_used_globally >= v_limits.global_daily then
    return jsonb_build_object(
      'ok', false,
      'code', 'global-daily',
      'limit', v_limits.global_daily
    );
  end if;

  insert into public.ai_requests (user_id, kind, model, status)
  values (v_user, p_kind, p_model, 'in_flight')
  returning id into v_request_id;

  insert into public.ai_usage_daily (day, requests)
  values (v_day, 1)
  on conflict (day) do update
    set requests = public.ai_usage_daily.requests + 1,
        updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'limit', v_limits.per_user_daily,
    'remaining', v_limits.per_user_daily - v_used_by_user - 1
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
end;
$$;

-- Account deletion ----------------------------------------------------
-- Deletes the signed-in person's own account, and nothing else. Every table
-- that belongs to them cascades (goals, tasks, saved work, focus sessions,
-- reflections, plan records, request history, profile). The usage ledger and
-- their feedback are deliberately left behind: one as an anonymous count, the
-- other with `user_id` set to null.

create or replace function public.delete_my_account(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_confirm is distinct from 'DELETE' then
    return jsonb_build_object('ok', false, 'code', 'not-confirmed');
  end if;

  delete from auth.users where id = v_user;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

revoke all on function public.reserve_ai_request(text, text) from public, anon;
grant execute on function public.reserve_ai_request(text, text) to authenticated;
