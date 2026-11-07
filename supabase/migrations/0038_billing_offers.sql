-- GET TO IT — Phase 31: paid offers and entitlements.
--
-- These are paid product offers, not AI credits. Nothing in this migration
-- inserts into credit_ledger or grants an AI allowance. Every price is the
-- app's own list price; Stripe is only the payment processor.
--
-- Fulfilment is automatic: a verified checkout event creates one entitlement
-- row, and the rest of the app reads that row. There is no manual approval and
-- no browser redirect is treated as payment.

-- ---------------------------------------------------------------------------
-- 1. What can be bought
-- ---------------------------------------------------------------------------

create table if not exists public.billing_offers (
  slug text primary key,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  description text not null check (char_length(btrim(description)) between 1 and 600),
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'usd' check (currency in ('usd')),
  billing_mode text not null default 'one_time'
    check (billing_mode in ('one_time')),
  quantity_label text not null default 'quantity'
    check (char_length(btrim(quantity_label)) between 1 and 40),
  min_quantity integer not null default 1 check (min_quantity between 1 and 100),
  max_quantity integer not null default 1
    check (max_quantity between min_quantity and 100),
  seat_based boolean not null default false,
  grants text[] not null default '{}',
  duration_days integer check (duration_days is null or duration_days between 1 and 3650),
  sort_order integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.billing_offers (
  slug, label, description, price_cents, billing_mode, quantity_label,
  min_quantity, max_quantity, seat_based, grants, duration_days, sort_order
)
values
  (
    'team_seats',
    'Team seats',
    'Add seats to a workspace for 30 days. The owner counts as one seat. Buy the total number of people you need, including the owner. Does not include AI credits.',
    1900, 'one_time', 'total seats', 2, 50, true,
    array['team_seats']::text[], 30, 1
  ),
  (
    'pro',
    'Pro bundle',
    'A 30-day bundle of premium templates, priority support and the white-label entitlement. Does not include AI credits or team seats.',
    4900, 'one_time', 'pass', 1, 1, false,
    array['premium_templates','priority_support','white_label','onboarding']::text[], 30, 2
  ),
  (
    'automation_plus',
    'Automation add-on',
    'Raise the daily external-tool limit for 30 days: 500 calls and 100 writes per project per day instead of 100 and 25. Every action still needs its own approval.',
    1900, 'one_time', 'pass', 1, 1, false,
    array['automation_plus']::text[], 30, 3
  ),
  (
    'build_release',
    'Build & release pack',
    'Unlock production deployment for 90 days. Preview deployment, provider connections, checks, migration review and explicit approval still apply.',
    7900, 'one_time', 'pass', 1, 1, false,
    array['build_release']::text[], 90, 4
  ),
  (
    'premium_templates',
    'Premium templates',
    'Unlock the premium template collection for this account. One payment, no renewal. Does not include AI credits.',
    2900, 'one_time', 'collection', 1, 1, false,
    array['premium_templates']::text[], null, 5
  ),
  (
    'white_label',
    'White-label & custom domain',
    'Unlock custom-domain attachment for your generated apps and a white-label entitlement for this account. You still add the DNS records at your registrar; the app attaches the domain to the connected Vercel project.',
    9900, 'one_time', 'entitlement', 1, 1, false,
    array['white_label']::text[], null, 6
  ),
  (
    'priority_support',
    'Priority support & onboarding',
    'A 30-day priority support queue and the self-serve onboarding checklist. Messages are recorded here; GET TO IT does not promise a human response time. Does not include AI credits.',
    9900, 'one_time', 'pass', 1, 1, false,
    array['priority_support','onboarding']::text[], 30, 7
  )
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Purchases, entitlements and provider events
-- ---------------------------------------------------------------------------

create table if not exists public.billing_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  offer_slug text not null references public.billing_offers (slug),
  quantity integer not null check (quantity between 1 and 100),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency in ('usd')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'refunded', 'failed', 'canceled', 'expired')),
  workspace_id uuid references public.workspaces (id) on delete set null,
  project_id uuid references public.app_projects (id) on delete set null,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_session_id text unique,
  provider_payment_id text unique,
  receipt_url text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_purchases_user_idx
  on public.billing_purchases (user_id, created_at desc);
create index if not exists billing_purchases_workspace_idx
  on public.billing_purchases (workspace_id, created_at desc);

