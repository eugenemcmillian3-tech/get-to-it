-- A refund reaches the webhook as `charge.refunded` on the invoice's charge, and
-- the only id that charge shares with us is its payment intent. Until now the
-- refund path found that id on the purchase, which a subscription Checkout
-- session is not guaranteed to leave behind: `session.payment_intent` is
-- documented for payment mode only. So a refunded subscription could match
-- nothing at all — no revocation, no cancellation, and a customer still being
-- charged for something they were refunded for.
--
-- An invoice, however, always carries the payment intent of the charge it paid.
-- `invoice.paid` therefore records that id on the subscription, and both refund
-- lookups match it: `billing_handle_event` revokes the entitlement through it,
-- and `billing_subscription_for_payment` finds the Stripe subscription to cancel.
-- The Checkout session stops being load-bearing.
--
-- The id is the most recent paid invoice, which is the charge a refund normally
-- targets. An older invoice's charge is not remembered; covering that needs an
-- invoice-to-purchase mapping rather than one column.

alter table public.billing_subscriptions
  add column if not exists provider_payment_id text;

create unique index if not exists billing_subscriptions_payment_idx
  on public.billing_subscriptions (provider_payment_id)
  where provider_payment_id is not null;

create or replace function public.billing_record_invoice_payment(
  p_token text,
  p_subscription_id text,
  p_provider_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_rows integer;
  v_owner text;
begin
  select value into v_expected
    from public.app_secrets
   where name = 'credit_webhook';

  if v_expected is null
     or p_token is null
     or char_length(p_token) < 32
     or v_expected <> p_token then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;

  if p_subscription_id is null or btrim(p_subscription_id) = ''
     or p_provider_payment_id is null or btrim(p_provider_payment_id) = '' then
    return jsonb_build_object('ok', true, 'recorded', false, 'reason', 'missing-detail');
  end if;

  -- The id belongs to one subscription. Moving it off another row would make the
  -- wrong subscription the target of a refund.
  select s.provider_subscription_id into v_owner
    from public.billing_subscriptions s
   where s.provider_payment_id = p_provider_payment_id;

  if v_owner is not null and v_owner <> p_subscription_id then
    return jsonb_build_object('ok', true, 'recorded', false, 'reason', 'linked-elsewhere');
  end if;

  update public.billing_subscriptions
     set provider_payment_id = p_provider_payment_id,
         updated_at = now()
   where provider_subscription_id = p_subscription_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', true, 'recorded', false, 'reason', 'unknown-subscription');
  end if;

  return jsonb_build_object('ok', true, 'recorded', true);
end;
$$;

revoke all on function public.billing_record_invoice_payment(text, text, text)
  from public, anon, authenticated;
grant execute on function public.billing_record_invoice_payment(text, text, text)
  to anon;

-- The refund lookup now answers for both shapes. A one-time offer keeps its
-- payment id on the purchase; a subscription keeps its latest invoice's on the
-- subscription itself.
create or replace function public.billing_subscription_for_payment(
  p_token text,
  p_provider_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_purchase public.billing_purchases;
  v_subscription public.billing_subscriptions;
begin
  select value into v_expected
    from public.app_secrets
   where name = 'credit_webhook';

  if v_expected is null
     or p_token is null
     or char_length(p_token) < 32
     or v_expected <> p_token then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;

  if p_provider_payment_id is null or btrim(p_provider_payment_id) = '' then
    return jsonb_build_object('ok', true, 'found', false);
  end if;

  select * into v_purchase
    from public.billing_purchases
   where provider_payment_id = p_provider_payment_id
   limit 1;

  if found then
    -- A one-time offer has a purchase but no subscription, so there is nothing
    -- to stop and no id to return.
    select * into v_subscription
      from public.billing_subscriptions
     where purchase_id = v_purchase.id;

    if not found then
      return jsonb_build_object('ok', true, 'found', false);
    end if;

    return jsonb_build_object(
      'ok', true,
      'found', true,
      'provider_subscription_id', v_subscription.provider_subscription_id
    );
  end if;

  select * into v_subscription
    from public.billing_subscriptions
   where provider_payment_id = p_provider_payment_id
   limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'found', false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'found', true,
    'provider_subscription_id', v_subscription.provider_subscription_id
  );
end;
$$;

revoke all on function public.billing_subscription_for_payment(text, text)
  from public, anon, authenticated;
grant execute on function public.billing_subscription_for_payment(text, text)
  to anon;

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
      select p.* into v_purchase
        from public.billing_subscriptions s
        join public.billing_purchases p on p.id = s.purchase_id
       where s.provider_payment_id = p_provider_payment_id
         for update of p;
    end if;

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
revoke all on function public.billing_handle_event(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.billing_handle_event(text, text, text, text, text, text) to anon;
