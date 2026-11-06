# Operation rate card — approved for implementation, not live

**Status:** the owner approved this card on **2026-11-05** for implementation.
The fixed operation prices and hard build/workflow/swarm budgets are implemented
in `0035_operation_budgets.sql` and tested locally. This is **not** authorization
to apply the migration to production, enable live billing, or deploy. Token
envelopes remain planning assumptions and microcredit accounting is not built.

Prepared **2026-11-05** from published list prices. Re-check every source before
activation; provider prices can change.

## 1. Provider rates

GET TO IT calls models through **Ollama Cloud**, not directly through each model
vendor. Ollama publishes per-token USD rates for these model families.

| App model id | Ollama price row | Input / 1M | Cached input / 1M | Output / 1M |
| --- | --- | ---: | ---: | ---: |
| `glm-5.3-flash` | `glm-5.3-flash` | $0.15 | $0.03 | $0.50 |
| `deepseek-v4.1-flash` | `deepseek-v4.1-flash` (peak) | $0.30 | $0.006 | $1.20 |
| `deepseek-v4.1-flash` | same model, off-peak | $0.15 | $0.003 | $0.60 |
| `minimax-m3.1-flash` | `minimax-m3.1-flash` | $0.15 | $0.015 | $0.60 |
| `gpt-oss:120b-cloud` | `gpt-oss:120b` family | $0.15 | $0.014 | $0.60 |
| `gemma4:31b-cloud` | `gemma4` family | $0.14 | $0.05 | $0.40 |
| `nemotron-3-nano:30b-cloud` | `nemotron-3-nano` family | $0.06 | — | $0.24 |

DeepSeek's peak rate is used for every margin below. Off-peak is cheaper and is
therefore not relied on. Cached input is also ignored: all envelopes assume
uncached input, again the conservative case.

**Model-id caveat:** Ollama's API documentation says to use the base model name
for API requests, not the `:cloud` suffix used by the app picker. The `:31b-cloud`
and `:30b-cloud` tags also have no distinct price row, so the family rates above
are the only defensible mapping. A live authenticated call must verify each id
before activation; a failed id is a product bug, not a pricing decision.

**Sources**

- Ollama Cloud pricing: <https://ollama.com/pricing>
- Ollama usage fields: <https://docs.ollama.com/api/usage>
- Z.ai direct list price, used as a cross-check for GLM-5.3-Flash:
  <https://docs.z.ai/guides/overview/pricing>
- DeepSeek direct list price: <https://api-docs.deepseek.com/quick_start/pricing/>
- MiniMax direct list price: <https://platform.minimax.io/docs/guides/pricing>

## 2. Reference workload

**GLM 5.3 Flash, 10,000 uncached input tokens + 2,000 output tokens = 1 credit
($0.10).**

Provider model cost:

```text
10,000 / 1,000,000 × $0.15 = $0.00150
 2,000 / 1,000,000 × $0.50 = $0.00100
                              --------
                              $0.00250
```

With the planning reserve for compute and infrastructure ($0.002), total cost is
**$0.00450**, leaving **$0.09550** before payment processing: **95.5%**.

This is one reference point. It is not a universal token allowance.

## 3. Operation charges — proposed

These are **one model call per row**. A multi-step feature multiplies by its
number of calls, subject to the bundle budgets in section 5.

Envelopes are planning assumptions, not measured production percentiles. Actual
token counts are already recorded in `public.ai_requests`; replace these numbers
with observed p50/p95 before approval.

