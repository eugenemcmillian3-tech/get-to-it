-- GET TO IT — Phase 17 schema
-- Think it through: five sequential review perspectives over one shared record.
--
-- Ground rules encoded here:
--   * A review belongs to one person and holds at most five stages, one per
--     fixed perspective. There is no table or column where a delegated agent,
--     an extra provider or an external action could be stored.
--   * Each stage is one model call, started by the person. A stage row moves
--     pending → running → succeeded or failed, and a unique (review_id,
--     perspective) makes a second reply for the same perspective impossible.
--   * Cancelling is a review-level flag. Pending stages become skipped and no
--     further requests are made; finished stages stay readable.
--   * The human decision lives on the review, including an explicit
--     `rejected_recommendation` flag, so a person can record an answer that no
--     perspective proposed.
--   * Owner-only under RLS, and every write is also checked against the session.

-- ---------------------------------------------------------------------------
-- 1. A new AI request kind for one review stage
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.ai_requests drop constraint if exists ai_requests_kind_check;

  alter table public.ai_requests
    add constraint ai_requests_kind_check
    check (kind in (
      'unstuck', 'plan', 'task_help', 'learning', 'learning_help',
      'workflow_draft', 'future_paths', 'review'
    ));
end $$;

-- Body unchanged from Phase 16 apart from the accepted kind list.
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
  v_free_used integer;
  v_used_globally integer;
  v_in_flight integer;
  v_balance integer;
  v_use_credit boolean := false;
  v_request_id uuid;
  v_stale record;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_kind not in (
    'unstuck', 'plan', 'task_help', 'learning', 'learning_help',
    'workflow_draft', 'future_paths', 'review'
  ) then
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

  for v_stale in
    select id, credits_charged
      from public.ai_requests
     where user_id = v_user
       and status = 'in_flight'
       and started_at < now() - make_interval(secs => v_limits.in_flight_seconds)
  loop
    update public.ai_requests
       set status = 'failed', error_code = 'timeout', finished_at = now()
     where id = v_stale.id;

    if v_stale.credits_charged > 0 then
      insert into public.credit_ledger (user_id, delta, reason, request_id, note)
      values (
        v_user, v_stale.credits_charged, 'ai_release', v_stale.id,
        'released after an interrupted request'
      )
      on conflict do nothing;
    end if;
  end loop;

  select count(*) into v_free_used
    from public.ai_requests
   where user_id = v_user
     and started_at >= v_day_start
     and credits_charged = 0;

  select coalesce(requests, 0) into v_used_globally
    from public.ai_usage_daily
   where day = v_day;

  select count(*) into v_in_flight
    from public.ai_requests
   where user_id = v_user and status = 'in_flight';

  if v_in_flight > 0 then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
  end if;

  if v_used_globally >= v_limits.global_daily then
    return jsonb_build_object('ok', false, 'code', 'global-daily');
  end if;

  if v_free_used >= v_limits.per_user_daily then
    select coalesce(sum(delta), 0) into v_balance
      from public.credit_ledger where user_id = v_user;

    if v_balance <= 0 then
      return jsonb_build_object(
        'ok', false, 'code', 'needs-credits', 'limit', v_limits.per_user_daily,
        'remaining', 0, 'balance', 0
      );
    end if;

    v_use_credit := true;
  end if;

  insert into public.ai_requests (user_id, kind, model, status, credits_charged)
  values (
    v_user, p_kind, p_model, 'in_flight',
    case when v_use_credit then 1 else 0 end
  )
  returning id into v_request_id;

  if v_use_credit then
    insert into public.credit_ledger (user_id, delta, reason, request_id, note)
    values (v_user, -1, 'ai_charge', v_request_id, 'reserved for one AI request');
  end if;

  insert into public.ai_usage_daily (day, requests)
  values (v_day, 1)
  on conflict (day) do update
    set requests = public.ai_usage_daily.requests + 1, updated_at = now();

  select coalesce(sum(delta), 0) into v_balance
    from public.credit_ledger where user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'limit', v_limits.per_user_daily,
    'remaining', greatest(
      v_limits.per_user_daily - v_free_used - case when v_use_credit then 0 else 1 end,
      0
    ),
    'free', not v_use_credit,
    'balance', v_balance
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
  when check_violation then
    return jsonb_build_object('ok', false, 'code', 'needs-credits');
end;
$$;

revoke all on function public.reserve_ai_request(text, text) from public, anon;
grant execute on function public.reserve_ai_request(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reviews
-- ---------------------------------------------------------------------------

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null
    check (char_length(btrim(question)) between 5 and 500),
  context text not null default ''
    check (char_length(context) <= 4000),
  constraints text not null default ''
    check (char_length(constraints) <= 2000),
  priorities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(priorities) = 'array' and jsonb_array_length(priorities) <= 8),
  sources jsonb not null default '[]'::jsonb
    check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 8),
  model text not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'complete', 'partial', 'cancelled')),
  current_position integer not null default 0
    check (current_position between 0 and 5),
  cancel_requested_at timestamptz,
  error_code text,
  chosen_option text
    check (chosen_option is null or char_length(btrim(chosen_option)) between 1 and 200),
  decision text
    check (decision is null or char_length(btrim(decision)) between 1 and 4000),
  rejected_recommendation boolean not null default false,
  decided_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reviews_user_idx
  on public.reviews (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. One row per perspective
-- ---------------------------------------------------------------------------

create table if not exists public.review_stages (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  perspective text not null
    check (perspective in ('planner', 'critic', 'research', 'human_impact', 'synthesizer')),
  position integer not null check (position between 1 and 5),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  summary text,
  assumptions jsonb,
  options jsonb,
  evidence jsonb,
  counterarguments jsonb,
  disagreements jsonb,
  missing_info jsonb,
  experiment jsonb,
  questions jsonb,
  tradeoffs jsonb,
  recommendation text,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (review_id, perspective),
  unique (review_id, position)
);

create index if not exists review_stages_review_idx
  on public.review_stages (review_id, position);

-- ---------------------------------------------------------------------------
-- 4. Timestamps
-- ---------------------------------------------------------------------------

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Row Level Security and grants
-- ---------------------------------------------------------------------------

alter table public.reviews enable row level security;
alter table public.review_stages enable row level security;

drop policy if exists "people read their own reviews" on public.reviews;
create policy "people read their own reviews"
  on public.reviews for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people create their own reviews" on public.reviews;
create policy "people create their own reviews"
  on public.reviews for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "people update their own reviews" on public.reviews;
create policy "people update their own reviews"
  on public.reviews for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people delete their own reviews" on public.reviews;
create policy "people delete their own reviews"
  on public.reviews for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people read their own review stages" on public.review_stages;
create policy "people read their own review stages"
  on public.review_stages for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.reviews r
       where r.id = review_id and r.user_id = (select auth.uid())
    )
  );

drop policy if exists "people create their own review stages" on public.review_stages;
create policy "people create their own review stages"
  on public.review_stages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.reviews r
       where r.id = review_id and r.user_id = (select auth.uid())
    )
  );

drop policy if exists "people update their own review stages" on public.review_stages;
create policy "people update their own review stages"
  on public.review_stages for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.reviews r
       where r.id = review_id and r.user_id = (select auth.uid())
    )
  );

drop policy if exists "people delete their own review stages" on public.review_stages;
create policy "people delete their own review stages"
  on public.review_stages for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.reviews to authenticated;
grant select, insert, update, delete on public.review_stages to authenticated;

revoke all on public.reviews from anon;
revoke all on public.review_stages from anon;
