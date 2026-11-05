# Pricing decision and rate-card gate

## Decision

- **Retail value:** one credit costs **$0.10 USD**.
- **Model:** prepaid credits only. No free plan, no trial, no promotional credits and no mandatory subscription.
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

## Reference workload — not a universal allowance

The reference workload is **GLM 5.3 Flash, 10,000 uncached input tokens plus
2,000 output tokens**, proposed at **1 credit ($0.10)**.

That number is an example for one model and one workload. It is **not** a
universal price for every model or operation. A different model, context size,
tool call, build, swarm or workflow can have a different charge.

## Operation rate card — not approved or activated

Operation pricing stays inactive until the owner approves a model-specific rate
card. A sourced draft is in [`RATE_CARD_DRAFT.md`](RATE_CARD_DRAFT.md); it is
not approved and nothing in it is active. Production `public.ai_prices` remains
empty until the owner approves the card and the rows are applied.

The approval table must contain, for each model and operation:

| Field | Why it is required |
| --- | --- |
| Model and operation | A price must name exactly what is being sold |
| Expected input and output tokens | Token use is model- and workload-specific |
| Proposed credits and customer charge | Credits × $0.10 |
| Provider model cost | From a sourced provider price, not an estimate presented as fact |
| Compute, tools and infrastructure cost | Kept separate from the model's token bill |
| Gross margin | Customer charge minus all of those costs |
| Approval | Owner sign-off before activation |

The draft covers the six selectable models, ten operations, separate model/
tools/compute/infrastructure costs, and bundle budgets. It remains a proposal;
no live rate card is approved by this document.

## Current test-mode behavior

The existing reservation remains a **1-credit test-mode reservation** for an AI
request. That is a temporary mechanism, not the final model-specific operation
rate card. It is not evidence that every operation will cost one credit.

The database still reserves atomically, prevents more than one in-flight request
per person, refuses an overdraft at the ledger boundary, and releases a failed
request once. Those controls are the foundation for the approved rate card.

## Existing balances

Before this pricing change, production was audited read-only:

- 0 credit purchases
- 0 paid payments
- 0 credit-ledger rows
- 0 outstanding credit balance

There is therefore no historical balance to revalue, remove or migrate. The
migration deliberately does not update `credit_ledger` or any `credit_payments`
row. Each payment copies its credits and amount when it is created, so a later
pack change cannot rewrite what a person was charged.

If production had contained balances, the migration would stop for a separate
decision rather than silently repricing them.

## Still gated

This change does **not** activate live billing, a production deploy, or the final
operation rate card. It also does not claim that per-operation credit estimates,
aggregate build/swarm/workflow budgets, or sub-credit internal accounting are
complete. Those must be implemented and approved before operation pricing is
switched on.