| Operation | Expected uncached input | Expected output | Credits | Customer | GLM model cost | DeepSeek peak model cost | Compute/infra reserve | GLM net / margin* | Worst-model net / margin* |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `unstuck` | 3,000 | 1,200 | 1 | $0.10 | $0.00105 | $0.00234 | $0.002 | $0.09695 / 97.0% | $0.09566 / 95.7% |
| `plan` | 4,000 | 2,000 | 1 | $0.10 | $0.00160 | $0.00360 | $0.002 | $0.09640 / 96.4% | $0.09440 / 94.4% |
| `task_help` | 4,000 | 1,500 | 1 | $0.10 | $0.00135 | $0.00300 | $0.002 | $0.09665 / 96.6% | $0.09500 / 95.0% |
| `learning` | 4,000 | 2,500 | 1 | $0.10 | $0.00185 | $0.00420 | $0.002 | $0.09615 / 96.1% | $0.09380 / 93.8% |
| `learning_help` | 4,000 | 1,500 | 1 | $0.10 | $0.00135 | $0.00300 | $0.002 | $0.09665 / 96.6% | $0.09500 / 95.0% |
| `workflow_draft` | 6,000 | 2,000 | 1 | $0.10 | $0.00190 | $0.00420 | $0.002 | $0.09610 / 96.1% | $0.09380 / 93.8% |
| `future_paths` | 4,000 | 2,500 | 1 | $0.10 | $0.00185 | $0.00420 | $0.002 | $0.09615 / 96.1% | $0.09380 / 93.8% |
| `review` (one perspective) | 6,000 | 2,000 | 1 | $0.10 | $0.00190 | $0.00420 | $0.002 | $0.09610 / 96.1% | $0.09380 / 93.8% |
| `mission_assist` | 5,000 | 1,500 | 1 | $0.10 | $0.00150 | $0.00330 | $0.002 | $0.09650 / 96.5% | $0.09470 / 94.7% |
| `app_repair` (one attempt) | 20,000 | 4,000 | 2 | $0.20 | $0.00500 | $0.01080 | $0.004 | $0.19100 / 95.5% | $0.18520 / 92.6% |

\* **Net / margin** is customer charge minus model cost and the compute/
infrastructure planning reserve. **Tools are $0.00** for these operations: the
current AI paths make no provider tool calls. Payment processing is also excluded
from this per-operation table; it is a pack-level cost, not a model-call cost.

The `review` row is one perspective call. A three-perspective review would be
**3 credits ($0.30)** before any bundle discount, with the same per-call costs.
`app_repair` is one repair proposal; a build that requires three attempts has a
**6-credit ($0.60)** AI ceiling.

## 4. Model sensitivity

Same **10,000 input + 2,000 output** workload, 1 credit, with the $0.002 compute/
infrastructure reserve:

| Model | Model cost | Total cost | Net before payment fees | Margin |
| --- | ---: | ---: | ---: | ---: |
| GLM 5.3 Flash | $0.00250 | $0.00450 | $0.09550 | 95.5% |
| DeepSeek V4.1 Flash (peak) | $0.00540 | $0.00740 | $0.09260 | 92.6% |
| DeepSeek V4.1 Flash (off-peak) | $0.00270 | $0.00470 | $0.09530 | 95.3% |
| MiniMax M3.1 Flash | $0.00270 | $0.00470 | $0.09530 | 95.3% |
| GPT-OSS 120B | $0.00270 | $0.00470 | $0.09530 | 95.3% |
| Gemma 4 31B | $0.00220 | $0.00420 | $0.09580 | 95.8% |
| Nemotron 3 Nano 30B | $0.00108 | $0.00308 | $0.09692 | 96.9% |

Even the most expensive currently priced model stays above **92%** before
payment processing on this workload. That is a reason the $0.10 credit can carry
a flat operation price; it is not a reason to skip the token envelopes.

**Payment processing note.** At an illustrative standard US card rate of 2.9% +
$0.30, a $5 pack nets $4.555 (91.1% of gross before AI cost), while a $100 pack
nets $96.80 (96.8%). Use the actual Stripe fees and mix before approving final
margin. This table deliberately does not hide that cost inside the model cost.

## 5. Bundle budgets — proposed

A budget is required before a multi-call feature starts. The database must stop
the next reservation when the next call would exceed the approved maximum.

