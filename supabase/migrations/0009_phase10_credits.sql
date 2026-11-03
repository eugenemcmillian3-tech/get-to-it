-- GET TO IT — Phase 10 schema
-- Prepaid AI credits, one payment provider (Stripe), and the accounting an
-- owner needs to see what is measurable versus what is only estimated.
--
-- Ground rules encoded here:
--   * The free daily allowance stays free. A credit is only reserved once the
--     free requests for the day are used up.
--   * Credits are an append-only ledger. Nothing is updated or deleted; a
--     balance is the sum of the rows. Corrections are new rows.
--   * A credit is reserved *before* the model call and released when the call
--     fails, so a failed request never costs a person a credit.
--   * Purchases are credited from a verified provider webhook, keyed by the
--     event id and the payment row, never from a browser redirect.
--   * No provider price is invented. Token counts are recorded as reported;
--     money is only computed from rows the owner enters in `ai_prices`.

-- ---------------------------------------------------------------------------
-- 1. Request accounting
-- ---------------------------------------------------------------------------

alter table public.ai_requests
  add column if not exists credits_charged integer not null default 0,
  add column if not exists tokens_in integer,
  add column if not exists tokens_out integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ai_requests_credits_range'
  ) then
    alter table public.ai_requests
      add constraint ai_requests_credits_range
      check (credits_charged between 0 and 10);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_requests_tokens_range'
  ) then
    alter table public.ai_requests
      add constraint ai_requests_tokens_range
      check (
        (tokens_in is null or tokens_in >= 0)
        and (tokens_out is null or tokens_out >= 0)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. What can be bought
-- ---------------------------------------------------------------------------
-- Placeholder prices. They are the app's own list price, not a provider cost,
-- and they live in the database so they can be changed without a deploy.

create table if not exists public.credit_packs (
  slug text primary key,
  credits integer not null check (credits > 0 and credits <= 100000),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency in ('usd')),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.credit_packs (slug, credits, amount_cents, label, sort_order)
values
  ('starter', 20, 500, '20 credits', 1),
  ('steady', 60, 1200, '60 credits', 2),
  ('deep', 150, 2500, '150 credits', 3)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Payments
-- ---------------------------------------------------------------------------

create table if not exists public.credit_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  provider text not null default 'stripe' check (provider in ('stripe')),
  pack_slug text not null,
  credits integer not null check (credits > 0 and credits <= 100000),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd' check (currency in ('usd')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'refunded', 'failed', 'canceled')),
  provider_session_id text unique,
  provider_payment_id text unique,
  receipt_url text,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_payments_user_idx
  on public.credit_payments (user_id, created_at desc);

-- Every provider event we have ever been handed, so a repeated delivery is
-- recognised instead of granting credits twice.
create table if not exists public.payment_events (
  provider_event_id text primary key,
  provider text not null default 'stripe' check (provider in ('stripe')),
  type text not null check (char_length(type) between 1 and 120),
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  detail text check (detail is null or char_length(detail) <= 200),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 4. Credit ledger (append-only)
-- ---------------------------------------------------------------------------

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  delta integer not null check (delta <> 0 and abs(delta) <= 100000),
  reason text not null
    check (reason in ('purchase', 'ai_charge', 'ai_release', 'refund', 'adjustment', 'forfeit')),
  request_id uuid references public.ai_requests (id) on delete set null,
  payment_id uuid references public.credit_payments (id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_idx
  on public.credit_ledger (user_id, created_at desc);

-- One charge and one release per request; one purchase and one refund per
-- payment. These make a double webhook or a double tap harmless.
create unique index if not exists credit_ledger_one_charge_per_request
  on public.credit_ledger (request_id) where reason = 'ai_charge';
create unique index if not exists credit_ledger_one_release_per_request
  on public.credit_ledger (request_id) where reason = 'ai_release';
create unique index if not exists credit_ledger_one_purchase_per_payment
  on public.credit_ledger (payment_id) where reason = 'purchase';
create unique index if not exists credit_ledger_one_refund_per_payment
  on public.credit_ledger (payment_id) where reason = 'refund';

-- The balance check and the insert have to be one serialised step, or two
-- simultaneous requests could both spend the last credit.
create or replace function public.credit_ledger_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  if new.user_id is null then
    raise exception 'credit_ledger: user_id is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('credit-ledger:' || new.user_id::text, 0)
  );

  select coalesce(sum(delta), 0) into v_balance
    from public.credit_ledger
   where user_id = new.user_id;

  if v_balance + new.delta < 0 then
    raise exception 'insufficient-credits'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists credit_ledger_guard_trigger on public.credit_ledger;
create trigger credit_ledger_guard_trigger
  before insert on public.credit_ledger
  for each row execute function public.credit_ledger_guard();

-- Rows are never edited or removed. The one exception is the foreign key
-- going null when an account is deleted, which keeps the row for accounting
-- without keeping the person.
create or replace function public.credit_ledger_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.id = old.id
     and new.delta = old.delta
     and new.reason = old.reason
     and new.created_at = old.created_at
     and (new.user_id is not distinct from old.user_id or new.user_id is null)
     and (new.request_id is not distinct from old.request_id or new.request_id is null)
     and (new.payment_id is not distinct from old.payment_id or new.payment_id is null) then
    return new;
  end if;

  raise exception 'the credit ledger is append-only';
end;
$$;

drop trigger if exists credit_ledger_append_only_trigger on public.credit_ledger;
create trigger credit_ledger_append_only_trigger
  before update or delete on public.credit_ledger
  for each row execute function public.credit_ledger_append_only();

-- ---------------------------------------------------------------------------
-- 5. Owner-only configuration
-- ---------------------------------------------------------------------------

-- Who may see the owner dashboard. Managed in SQL, never from the app.
create table if not exists public.app_owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

-- Provider cost per model, as reported on the provider's own bill. Units are
-- millionths of a dollar per 1000 tokens. Empty by default: with no row, the
-- dashboard says the cost is unknown rather than guessing.
create table if not exists public.ai_prices (
  model text primary key,
  input_micros_per_1k integer check (input_micros_per_1k is null or input_micros_per_1k >= 0),
  output_micros_per_1k integer check (output_micros_per_1k is null or output_micros_per_1k >= 0),
  source text check (source is null or char_length(source) <= 200),
  updated_at timestamptz not null default now()
);

-- A capability token for the webhook, which has no signed-in user. The route
-- sends it, this table holds the expected value, and no role can read it.
create table if not exists public.app_secrets (
  name text primary key,
  value text not null check (char_length(value) >= 32),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. Functions
-- ---------------------------------------------------------------------------

create or replace function public.app_is_owner()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.app_owners where user_id = auth.uid()
  );
$$;

create or replace function public.my_credits()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_user uuid := auth.uid();
  v_limits public.ai_limits;
  v_day_start timestamptz;
  v_free_used integer;
  v_balance integer;
  v_spent integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_limits from public.ai_limits where id = 1;
  if not found then
    v_limits.per_user_daily := 15;
    v_limits.global_daily := 200;
    v_limits.in_flight_seconds := 120;
  end if;

  v_day_start := ((now() at time zone 'utc')::date)::timestamp at time zone 'utc';

  select coalesce(sum(delta), 0) into v_balance
    from public.credit_ledger where user_id = v_user;

  select count(*) into v_free_used
    from public.ai_requests
   where user_id = v_user
     and started_at >= v_day_start
     and credits_charged = 0;

  select coalesce(-sum(delta), 0) into v_spent
    from public.credit_ledger
   where user_id = v_user and reason = 'ai_charge';

  return jsonb_build_object(
    'ok', true,
    'balance', v_balance,
    'free_used_today', v_free_used,
    'free_limit', v_limits.per_user_daily,
    'free_remaining', greatest(v_limits.per_user_daily - v_free_used, 0),
    'credits_spent_total', v_spent,
    'is_owner', public.app_is_owner()
  );
end;
$$;

-- Reservation: free allowance first, then one credit, then a clear refusal.
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

  -- A crashed or abandoned call is closed out, and its reserved credit is
  -- returned. This is the only path that resolves an interrupted request.
  for v_stale in
    select id, credits_charged
      from public.ai_requests
     where user_id = v_user
       and status = 'in_flight'
       and started_at < now() - make_interval(secs => v_limits.in_flight_seconds)
  loop
    update public.ai_requests
       set status = 'failed',
           error_code = 'timeout',
           finished_at = now()
     where id = v_stale.id;

    if v_stale.credits_charged > 0 then
      insert into public.credit_ledger (user_id, delta, reason, request_id, note)
      values (
        v_user,
        v_stale.credits_charged,
        'ai_release',
        v_stale.id,
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
   where user_id = v_user
     and status = 'in_flight';

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
        'ok', false,
        'code', 'needs-credits',
        'limit', v_limits.per_user_daily,
        'remaining', 0,
        'balance', 0
      );
    end if;

    v_use_credit := true;
  end if;

  insert into public.ai_requests (user_id, kind, model, status, credits_charged)
  values (
    v_user,
    p_kind,
    p_model,
    'in_flight',
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
    set requests = public.ai_usage_daily.requests + 1,
        updated_at = now();

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

-- Closing a request out. A failed request gives the credit back.
drop function if exists public.finish_ai_request(uuid, text, text);

create or replace function public.finish_ai_request(
  p_request_id uuid,
  p_status text,
  p_error text default null,
  p_tokens_in integer default null,
  p_tokens_out integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_charged integer;
begin
  if v_user is null then
    return;
  end if;

  if p_status not in ('succeeded', 'failed') then
    raise exception 'finish_ai_request: unsupported status %', p_status;
  end if;

  update public.ai_requests
     set status = p_status,
         error_code = nullif(left(coalesce(p_error, ''), 120), ''),
         tokens_in = coalesce(p_tokens_in, tokens_in),
         tokens_out = coalesce(p_tokens_out, tokens_out),
         finished_at = now()
   where id = p_request_id
     and user_id = v_user
     and status = 'in_flight'
  returning credits_charged into v_charged;

  if v_charged is not null and v_charged > 0 and p_status = 'failed' then
    insert into public.credit_ledger (user_id, delta, reason, request_id, note)
    values (v_user, v_charged, 'ai_release', p_request_id, 'released after a failed request')
    on conflict do nothing;
  end if;
end;
$$;

-- Checkout: a pending payment row, priced from the database, never the form.
create or replace function public.create_credit_payment(p_pack_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_pack public.credit_packs;
  v_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_pack
    from public.credit_packs
   where slug = p_pack_slug and active;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown-pack');
  end if;

  -- A person who changes their mind and starts again gets one live attempt,
  -- not a pile of open checkouts.
  update public.credit_payments
     set status = 'canceled', updated_at = now()
   where user_id = v_user
     and status = 'pending'
     and created_at < now() - interval '2 minutes';

  insert into public.credit_payments (user_id, pack_slug, credits, amount_cents, currency)
  values (v_user, v_pack.slug, v_pack.credits, v_pack.amount_cents, v_pack.currency)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_id,
    'pack_slug', v_pack.slug,
    'credits', v_pack.credits,
    'amount_cents', v_pack.amount_cents,
    'currency', v_pack.currency,
    'label', v_pack.label
  );
end;
$$;

create or replace function public.attach_credit_session(
  p_payment_id uuid,
  p_session_id text
)
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

  update public.credit_payments
     set provider_session_id = p_session_id,
         updated_at = now()
   where id = p_payment_id
     and user_id = v_user
     and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-pending');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cancel_credit_payment(p_payment_id uuid)
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

  update public.credit_payments
     set status = 'canceled', updated_at = now()
   where id = p_payment_id
     and user_id = v_user
     and status = 'pending';

  return jsonb_build_object('ok', true, 'canceled', found);
end;
$$;

-- Webhook ingestion. No signed-in user, so it is gated by a capability token
-- instead: only a caller that knows the token can move a payment.
create or replace function public.credit_handle_event(
  p_token text,
  p_event_id text,
  p_type text,
  p_session_id text,
  p_provider_payment_id text,
  p_receipt_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_payment public.credit_payments;
  v_rows integer;
  v_balance integer;
begin
  select value into v_expected
    from public.app_secrets
   where name = 'credit_webhook';

  if v_expected is null
     or p_token is null
     or p_event_id is null
     or char_length(p_token) < 32
     or v_expected <> p_token then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;

  insert into public.payment_events (provider_event_id, type)
  values (p_event_id, left(p_type, 120))
  on conflict (provider_event_id) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  if p_type = 'checkout.session.completed' then
    select * into v_payment
      from public.credit_payments
     where provider_session_id = p_session_id
       for update;

    if not found then
      update public.payment_events
         set status = 'ignored', detail = 'unknown session', processed_at = now()
       where provider_event_id = p_event_id;
      return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'unknown-session');
    end if;

    if v_payment.status <> 'pending' then
      update public.payment_events
         set status = 'ignored', detail = 'payment not pending', processed_at = now()
       where provider_event_id = p_event_id;
      return jsonb_build_object(
        'ok', true, 'ignored', true, 'reason', 'not-pending', 'status', v_payment.status
      );
    end if;

    update public.credit_payments
       set status = 'paid',
           provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
           receipt_url = coalesce(p_receipt_url, receipt_url),
           updated_at = now()
     where id = v_payment.id;

    insert into public.credit_ledger (user_id, delta, reason, payment_id, note)
    values (
      v_payment.user_id,
      v_payment.credits,
      'purchase',
      v_payment.id,
      'purchased ' || v_payment.credits || ' credits'
    )
    on conflict do nothing;

    update public.payment_events
       set status = 'processed', processed_at = now()
     where provider_event_id = p_event_id;

    return jsonb_build_object(
      'ok', true, 'granted', v_payment.credits, 'payment_id', v_payment.id
    );
  end if;

  if p_type = 'checkout.session.expired' then
    update public.credit_payments
       set status = 'canceled', updated_at = now()
     where provider_session_id = p_session_id
       and status = 'pending';

    update public.payment_events
       set status = 'processed', processed_at = now()
     where provider_event_id = p_event_id;

    return jsonb_build_object('ok', true, 'expired', true);
  end if;

  if p_type = 'charge.refunded' then
    select * into v_payment
      from public.credit_payments
     where provider_payment_id = p_provider_payment_id
       for update;

    if not found then
      update public.payment_events
         set status = 'ignored', detail = 'unknown payment', processed_at = now()
       where provider_event_id = p_event_id;
      return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'unknown-payment');
    end if;

    if v_payment.status <> 'paid' then
      update public.payment_events
         set status = 'ignored', detail = 'payment not paid', processed_at = now()
       where provider_event_id = p_event_id;
      return jsonb_build_object(
        'ok', true, 'ignored', true, 'reason', 'not-paid', 'status', v_payment.status
      );
    end if;

    select coalesce(sum(delta), 0) into v_balance
      from public.credit_ledger
     where user_id = v_payment.user_id;

    -- Refunds only when the credits are still there. If they have been spent,
    -- this is a decision for a person, so the event is parked as failed.
    if v_balance < v_payment.credits then
      update public.payment_events
         set status = 'failed',
             detail = 'refund needs attention: credits already used',
             processed_at = now()
       where provider_event_id = p_event_id;

      return jsonb_build_object(
        'ok', false, 'code', 'refund-needs-attention', 'payment_id', v_payment.id
      );
    end if;

    insert into public.credit_ledger (user_id, delta, reason, payment_id, note)
    values (
      v_payment.user_id,
      -v_payment.credits,
      'refund',
      v_payment.id,
      'refunded ' || v_payment.credits || ' credits'
    )
    on conflict do nothing;

    update public.credit_payments
       set status = 'refunded', refunded_at = now(), updated_at = now()
     where id = v_payment.id;

    update public.payment_events
       set status = 'processed', processed_at = now()
     where provider_event_id = p_event_id;

    return jsonb_build_object('ok', true, 'refunded', v_payment.credits, 'payment_id', v_payment.id);
  end if;

  update public.payment_events
     set status = 'ignored', detail = 'unhandled event type', processed_at = now()
   where provider_event_id = p_event_id;

  return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'unhandled-type');
end;
$$;

-- Owner actions. Both check ownership in the database, not in the browser.
create or replace function public.owner_adjust_credits(
  p_email text,
  p_delta integer,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
  v_balance integer;
begin
  if not public.app_is_owner() then
    return jsonb_build_object('ok', false, 'code', 'not-owner');
  end if;

  if p_delta = 0 or abs(p_delta) > 10000 then
    return jsonb_build_object('ok', false, 'code', 'bad-delta');
  end if;

  if p_note is null or char_length(btrim(p_note)) < 3 then
    return jsonb_build_object('ok', false, 'code', 'note-required');
  end if;

  select id into v_target
    from auth.users
   where lower(email) = lower(btrim(p_email));

  if v_target is null then
    return jsonb_build_object('ok', false, 'code', 'unknown-account');
  end if;

  insert into public.credit_ledger (user_id, delta, reason, note)
  values (v_target, p_delta, 'adjustment', left(btrim(p_note), 500));

  select coalesce(sum(delta), 0) into v_balance
    from public.credit_ledger where user_id = v_target;

  return jsonb_build_object('ok', true, 'balance', v_balance);
exception
  when check_violation then
    return jsonb_build_object('ok', false, 'code', 'would-go-negative');
end;
$$;

create or replace function public.owner_metrics()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v jsonb;
begin
  if not public.app_is_owner() then
    return jsonb_build_object('ok', false, 'code', 'not-owner');
  end if;

  select jsonb_build_object(
    'users_total', (select count(*) from auth.users),
    'users_with_ai_7d', (
      select count(distinct user_id) from public.ai_requests
       where started_at >= now() - interval '7 days'
    ),
    'goals_total', (select count(*) from public.goals),
    'goals_active', (select count(*) from public.goals where archived_at is null),
    'tasks_total', (select count(*) from public.tasks),
    'tasks_completed', (select count(*) from public.tasks where status = 'completed'),
    'ai_requests_7d', (
      select count(*) from public.ai_requests
       where started_at >= now() - interval '7 days'
    ),
    'ai_succeeded_7d', (
      select count(*) from public.ai_requests
       where started_at >= now() - interval '7 days' and status = 'succeeded'
    ),
    'ai_failed_7d', (
      select count(*) from public.ai_requests
       where started_at >= now() - interval '7 days' and status = 'failed'
    ),
    'ai_by_kind_30d', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
        from (
          select kind, count(*) as n
            from public.ai_requests
           where started_at >= now() - interval '30 days'
           group by kind
        ) k
    ),
    'tokens_in_30d', (
      select coalesce(sum(tokens_in), 0) from public.ai_requests
       where started_at >= now() - interval '30 days'
    ),
    'tokens_out_30d', (
      select coalesce(sum(tokens_out), 0) from public.ai_requests
       where started_at >= now() - interval '30 days'
    ),
    'cost_micros_known_30d', (
      select coalesce(sum(round(
               r.tokens_in / 1000.0 * p.input_micros_per_1k
             + r.tokens_out / 1000.0 * p.output_micros_per_1k
             )), 0)
        from public.ai_requests r
        join public.ai_prices p on p.model = r.model
       where r.started_at >= now() - interval '30 days'
         and r.tokens_in is not null
         and r.tokens_out is not null
         and p.input_micros_per_1k is not null
         and p.output_micros_per_1k is not null
    ),
    'models_priced', (select count(*) from public.ai_prices),
    'requests_without_price_30d', (
      select count(*) from public.ai_requests r
       where r.started_at >= now() - interval '30 days'
         and not exists (select 1 from public.ai_prices p where p.model = r.model)
    ),
    'credits_sold_total', (
      select coalesce(sum(delta), 0) from public.credit_ledger where reason = 'purchase'
    ),
    'credits_spent_total', (
      select coalesce(-sum(delta), 0) from public.credit_ledger where reason = 'ai_charge'
    ),
    'credits_held_total', (
      select coalesce(sum(delta), 0) from public.credit_ledger
       where user_id is not null and reason <> 'ai_charge'
    ),
    'adjustments_30d', (
      select coalesce(sum(delta), 0) from public.credit_ledger
       where reason = 'adjustment' and created_at >= now() - interval '30 days'
    ),
    'revenue_cents', (
      select coalesce(sum(amount_cents), 0) from public.credit_payments
       where status in ('paid', 'refunded')
    ),
    'payments_paid', (
      select count(*) from public.credit_payments where status = 'paid'
    ),
    'payments_refunded', (
      select count(*) from public.credit_payments where status = 'refunded'
    ),
    'payments_pending', (
      select count(*) from public.credit_payments where status = 'pending'
    ),
    'events_failed', (
      select count(*) from public.payment_events where status = 'failed'
    ),
    'events_ignored', (
      select count(*) from public.payment_events where status = 'ignored'
    ),
    'test_mode', not exists (
      select 1 from public.app_secrets where name = 'stripe_live'
    )
  ) into v;

  return jsonb_build_object('ok', true, 'metrics', v);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Row level security and grants
-- ---------------------------------------------------------------------------
-- People read their own history. Every write goes through a function above,
-- so no browser role can grant itself credits or move a payment.

alter table public.credit_ledger enable row level security;
alter table public.credit_payments enable row level security;
alter table public.credit_packs enable row level security;
alter table public.payment_events enable row level security;
alter table public.app_owners enable row level security;
alter table public.app_secrets enable row level security;
alter table public.ai_prices enable row level security;

drop policy if exists "people read their own credit history" on public.credit_ledger;
create policy "people read their own credit history"
  on public.credit_ledger for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people read their own payments" on public.credit_payments;
create policy "people read their own payments"
  on public.credit_payments for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "active packs are readable" on public.credit_packs;
create policy "active packs are readable"
  on public.credit_packs for select to authenticated
  using (active);

revoke all on public.credit_ledger from anon, authenticated;
revoke all on public.credit_payments from anon, authenticated;
revoke all on public.credit_packs from anon, authenticated;
revoke all on public.payment_events from anon, authenticated;
revoke all on public.app_owners from anon, authenticated;
revoke all on public.app_secrets from anon, authenticated;
revoke all on public.ai_prices from anon, authenticated;

grant select on public.credit_ledger to authenticated;
grant select on public.credit_payments to authenticated;
grant select on public.credit_packs to authenticated;

revoke all on function public.app_is_owner() from public, anon;
revoke all on function public.my_credits() from public, anon;
revoke all on function public.create_credit_payment(text) from public, anon;
revoke all on function public.attach_credit_session(uuid, text) from public, anon;
revoke all on function public.cancel_credit_payment(uuid) from public, anon;
revoke all on function public.owner_adjust_credits(text, integer, text) from public, anon;
revoke all on function public.owner_metrics() from public, anon;
revoke all on function public.credit_handle_event(text, text, text, text, text, text) from public, anon;

grant execute on function public.app_is_owner() to authenticated;
grant execute on function public.my_credits() to authenticated;
grant execute on function public.create_credit_payment(text) to authenticated;
grant execute on function public.attach_credit_session(uuid, text) to authenticated;
grant execute on function public.cancel_credit_payment(uuid) to authenticated;
grant execute on function public.owner_adjust_credits(text, integer, text) to authenticated;
grant execute on function public.owner_metrics() to authenticated;

-- The webhook has no session: it presents the capability token instead.
grant execute on function public.credit_handle_event(text, text, text, text, text, text) to anon;

revoke all on function public.reserve_ai_request(text, text) from public, anon;
revoke all on function public.finish_ai_request(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.reserve_ai_request(text, text) to authenticated;
grant execute on function public.finish_ai_request(uuid, text, text, integer, integer) to authenticated;
