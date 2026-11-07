# Pricing decision and rate-card gate

## Decision

- **Retail value:** one credit costs **$0.10 USD**.
- **Model:** prepaid AI credits plus optional paid product offers. No free plan, no trial, no promotional credits and no mandatory subscription or auto-renewal.
- **New accounts:** zero credits. Nothing is granted at signup.
- **Credit packs:** one-time purchases only.

| Pack | Price | Credits | Price per credit |
| --- | ---: | ---: | ---: |
| Starter | $5.00 | 50 | $0.10 |
| Steady | $10.00 | 100 | $0.10 |
| Deep | $25.00 | 250 | $0.10 |
| Builder | $50.00 | 500 | $0.10 |
| Studio | $100.00 | 1,000 | $0.10 |

The $0.10 decision supersedes the earlier $0.01-per-credit proposal. It is a
retail-price increase for the same work allowance, not just a wallet
denomination change.

## Paid product offers — separate from AI credits

Seven optional offers are implemented in `0038_billing_offers.sql`. They are
paid product entitlements and **never add AI credits or an AI allowance**:

| Offer | Default price | Access |
| --- | ---: | --- |
| Team seats | $19 per seat / 30 days | Raises the workspace seat limit. The owner is seat one. |
| Pro bundle | $49 / 30 days | Premium templates, priority support, white-label and onboarding. |
| Automation add-on | $19 / 30 days | 500 calls and 100 writes per project per day instead of 100 and 25. |
| Build & release pack | $79 / 90 days | Production deployment. Checks and explicit approval still apply. |
| Premium templates | $29 | The two premium static templates. |
| White-label & custom domain | $99 | Attaches a Vercel domain; the customer still owns DNS. |
| Priority support & onboarding | $99 / 30 days | Priority request queue and self-serve onboarding checklist. |

Prices are defaults in the database and can be changed without a code deploy.
Checkout is one-time in test mode; nothing renews. A verified webhook creates
one entitlement row, and every gate checks the database and expiry. Refunds
revoke the entitlement without deleting existing work. DNS and human support
response time remain explicit external limits, not promises.

## Reference workload — not a universal allowance

The reference workload is **GLM 5.3 Flash, 10,000 uncached input tokens plus
2,000 output tokens**, priced at **1 credit ($0.10)**.

That number is an example for one model and one workload. It is **not** a
universal price for every model or operation. A different model, context size,
tool call, build, swarm or workflow can have a different charge.

## Operation rate card — approved for implementation, not live

The owner approved the operation card on **2026-11-05** for implementation. The
sourced detail is in [`RATE_CARD_DRAFT.md`](RATE_CARD_DRAFT.md).

Implemented in `0035_operation_budgets.sql` and the application:

| Operation | Credits | Dollars |
| --- | ---: | ---: |
| Unstuck help | 1 | $0.10 |
| Goal plan | 1 | $0.10 |
| Task help | 1 | $0.10 |
| Learning path | 1 | $0.10 |
| Learning step help | 1 | $0.10 |
| Workflow draft | 1 | $0.10 |
| Future paths | 1 | $0.10 |
| One review perspective | 1 | $0.10 |
| Mission assist | 1 | $0.10 |
| Build repair attempt | 2 | $0.20 |

The database derives the charge from the operation kind, locks any budget row in
the same transaction as the reservation, and releases both the credits and the
budget slot when a request fails or times out.

Budgets:

- **Build:** three repair attempts, 2 credits each, 6 credits per workspace.
- **Workflow:** user-selectable limit up to 10 credits per run.
- **Swarm:** 0 credits today; fixture-only, with no paid AI path.

The credits page and the AI controls show the estimate in credits and dollars.
A zero balance blocks new paid work but leaves saved results, settings and billing
available.

## Activation gate

This is implemented, but **not activated**:

- `0034_credit_pricing.sql` and `0035_operation_budgets.sql` are not applied to
  production.
- Live billing, production deployment and any production migration still need
  separate owner approval.
- Production `public.ai_prices` remains empty. Provider-cost rows are documented
  but not applied.
- Token envelopes are planning assumptions, not observed production p50/p95.
- The `:cloud` model tags still need authenticated verification.
- Microcredit accounting (1 credit = 1,000,000 µcr) is proposed, not implemented.
  The ledger still stores whole integer credits.

The purchase, duplicate-webhook, reservation, settlement, release, refund,
insufficient-balance, 2-credit repair and workflow-budget tests pass locally.

The step-by-step production rollout, verification queries and restore-based
rollback are in [`DEPLOYMENT.md`](DEPLOYMENT.md#pricing-rollout-0034-and-0035).
Executing them still requires separate owner approval.

## Existing balances

Before this pricing change, production was audited read-only:

- 0 credit purchases
- 0 paid payments
- 0 credit-ledger rows
- 0 outstanding credit balance

There is therefore no historical balance to revalue, remove or migrate. The
migrations deliberately do not update `credit_ledger` or any `credit_payments`
row. Each payment copies its credits and amount when it is created, so a later
pack change cannot rewrite what a person was charged.

If production had contained balances, the migration would stop for a separate
decision rather than silently repricing them.
