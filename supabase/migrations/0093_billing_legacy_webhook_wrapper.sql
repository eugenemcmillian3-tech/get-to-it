-- `0092` replaced the 12-argument `billing_handle_subscription_event` with the
-- 13-argument version that carries `event.created`. Because it dropped the old
-- signature instead of overloading it, every caller had to ship at the same time:
-- a deploy from `main` (still on the 12-argument call while PR #200 is blocked),
-- or an application rollback after this migration, made PostgREST reject each
-- subscription delivery, so renewals, cancellations and refunds stopped being
-- recorded while the database already had the new shape.
--
-- Recreating the old signature as a thin wrapper removes that coupling. Both
-- callers run one implementation: the new build passes `p_event_created`, an
-- older build cannot, and the wrapper passes none.
--
-- Forwarding no event time is the honest reading of an old caller: it has no
-- newer information to contribute, so `last_event_at` keeps the watermark it has
-- and the staleness guard simply does not apply to that delivery. Nothing else
-- differs, because the wrapper holds no logic: `canceled` is still terminal
-- (0090), a failed renewal still keeps the paid period (0091), and the period end
-- of an immediate cancellation is still the cutoff.
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
language sql
security definer
set search_path = ''
as $$
  select public.billing_handle_subscription_event(
    p_token,
    p_event_id,
    p_type,
    p_subscription_id,
    p_customer_id,
    p_status,
    p_price_id,
    p_quantity,
    p_period_start,
    p_period_end,
    p_cancel_at_period_end,
    p_purchase_id,
    null::timestamptz
  );
$$;

revoke all on function public.billing_handle_subscription_event(
  text, text, text, text, text, text, text, integer, timestamptz, timestamptz, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.billing_handle_subscription_event(
  text, text, text, text, text, text, text, integer, timestamptz, timestamptz, boolean, uuid
) to anon;

-- The refund lookup answers one question: which Stripe subscription should be
-- stopped for this refunded payment. It used to return the purchase status and
-- the subscription status as well, and the webhook skipped the cancellation
-- unless the purchase already said `refunded`. That gate was wrong in the
-- direction that costs money: a signed refund whose bookkeeping had not caught up
-- left an active subscription billing a customer who had been refunded. Stripe
-- already treats a second cancellation as success, so the caller needs the id and
-- nothing else.
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

  if not found then
    return jsonb_build_object('ok', true, 'found', false);
  end if;

  -- A one-time offer has a purchase but no subscription, so there is nothing to
  -- stop and no id to return.
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
end;
$$;

revoke all on function public.billing_subscription_for_payment(text, text)
  from public, anon, authenticated;
grant execute on function public.billing_subscription_for_payment(text, text)
  to anon;
