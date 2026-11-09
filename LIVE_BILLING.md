# Going live with payments

**Status: live billing is OFF.** This is the runbook for turning it on, and for
turning it off again in a hurry. The code, the webhook and the credit ledger are
already built and tested; what is missing is a live Stripe account configuration
and a deliberate decision to charge real cards.

Read the whole page before changing anything. The order matters, and two of the
steps are not reversible by deploy alone.

## 1. What is already in place

| Piece | State |
| --- | --- |
| Five credit packs ($5–$100, $0.10/credit) | Active in `public.credit_packs`, constrained to credits × 10 cents |
| Seven paid offers | Active in `public.billing_offers` |
| `POST /api/stripe/webhook` | Deployed, rejects unsigned events with `400`, returns `503` only when its secrets are missing |
| Credits granted | Only by the verified webhook (`credit_handle_event`), never by a redirect |
| Operation prices and budgets | `0034`, `0035` applied; unchanged by any billing switch |
| Provider cost per model | Recorded in `public.ai_prices` (see §7) |
| Free AI allowance | Off: `public.ai_limits.per_user_daily = 0` |
| Purchase receipt email | Built and wired to the webhook; needs `RESEND_API_KEY`, sends from `RESEND_FROM` (default `no-reply@mail.network-x-ai.win`), and delivery to a real mailbox is verified on the live deployment. The body's support line names `NEXT_PUBLIC_LEGAL_CONTACT_EMAIL` when it is set, so set it before charging (see §2 and §4) |

## 2. Prerequisites

- [ ] The Stripe account is activated and able to accept payments (payouts enabled).
- [ ] The legal pages name the operator: set `NEXT_PUBLIC_LEGAL_OPERATOR_NAME`,
      `NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS` and `NEXT_PUBLIC_LEGAL_CONTACT_EMAIL`
      in the production environment. Without them `/terms` says the address is
      not yet published, which is honest but not acceptable once you charge.
- [ ] You accept the refund policy that `/refunds` publishes: full refund of
      **unused** credits within 30 days, spent credits not refundable.
- [ ] You have a card you are willing to charge and refund for the rehearsal.

## 3. Create live prices first

Stripe price objects are **mode-scoped**. The five `STRIPE_PRICE_ID_*` values in
production today point at test-mode prices. A live key cannot use them; checkout
will fail at the last step if you skip this.

Create one live, one-time price per pack with these exact amounts:

| Pack | Credits | Amount |
| --- | ---: | ---: |
| `starter` | 50 | $5.00 |
| `steady` | 100 | $10.00 |
| `deep` | 250 | $25.00 |
| `builder` | 500 | $50.00 |
| `studio` | 1,000 | $100.00 |

`packPriceId()` refuses a price ID whose amount or credit count does not match
the pack definition, so a stale row cannot be paired with a resized price.

## 4. Set the environment variables

Add or change these in the **production** environment, then redeploy:

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | the live key, `sk_live_…` |
| `STRIPE_ALLOW_LIVE` | exactly `true` — anything else refuses the live key |
| `STRIPE_PRICE_ID_STARTER` … `_STUDIO` | the five **live** price IDs |
| `STRIPE_WEBHOOK_SECRET` | signing secret of the **live** webhook endpoint |
| `CREDIT_RPC_TOKEN` | unchanged; must equal `public.app_secrets` → `credit_webhook` |
| `RESEND_API_KEY` | Resend key allowed to send from the receipt domain; without it receipts are recorded as skipped, not failed |
| `RESEND_FROM` | optional; defaults to `no-reply@mail.network-x-ai.win`, which must be a verified Resend domain |

The endpoint to register in Stripe is `https://<your-domain>/api/stripe/webhook`,
subscribed to `checkout.session.completed`, `checkout.session.expired` and
`charge.refunded`.

Never put a key, a secret or a token in a repository file, a `NEXT_PUBLIC_*`
variable, a ticket or a chat message.

## 5. Verify before charging anyone

After the deploy, all three probes must behave like this:

```bash
# no signature -> 400, not 503 (503 means the secrets are missing)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<domain>/api/stripe/webhook \
  -H 'content-type: application/json' -d '{}'

# bogus signature -> 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<domain>/api/stripe/webhook \
  -H 'content-type: application/json' -H 'stripe-signature: t=1,v1=deadbeef' -d '{}'
```

Then sign in and confirm on `/credits` that checkout is offered rather than the
"Stripe isn't configured" notice, and on `/billing` that no "refuses live
payments" warning is shown.

## 6. Rehearsal: one real purchase and one real refund

1. Buy the `starter` pack ($5.00) with a real card. Expect the Stripe receipt and
   `+50` credits in the ledger on `/credits`.
2. In the Stripe dashboard, refund that payment. Expect a `refund` ledger row and
   a balance back to its previous value; the historical `purchase` row stays.
3. Buy a paid offer once (the cheapest available) and confirm the entitlement
   appears only after the webhook, then refund it in Stripe and confirm access is
   revoked.
4. Check `credit_payments` and `billing_purchases` show `paid` then `refunded`;
   `payment_events` has one row per Stripe event id, with no duplicates.

A refund that would take a balance negative is deliberately parked as a failed
event for a person to handle; it is acknowledged so Stripe stops retrying.

## 7. Cost basis for pricing decisions

Provider prices are in `public.ai_prices` (micros per 1K tokens), verified from
Ollama's published pricing on 2026-11-09:

| Model | Input /1M | Output /1M |
| --- | ---: | ---: |
| `deepseek-v4-pro` | $1.32 | $3.96 |
| `mimo-v2.6-pro` | $0.435 | $0.87 |
| `mimo-v2.6-flash` | $0.14 | $0.28 |

Team roles map to models in `src/lib/agent-team.ts`: coordinator
`deepseek-v4-pro`, frontend `deepseek-v4.1-flash`, backend `mimo-v2.6-pro`, data
`gpt-oss:120b-cloud`, qa `gemma4:31b-cloud`, security `mimo-v2.6-flash`.

Revenue per operation is fixed (`team_task` = 2 credits = $0.20). Real cost is
`tokens_in × input_rate + tokens_out × output_rate`, so margin is only known once
usage is recorded. Measure it with:

```sql
select operation,
       count(*)                    as calls,
       sum(tokens_in)              as tokens_in,
       sum(tokens_out)             as tokens_out,
       sum(credits_charged)        as credits_charged,
       round(sum(credits_charged) * 0.10, 2) as revenue_usd
  from public.ai_requests
 group by operation
 order by calls desc;
```

`ai_requests` does not record which model served a call, so for `team_task`
attribute cost per role using the mapping above. Until there is real usage, any
per-task margin is an estimate.

## 8. Turning it off

1. Remove `STRIPE_ALLOW_LIVE` (or set it to anything but `true`). Checkout stops
   immediately for live keys.
2. Redeploy. Confirm `/credits` shows checkout unavailable and that
   `POST /api/stripe/webhook` still returns `400` for unsigned events.
3. Reconcile any charged payments and refunds in the Stripe dashboard. **Never**
   edit `credit_ledger` by hand; use an `adjustment` through the owner tools.

Removing the live key alone is not enough if `STRIPE_ALLOW_LIVE=true` remains set
and a test key is absent — set the kill switch first, then rotate credentials.

## 9. Rotating the webhook secret and the RPC token

Rotate `STRIPE_WEBHOOK_SECRET` and `CREDIT_RPC_TOKEN` **together**, and update
`public.app_secrets.credit_webhook` to the new token in the same window. Accept a
short outage: events Stripe cannot deliver are retried, and the event id makes a
retry harmless. Leaving one side stale means every event is rejected with `401`
while the dashboard looks healthy.

## 10. Things that must never happen

- A key, secret or token in the repository, a `NEXT_PUBLIC_*` variable, a log or a chat message.
- Granting credits from a browser redirect instead of the signed webhook.
- Editing `credit_ledger` directly to "fix" a balance.
- Setting `STRIPE_ALLOW_LIVE=true` without live price IDs, or with test price IDs still installed.
