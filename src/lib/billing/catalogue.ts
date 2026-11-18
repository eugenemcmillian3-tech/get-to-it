/**
 * The recurring Stripe catalogue, as the application expects it.
 *
 * These values mirror `PRICING.md` and the products created by
 * `npm run stripe:subscriptions -- --apply`. They exist here so a deployment can
 * check the price IDs it was given against what the app means to sell: Stripe
 * prices are mode-scoped and editable, so a stale or test-mode ID would
 * otherwise only surface as a failed checkout at the last step.
 */

export type RecurringOffer = {
  /** Matches `billing_offers.slug` and the `STRIPE_PRICE_ID_*` suffix. */
  slug: string;
  label: string;
  amountCents: number;
  /** Stripe recurring interval; all current offers bill in days. */
  interval: "day";
  intervalCount: number;
};

export const RECURRING_OFFERS: readonly RecurringOffer[] = [
  {
    slug: "team_seats",
    label: "Team seats",
    amountCents: 1900,
    interval: "day",
    intervalCount: 30,
  },
  {
    slug: "pro",
    label: "Pro bundle",
    amountCents: 4900,
    interval: "day",
    intervalCount: 30,
  },
  {
    slug: "automation_plus",
    label: "Automation add-on",
    amountCents: 1900,
    interval: "day",
    intervalCount: 30,
  },
  {
    slug: "build_release",
    label: "Build & release",
    amountCents: 7900,
    interval: "day",
    intervalCount: 90,
  },
  {
    slug: "priority_support",
    label: "Priority support & onboarding",
    amountCents: 9900,
    interval: "day",
    intervalCount: 30,
  },
];

/** The environment variable that carries one offer's Stripe price ID. */
export function offerPriceEnvKey(slug: string): string {
  return `STRIPE_PRICE_ID_${slug.toUpperCase()}`;
}

export type PriceFacts = {
  id: string;
  livemode: boolean;
  active: boolean;
  unitAmount: number | null;
  currency: string | null;
  recurring: { interval: string; intervalCount: number } | null;
};

export type PriceExpectation =
  | { kind: "recurring"; slug: string; amountCents: number; interval: string; intervalCount: number }
  | { kind: "one-time"; slug: string; amountCents: number };

export type PriceVerdict =
  | "ok"
  | "unconfigured"
  | "not-found"
  | "inactive"
  | "wrong-mode"
  | "wrong-amount"
  | "wrong-shape";

/**
 * Why a configured price would or would not work, in one word. `wrong-mode` is
 * the one that matters most: a test-mode price with a live key fails at the last
 * step of checkout, after the person has already chosen to pay.
 */
export function classifyPrice(
  price: PriceFacts | null,
  expectation: PriceExpectation,
  mode: "live" | "test",
): PriceVerdict {
  if (!price) return "not-found";
  if (price.livemode !== (mode === "live")) return "wrong-mode";
  if (!price.active) return "inactive";
  if (price.unitAmount !== expectation.amountCents) return "wrong-amount";
  if (price.currency !== "usd") return "wrong-amount";

  if (expectation.kind === "recurring") {
    if (
      !price.recurring ||
      price.recurring.interval !== expectation.interval ||
      price.recurring.intervalCount !== expectation.intervalCount
    ) {
      return "wrong-shape";
    }
    return "ok";
  }

  return price.recurring ? "wrong-shape" : "ok";
}
