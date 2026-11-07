# Paid offers

GET TO IT has seven paid product offers. They are separate from AI credits and
never add an AI allowance. A person still buys credits for AI work.

| Offer | Price | Access | What it unlocks |
| --- | ---: | --- | --- |
| Team seats | $19 per seat / 30 days | 30-day pass | The owner is seat one. Buy the total number of people, including the owner. Invitations are refused above the purchased total. |
| Pro bundle | $49 / 30 days | 30-day pass | Premium templates, priority support queue, white-label and the onboarding checklist. No seats, no credits. |
| Automation add-on | $19 / 30 days | 30-day pass | 500 external-tool calls and 100 writes per project per day instead of 100 and 25. Every action is still approved individually. |
| Build & release pack | $79 / 90 days | 90-day pass | Production deployment. Preview deployment, provider connections, checks, migration review and explicit approval still apply. |
| Premium templates | $29 | Lifetime | The two premium static templates. No AI request is used to copy a template. |
| White-label & custom domain | $99 | Lifetime | Attach a domain to a generated app connected to Vercel. The owner still adds DNS records at the registrar. |
| Priority support & onboarding | $99 / 30 days | 30-day pass | Requests are stored in a priority queue and the onboarding checklist is shown. No human response time is promised. |

## How payment works

1. The form sends only an offer slug and bounded quantity.
2. `create_billing_purchase` reads the price and grants from `billing_offers` in
   the database. The browser cannot choose a price or an entitlement.
3. Stripe Checkout runs in test mode unless live payments are deliberately
   enabled. Checkout is one-time; nothing renews.
4. The signed webhook records the event once and creates one
   `billing_entitlements` row. The success page is not evidence of payment.
5. Every feature checks the entitlement in the database, including expiry.

## Boundaries that remain honest

- DNS is controlled by the customer's registrar. The app can attach the domain
  to Vercel; it cannot add the customer's DNS records.
- Priority support is an automatic queue and record. It is not a promise that a
  person is paged or will reply within a stated time.
- Production deployment is gated, but the existing check, migration and
  approval rules are unchanged.
- Refunds revoke the entitlement. Already-created data is not deleted.
