-- GET TO IT — recurring subscriptions for the existing paid offers.
--
-- The five time-limited offers become auto-renewing subscriptions. Premium
-- templates and white-label stay one-time. AI credits remain separate and are
-- never granted by this migration.
--
-- The first Checkout event still creates the purchase and entitlement through
-- billing_handle_event(). Subscription events then keep the exact period end,
-- quantity and cancellation state current. A deleted subscription revokes the
-- entitlement only after its paid period ends.

-- ---------------------------------------------------------------------------
-- 1. Offer catalogue
-- ---------------------------------------------------------------------------

alter table public.billing_offers
  drop constraint if exists billing_offers_billing_mode_check;

alter table public.billing_offers
  add constraint billing_offers_billing_mode_check
  check (billing_mode in ('one_time', 'subscription'));

alter table public.billing_offers
  add column if not exists stripe_lookup_key text,
  add column if not exists billing_interval text,
  add column if not exists billing_interval_count integer;

alter table public.billing_offers
  drop constraint if exists billing_offers_billing_interval_check;
alter table public.billing_offers
  add constraint billing_offers_billing_interval_check
  check (
    (billing_interval is null and billing_interval_count is null)
    or (
      billing_interval in ('day', 'month')
      and billing_interval_count between 1 and 365
    )
  );

alter table public.billing_offers
  drop constraint if exists billing_offers_subscription_shape_check;
alter table public.billing_offers
  add constraint billing_offers_subscription_shape_check
  check (
    (billing_mode = 'one_time' and billing_interval is null and billing_interval_count is null)
    or (billing_mode = 'subscription' and billing_interval is not null and billing_interval_count is not null)
  );

create unique index if not exists billing_offers_stripe_lookup_key_unique
  on public.billing_offers (stripe_lookup_key)
  where stripe_lookup_key is not null;

update public.billing_offers
   set billing_mode = 'subscription',
       billing_interval = 'day',
       billing_interval_count = 30,
       stripe_lookup_key = 'get_to_it_team_seats_30d',
       updated_at = now()
 where slug = 'team_seats';

update public.billing_offers
   set billing_mode = 'subscription',
       billing_interval = 'day',
       billing_interval_count = 30,
       stripe_lookup_key = 'get_to_it_pro_30d',
       updated_at = now()
 where slug = 'pro';

update public.billing_offers
   set billing_mode = 'subscription',
       billing_interval = 'day',
       billing_interval_count = 30,
       stripe_lookup_key = 'get_to_it_automation_plus_30d',
       updated_at = now()
 where slug = 'automation_plus';

update public.billing_offers
   set billing_mode = 'subscription',
       billing_interval = 'day',
       billing_interval_count = 90,
       stripe_lookup_key = 'get_to_it_build_release_90d',
       updated_at = now()
 where slug = 'build_release';

update public.billing_offers
   set billing_mode = 'subscription',
       billing_interval = 'day',
       billing_interval_count = 30,
       stripe_lookup_key = 'get_to_it_priority_support_30d',
       updated_at = now()
 where slug = 'priority_support';

update public.billing_offers
   set billing_mode = 'one_time',
       billing_interval = null,
       billing_interval_count = null,
       stripe_lookup_key = null,
       updated_at = now()
 where slug in ('premium_templates', 'white_label');