| Bundle | Current AI path | Proposed maximum | How it stops |
| --- | --- | ---: | --- |
| Workflow draft | One `workflow_draft` call per drafted step | User-selected `max_credits`, hard ceiling 10 | Before each step, refuse if the next 1 credit would exceed the cap |
| Build repair | One `app_repair` call per attempt, 2 credits | 3 attempts, 6 credits | Refuse a fourth attempt; show spent/remaining |
| Swarm / agent team | No AI call path today (`budget_calls: 0`) | 0 credits today; a future AI task must declare a cap | No reservation means no spend; adding AI requires a new budgeted path |
| Multi-perspective review | One `review` call per perspective | User-selected 1–3 perspectives, 3 credits maximum | Stop before a perspective that would exceed the cap |

A bundle budget is separate from the wallet balance. A person can have enough
credits and still be stopped by the lower bundle maximum. Unused reservations are
released; unused budget is not spent.

## 6. Internal accounting — proposed

The retail unit remains one credit ($0.10), but internal agent/build/swarm calls
must not each round up to a whole credit.

**Proposed unit:** `1 credit = 1,000,000 microcredits (µcr)`, so `1 µcr =
$0.0000001`. A call can reserve or settle a fractional amount such as `0.125
credits (125,000 µcr)`. Customer-facing estimates can show `0.13 credits
($0.013)` with the exact µcr value retained internally.

This requires a ledger migration. The current ledger stores whole integer
credits. Fixed operation prices and budgets are implemented, but microcredit
accounting is not. Do not claim it is implemented until that migration and its
tests exist.

For variable-token operations, reserve the quoted ceiling in µcr, make the call
with a bounded output, settle the approved charge, and release the unused
reservation. Never make a second call to “use up” a reservation.

## 7. Approval checklist

The card is approved for implementation, but it is not live until every gate is
cleared:

- [x] Owner approves the 1-credit single-call prices and the 2-credit
      `app_repair` price.
- [x] Owner approves the $0.002 single-call and $0.004 repair compute/
      infrastructure planning reserves.
- [x] Owner approves the bundle caps, including the 6-credit build ceiling and
      the user-selectable 10-credit workflow limit.
- [x] Estimate display and maximum-budget enforcement are implemented and tested.
- [x] Purchase, duplicate webhook, reservation, settlement, release, refund,
      insufficient-balance, 2-credit repair and workflow-budget tests pass.
- [ ] Token envelopes are replaced with observed p50/p95 from `ai_requests`.
- [ ] Every selectable model id is verified with a live Ollama call, or unpriced/
      invalid models are disabled before activation.
- [ ] Production `public.ai_prices` is populated only after the remaining gates,
      with the six model rows below.
- [ ] The microcredit ledger migration is implemented and tested.
- [ ] `0034` and `0035` are applied to production after separate approval.
- [ ] Live billing and deployment are separately approved.

## 8. `ai_prices` values for later

These are the provider-cost rows to apply **after approval**, in the table's
millionths-of-a-dollar-per-1K-token units:

| Model | Input micros / 1K | Output micros / 1K |
| --- | ---: | ---: |
| `glm-5.3-flash` | 150 | 500 |
| `deepseek-v4.1-flash` | 300 | 1,200 |
| `minimax-m3.1-flash` | 150 | 600 |
| `gpt-oss:120b-cloud` | 150 | 600 |
| `gemma4:31b-cloud` | 140 | 400 |
| `nemotron-3-nano:30b-cloud` | 60 | 240 |

DeepSeek off-peak rows can be added later only if the dashboard can represent
time-of-day pricing; a single `ai_prices` row is the conservative peak figure.

## 9. What this implementation does not do

- It does not write `ai_prices`, activate a live rate, enable live billing, or
  deploy.
- It does not apply `0034` or `0035` to production.
- It does not prove the token envelopes or infrastructure reserve; those need
  production data.
- It does not implement the microcredit ledger. The wallet still stores whole
  integer credits.
