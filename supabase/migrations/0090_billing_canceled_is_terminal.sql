-- Canceled is terminal.
--
-- Stripe can deliver customer.subscription.updated out of order, including an
-- older active update after customer.subscription.deleted. Preserve the
-- canceled status and the actual period end, and keep the entitlement revoked
-- so a delayed event cannot restore access.

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
        status = case
          when public.billing_subscriptions.status = 'canceled' then 'canceled'
          else excluded.status
        end,
        current_period_start = coalesce(excluded.current_period_start, public.billing_subscriptions.current_period_start),
        current_period_end = case
          when public.billing_subscriptions.status = 'canceled'
            then public.billing_subscriptions.current_period_end
          else coalesce(excluded.current_period_end, public.billing_subscriptions.current_period_end)
        end,
        cancel_at_period_end = coalesce(p_cancel_at_period_end, public.billing_subscriptions.cancel_at_period_end),
        canceled_at = coalesce(excluded.canceled_at, public.billing_subscriptions.canceled_at),
        updated_at = now()
  returning * into v_subscription;

  if v_purchase.status = 'paid' then
    update public.billing_entitlements
       set expires_at = case
             when v_subscription.status = 'canceled'
               then least(coalesce(p_period_end, expires_at), expires_at)
             else coalesce(p_period_end, expires_at)
           end,
           status = case
             when v_subscription.status = 'incomplete_expired'
               or v_subscription.status = 'canceled'
               then 'revoked'
             when v_subscription.current_period_end is not null
               and v_subscription.current_period_end <= now()
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