-- ---------------------------------------------------------------------------
-- 2. Subscription state
-- ---------------------------------------------------------------------------

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique
    references public.billing_purchases (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  offer_slug text not null references public.billing_offers (slug),
  quantity integer not null default 1 check (quantity between 1 and 100),
  workspace_id uuid references public.workspaces (id) on delete set null,
  project_id uuid references public.app_projects (id) on delete set null,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_customer_id text,
  provider_subscription_id text not null unique,
  provider_price_id text,
  status text not null default 'incomplete'
    check (status in (
      'incomplete', 'incomplete_expired', 'trialing', 'active',
      'past_due', 'canceled', 'unpaid', 'paused'
    )),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_subscriptions_user_idx
  on public.billing_subscriptions (user_id, created_at desc);
create index if not exists billing_subscriptions_workspace_idx
  on public.billing_subscriptions (workspace_id, created_at desc);
create index if not exists billing_subscriptions_period_idx
  on public.billing_subscriptions (current_period_end);

-- ---------------------------------------------------------------------------
-- 3. Webhook ingestion for subscription lifecycle events
-- ---------------------------------------------------------------------------

create or replace function public.billing_handle_subscription_event(
  p_token text,
  p_event_id text,
  p_type text,
  p_subscription_id text,
  p_customer_id text,
  p_status text,
  p_price_id text,
  p_quantity integer,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_purchase_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_purchase_id uuid;
  v_purchase public.billing_purchases;
  v_subscription public.billing_subscriptions;
  v_offer public.billing_offers;
  v_status text;
  v_rows integer;
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

  insert into public.billing_events (provider_event_id, type)
  values (p_event_id, left(p_type, 120))
  on conflict (provider_event_id) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  if p_subscription_id is null or btrim(p_subscription_id) = '' then
    update public.billing_events
       set status = 'ignored', detail = 'missing subscription', processed_at = now()
     where provider_event_id = p_event_id;
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'missing-subscription');
  end if;

  if p_purchase_id is not null then
    select id into v_purchase_id
      from public.billing_purchases
     where id = p_purchase_id
       for update;
  end if;

  if v_purchase_id is null then
    select p.id into v_purchase_id
      from public.billing_purchases p
      join public.billing_subscriptions s on s.purchase_id = p.id
     where s.provider_subscription_id = p_subscription_id
       for update of p;
  end if;

  if v_purchase_id is null then
    update public.billing_events
       set status = 'ignored', detail = 'unknown purchase', processed_at = now()
     where provider_event_id = p_event_id;
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'unknown-purchase');
  end if;

  select * into v_purchase
    from public.billing_purchases
   where id = v_purchase_id;

  select * into v_offer
    from public.billing_offers
   where slug = v_purchase.offer_slug;

  if not found or v_offer.billing_mode <> 'subscription' then
    update public.billing_events
       set status = 'ignored', detail = 'not a subscription offer', processed_at = now()
     where provider_event_id = p_event_id;
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'not-subscription');
  end if;

  v_status := case
    when p_type = 'customer.subscription.deleted' then 'canceled'
    when p_type = 'invoice.payment_failed' then 'past_due'
    when p_type = 'invoice.paid' then 'active'
    else coalesce(nullif(btrim(p_status), ''), 'active')
  end;

  insert into public.billing_subscriptions (
    purchase_id, user_id, offer_slug, quantity, workspace_id, project_id,
    provider_customer_id, provider_subscription_id, provider_price_id,
    status, current_period_start, current_period_end, cancel_at_period_end,
    canceled_at
  )
  values (
    v_purchase.id, v_purchase.user_id, v_purchase.offer_slug,
    coalesce(p_quantity, v_purchase.quantity), v_purchase.workspace_id,
    v_purchase.project_id, p_customer_id, p_subscription_id, p_price_id,
    v_status, p_period_start, p_period_end, coalesce(p_cancel_at_period_end, false),
    case when v_status = 'canceled' then now() else null end
  )
  on conflict (provider_subscription_id) do update
    set quantity = coalesce(excluded.quantity, public.billing_subscriptions.quantity),
        provider_customer_id = coalesce(excluded.provider_customer_id, public.billing_subscriptions.provider_customer_id),
        provider_price_id = coalesce(excluded.provider_price_id, public.billing_subscriptions.provider_price_id),
        status = excluded.status,
        current_period_start = coalesce(excluded.current_period_start, public.billing_subscriptions.current_period_start),
        current_period_end = coalesce(excluded.current_period_end, public.billing_subscriptions.current_period_end),
        cancel_at_period_end = coalesce(p_cancel_at_period_end, public.billing_subscriptions.cancel_at_period_end),
        canceled_at = coalesce(excluded.canceled_at, public.billing_subscriptions.canceled_at),
        updated_at = now()
  returning * into v_subscription;

  if v_purchase.status = 'paid' then
    update public.billing_entitlements
       set expires_at = coalesce(p_period_end, expires_at),
           status = case
             when v_status = 'incomplete_expired'
               or (v_status = 'canceled' and (p_period_end is null or p_period_end <= now()))
               then 'revoked'
             when p_period_end is not null and p_period_end <= now()
               then 'expired'
             else 'active'
           end,
           updated_at = now()
     where purchase_id = v_purchase.id;
  end if;

  update public.billing_events
     set status = 'processed', processed_at = now()
   where provider_event_id = p_event_id;

  return jsonb_build_object(
    'ok', true,
    'subscription_id', v_subscription.id,
    'status', v_subscription.status,
    'period_end', v_subscription.current_period_end
  );
end;
$$;

-- The signed-in owner can stop renewal without exposing the Stripe key to the
-- browser. Stripe is updated first; this records the same intent locally.
create or replace function public.billing_request_cancel_subscription(
  p_provider_subscription_id text
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

  update public.billing_subscriptions
     set cancel_at_period_end = true,
         canceled_at = coalesce(canceled_at, now()),
         updated_at = now()
   where provider_subscription_id = p_provider_subscription_id
     and user_id = v_user
     and status in ('active', 'trialing', 'past_due');

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Access control
-- ---------------------------------------------------------------------------

alter table public.billing_subscriptions enable row level security;

drop policy if exists "people read their own subscriptions" on public.billing_subscriptions;
create policy "people read their own subscriptions"
  on public.billing_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.billing_subscriptions from anon, authenticated;
grant select on public.billing_subscriptions to authenticated;

revoke all on function public.billing_handle_subscription_event(
  text, text, text, text, text, text, text, integer, timestamptz, timestamptz, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.billing_handle_subscription_event(
  text, text, text, text, text, text, text, integer, timestamptz, timestamptz, boolean, uuid
) to anon;

revoke all on function public.billing_request_cancel_subscription(text)
  from public, anon, authenticated;
grant execute on function public.billing_request_cancel_subscription(text)
  to authenticated;