create table if not exists public.billing_entitlements (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.billing_purchases (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  offer_slug text not null references public.billing_offers (slug),
  grants text[] not null default '{}',
  quantity integer not null default 1 check (quantity between 1 and 100),
  workspace_id uuid references public.workspaces (id) on delete set null,
  project_id uuid references public.app_projects (id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists billing_entitlements_one_per_purchase
  on public.billing_entitlements (purchase_id);
create index if not exists billing_entitlements_user_idx
  on public.billing_entitlements (user_id, created_at desc);
create index if not exists billing_entitlements_workspace_idx
  on public.billing_entitlements (workspace_id, created_at desc);

create table if not exists public.billing_events (
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
-- 3. Priority support and custom domains
-- ---------------------------------------------------------------------------

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 3 and 160),
  body text not null check (char_length(btrim(body)) between 3 and 4000),
  status text not null default 'open' check (status in ('open', 'closed')),
  priority text not null default 'priority' check (priority in ('standard', 'priority')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_requests_user_idx
  on public.support_requests (user_id, created_at desc);

create table if not exists public.app_custom_domains (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null check (char_length(btrim(domain)) between 4 and 253),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'error')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, domain)
);

create index if not exists app_custom_domains_user_idx
  on public.app_custom_domains (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Entitlement checks
-- ---------------------------------------------------------------------------

create or replace function public.billing_user_has_grant(p_user_id uuid, p_grant text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.billing_entitlements e
     where e.user_id = p_user_id
       and e.status = 'active'
       and (e.expires_at is null or e.expires_at > now())
       and p_grant = any (e.grants)
  );
$$;

create or replace function public.billing_has_grant(p_grant text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.billing_user_has_grant(auth.uid(), p_grant);
$$;

-- The owner counts as the first seat. Buying 5 seats therefore allows the
-- owner plus four active members or pending invitations.
create or replace function public.billing_workspace_seat_limit(p_workspace_id uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select greatest(
    1,
    coalesce((
      select sum(e.quantity)
        from public.billing_entitlements e
       where e.workspace_id = p_workspace_id
         and e.offer_slug = 'team_seats'
         and e.status = 'active'
         and (e.expires_at is null or e.expires_at > now())
    ), 0)
  )::integer;
$$;

create or replace function public.billing_automation_limits(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select case
    when public.billing_user_has_grant(p_user_id, 'automation_plus') then
      jsonb_build_object('calls_limit', 500, 'writes_limit', 100)
    else
      jsonb_build_object('calls_limit', 100, 'writes_limit', 25)
  end;
$$;

-- This trigger is the seat boundary. The invitation function returns a clear
-- code when it can, but a direct insert cannot exceed the purchased seats.
create or replace function public.billing_guard_workspace_seats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
  v_limit integer;
begin
  select count(*) into v_used
    from public.workspace_members
   where workspace_id = new.workspace_id
     and status = 'active';

  select v_used + count(*) into v_used
    from public.workspace_invitations
   where workspace_id = new.workspace_id
     and status = 'pending'
     and expires_at > now();

  v_limit := public.billing_workspace_seat_limit(new.workspace_id);

  if v_used >= v_limit then
    raise exception 'workspace-seat-limit'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists billing_guard_workspace_seats_trigger on public.workspace_invitations;
create trigger billing_guard_workspace_seats_trigger
  before insert on public.workspace_invitations
  for each row execute function public.billing_guard_workspace_seats();

-- Production deployments are a paid capability. The check is also repeated in
-- the server actions so the UI gets a useful message, but this trigger is the
-- boundary for every insert path, including the developer API.
create or replace function public.billing_guard_production_deployment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.target = 'production'
     and not public.billing_user_has_grant(new.user_id, 'build_release') then
    raise exception 'build-release-required'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists billing_guard_production_deployment_trigger on public.app_deployments;
create trigger billing_guard_production_deployment_trigger
  before insert on public.app_deployments
  for each row execute function public.billing_guard_production_deployment();

-- ---------------------------------------------------------------------------
-- 5. Checkout and automatic fulfilment
-- ---------------------------------------------------------------------------

create or replace function public.create_billing_purchase(
  p_offer_slug text,
  p_quantity integer default 1,
  p_workspace_id uuid default null,
  p_project_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_offer public.billing_offers;
  v_quantity integer := coalesce(p_quantity, 1);
  v_amount integer;
  v_purchase public.billing_purchases;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_offer
    from public.billing_offers
   where slug = p_offer_slug and active;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown-offer');
  end if;

  if v_quantity < v_offer.min_quantity or v_quantity > v_offer.max_quantity then
    return jsonb_build_object('ok', false, 'code', 'invalid-quantity');
  end if;

  if p_workspace_id is not null then
    if public.workspace_role(p_workspace_id) is distinct from 'owner' then
      return jsonb_build_object('ok', false, 'code', 'not-workspace-owner');
    end if;
  elsif v_offer.seat_based then
    return jsonb_build_object('ok', false, 'code', 'workspace-required');
  end if;

  if p_project_id is not null and not exists (
    select 1 from public.app_projects p
     where p.id = p_project_id and p.user_id = v_user
  ) then
    return jsonb_build_object('ok', false, 'code', 'not-project-owner');
  end if;

  v_amount := v_offer.price_cents * v_quantity;

  insert into public.billing_purchases (
    user_id, offer_slug, quantity, amount_cents, currency, workspace_id, project_id
  )
  values (
    v_user, v_offer.slug, v_quantity, v_amount, v_offer.currency,
    p_workspace_id, p_project_id
  )
  returning * into v_purchase;

  return jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'offer_slug', v_offer.slug,
    'quantity', v_quantity,
    'amount_cents', v_amount,
    'currency', v_offer.currency,
    'label', v_offer.label,
    'billing_mode', v_offer.billing_mode,
    'grants', v_offer.grants,
    'duration_days', v_offer.duration_days
  );
end;
$$;

create or replace function public.attach_billing_session(
  p_purchase_id uuid,
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

  update public.billing_purchases
     set provider_session_id = p_session_id,
         updated_at = now()
   where id = p_purchase_id
     and user_id = v_user
     and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-pending');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cancel_billing_purchase(p_purchase_id uuid)
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

  update public.billing_purchases
     set status = 'canceled', updated_at = now()
   where id = p_purchase_id
     and user_id = v_user
     and status = 'pending';

  return jsonb_build_object('ok', true, 'canceled', found);
end;
$$;

-- Called by the signed Stripe webhook with the same capability token as credit
-- purchases. A repeated event is harmless.
create or replace function public.billing_handle_event(
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
  v_purchase public.billing_purchases;
  v_offer public.billing_offers;
  v_rows integer;
  v_expires timestamptz;
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

  if p_type = 'checkout.session.completed' then
    select * into v_purchase
      from public.billing_purchases
     where provider_session_id = p_session_id
       for update;

    if not found then
      update public.billing_events
         set status = 'ignored', detail = 'unknown session', processed_at = now()
       where provider_event_id = p_event_id;
      return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'unknown-session');
    end if;

    if v_purchase.status <> 'pending' then
      update public.billing_events
         set status = 'ignored', detail = 'purchase not pending', processed_at = now()
       where provider_event_id = p_event_id;
      return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'not-pending');
    end if;

    select * into v_offer
      from public.billing_offers
     where slug = v_purchase.offer_slug;

    v_expires := case
      when v_offer.duration_days is null then null
      else now() + make_interval(days => v_offer.duration_days)
    end;

    update public.billing_purchases
       set status = 'paid',
           provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
           receipt_url = coalesce(p_receipt_url, receipt_url),
           paid_at = now(),
           updated_at = now()
     where id = v_purchase.id;

    insert into public.billing_entitlements (
      purchase_id, user_id, offer_slug, grants, quantity,
      workspace_id, project_id, expires_at
    )
    values (
      v_purchase.id, v_purchase.user_id, v_offer.slug, v_offer.grants,
      v_purchase.quantity, v_purchase.workspace_id, v_purchase.project_id, v_expires
    )
    on conflict (purchase_id) do nothing;

    update public.billing_events
       set status = 'processed', processed_at = now()
     where provider_event_id = p_event_id;

    return jsonb_build_object(
      'ok', true, 'granted', v_offer.slug, 'purchase_id', v_purchase.id
    );
  end if;

  if p_type = 'checkout.session.expired' then
    update public.billing_purchases
       set status = 'expired', updated_at = now()
     where provider_session_id = p_session_id and status = 'pending';

    update public.billing_events
       set status = 'processed', processed_at = now()
     where provider_event_id = p_event_id;

    return jsonb_build_object('ok', true, 'expired', true);
  end if;

  if p_type = 'checkout.session.async_payment_failed' then
    update public.billing_purchases
       set status = 'failed', updated_at = now()
     where provider_session_id = p_session_id and status = 'pending';

    update public.billing_events
       set status = 'processed', processed_at = now()
     where provider_event_id = p_event_id;

    return jsonb_build_object('ok', true, 'failed', true);
  end if;

  if p_type = 'charge.refunded' then
    select * into v_purchase
      from public.billing_purchases
     where provider_payment_id = p_provider_payment_id
       for update;

    if not found then
      update public.billing_events
         set status = 'ignored', detail = 'unknown payment', processed_at = now()
       where provider_event_id = p_event_id;
      return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'unknown-payment');
    end if;

    update public.billing_purchases
       set status = 'refunded', refunded_at = now(), updated_at = now()
     where id = v_purchase.id and status = 'paid';

    update public.billing_entitlements
       set status = 'revoked', updated_at = now()
     where purchase_id = v_purchase.id;

    update public.billing_events
       set status = 'processed', processed_at = now()
     where provider_event_id = p_event_id;

    return jsonb_build_object('ok', true, 'refunded', true, 'purchase_id', v_purchase.id);
  end if;

  update public.billing_events
     set status = 'ignored', detail = 'unhandled event type', processed_at = now()
   where provider_event_id = p_event_id;

  return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'unhandled-type');
end;
$$;

create or replace function public.create_support_request(
  p_subject text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if not public.billing_user_has_grant(v_user, 'priority_support') then
    return jsonb_build_object('ok', false, 'code', 'priority-required');
  end if;

  if char_length(btrim(coalesce(p_subject, ''))) < 3
     or char_length(btrim(coalesce(p_body, ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'invalid-request');
  end if;

  insert into public.support_requests (user_id, subject, body, priority)
  values (v_user, left(btrim(p_subject), 160), left(btrim(p_body), 4000), 'priority')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Row level security and grants
-- ---------------------------------------------------------------------------

alter table public.billing_offers enable row level security;
alter table public.billing_purchases enable row level security;
alter table public.billing_entitlements enable row level security;
alter table public.billing_events enable row level security;
alter table public.support_requests enable row level security;
alter table public.app_custom_domains enable row level security;

drop policy if exists "active offers are readable" on public.billing_offers;
create policy "active offers are readable"
  on public.billing_offers for select to authenticated
  using (active);

drop policy if exists "people read their own purchases" on public.billing_purchases;
create policy "people read their own purchases"
  on public.billing_purchases for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people read their own entitlements" on public.billing_entitlements;
create policy "people read their own entitlements"
  on public.billing_entitlements for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people read their own support requests" on public.support_requests;
create policy "people read their own support requests"
  on public.support_requests for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "owners manage their custom domains" on public.app_custom_domains;
create policy "owners manage their custom domains"
  on public.app_custom_domains for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

revoke all on public.billing_offers from anon, authenticated;
revoke all on public.billing_purchases from anon, authenticated;
revoke all on public.billing_entitlements from anon, authenticated;
revoke all on public.billing_events from anon, authenticated;
revoke all on public.support_requests from anon, authenticated;
revoke all on public.app_custom_domains from anon, authenticated;

grant select on public.billing_offers to authenticated;
grant select on public.billing_purchases to authenticated;
grant select on public.billing_entitlements to authenticated;
grant select on public.support_requests to authenticated;
grant select, insert, update, delete on public.app_custom_domains to authenticated;

revoke all on function public.billing_user_has_grant(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_has_grant(text) from public, anon;
revoke all on function public.billing_workspace_seat_limit(uuid) from public, anon;
revoke all on function public.billing_automation_limits(uuid) from public, anon;
revoke all on function public.create_billing_purchase(text, integer, uuid, uuid) from public, anon;
revoke all on function public.attach_billing_session(uuid, text) from public, anon;
revoke all on function public.cancel_billing_purchase(uuid) from public, anon;
revoke all on function public.billing_handle_event(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_support_request(text, text) from public, anon;
revoke all on function public.billing_guard_workspace_seats() from public, anon, authenticated;
revoke all on function public.billing_guard_production_deployment() from public, anon, authenticated;

grant execute on function public.billing_has_grant(text) to authenticated;
grant execute on function public.billing_workspace_seat_limit(uuid) to authenticated;
grant execute on function public.create_billing_purchase(text, integer, uuid, uuid) to authenticated;
grant execute on function public.attach_billing_session(uuid, text) to authenticated;
grant execute on function public.cancel_billing_purchase(uuid) to authenticated;
grant execute on function public.create_support_request(text, text) to authenticated;
grant execute on function public.billing_handle_event(text, text, text, text, text, text) to anon;

-- Keep the existing Composio limits, but read the purchased entitlement.
create or replace function public.composio_claim_action(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_action public.app_composio_actions;
  v_usage public.app_composio_usage;
  v_tool public.app_composio_tools;
  v_connection public.app_composio_connections;
  v_calls_limit integer := 100;
  v_writes_limit integer := 25;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if public.billing_user_has_grant(v_uid, 'automation_plus') then
    v_calls_limit := 500;
    v_writes_limit := 100;
  end if;

  if exists (
    select 1 from public.app_composio_actions a
     where a.id = p_action_id and a.user_id = v_uid and a.status = 'executing'
  ) then
    return jsonb_build_object('ok', false, 'code', 'busy', 'message', 'That action is already running.');
  end if;

  if not exists (
    select 1 from public.app_composio_actions a
     where a.id = p_action_id and a.user_id = v_uid and a.status = 'approved'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_state', 'message', 'That action is not approved for execution.');
  end if;

  if exists (
    select 1 from public.app_composio_actions a
     where a.user_id = v_uid and a.status = 'executing'
  ) then
    return jsonb_build_object('ok', false, 'code', 'busy', 'message', 'Wait for the current tool call to finish.');
  end if;

  insert into public.app_composio_usage (user_id, project_id, day, calls, writes)
  select v_uid, a.project_id, current_date, 1, 1
    from public.app_composio_actions a
   where a.id = p_action_id and a.user_id = v_uid
  on conflict (user_id, project_id, day) do update
    set calls = public.app_composio_usage.calls + 1,
        writes = public.app_composio_usage.writes + 1,
        updated_at = now()
    where public.app_composio_usage.calls < v_calls_limit
      and public.app_composio_usage.writes < v_writes_limit
  returning * into v_usage;

  if v_usage.id is null then
    return jsonb_build_object('ok', false, 'code', 'quota_exceeded', 'message', 'The daily external-tool limit has been reached.');
  end if;

  update public.app_composio_actions a
     set status = 'executing',
         attempts = a.attempts + 1,
         started_at = now(),
         updated_at = now()
   where a.id = p_action_id
     and a.user_id = v_uid
     and a.status = 'approved'
     and exists (
       select 1 from public.app_composio_tool_grants g
        where g.id = a.grant_id and g.enabled
     )
     and exists (
       select 1 from public.app_composio_connections c
        where c.id = a.connection_id and c.status = 'active'
     )
  returning * into v_action;

  if not found then
    update public.app_composio_usage u
       set calls = greatest(0, u.calls - 1),
           writes = greatest(0, u.writes - 1),
           updated_at = now()
     where u.id = v_usage.id;

    return jsonb_build_object('ok', false, 'code', 'invalid_state', 'message', 'That action is not approved for execution.');
  end if;

  select * into v_tool
    from public.app_composio_tools t
   where t.connection_id = v_action.connection_id and t.tool_slug = v_action.tool_slug;

  select * into v_connection
    from public.app_composio_connections c
   where c.id = v_action.connection_id;

  return jsonb_build_object(
    'ok', true,
    'action', jsonb_build_object(
      'id', v_action.id,
      'status', v_action.status,
      'project_id', v_action.project_id,
      'connection_id', v_action.connection_id,
      'toolkit', v_connection.toolkit,
      'connected_account_id', v_connection.connected_account_id,
      'tool_slug', v_action.tool_slug,
      'tool_name', v_action.tool_name,
      'arguments', v_action.arguments,
      'arguments_hash', v_action.arguments_hash,
      'attempts', v_action.attempts
    )
  );
end;
$$;

revoke all on function public.composio_claim_action(uuid) from public, anon, authenticated;
grant execute on function public.composio_claim_action(uuid) to authenticated;

create or replace function public.composio_usage(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_usage public.app_composio_usage;
  v_limits jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if not exists (
    select 1 from public.app_projects p where p.id = p_project_id and p.user_id = v_uid
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That app project is not available.');
  end if;

  select * into v_usage
    from public.app_composio_usage u
   where u.user_id = v_uid and u.project_id = p_project_id and u.day = current_date;

  v_limits := public.billing_automation_limits(v_uid);

  return jsonb_build_object(
    'ok', true,
    'calls', coalesce(v_usage.calls, 0),
    'writes', coalesce(v_usage.writes, 0),
    'calls_limit', (v_limits ->> 'calls_limit')::integer,
    'writes_limit', (v_limits ->> 'writes_limit')::integer
  );
end;
$$;

revoke all on function public.composio_usage(uuid) from public, anon, authenticated;
grant execute on function public.composio_usage(uuid) to authenticated;
