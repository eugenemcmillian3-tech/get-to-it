/**
 * The seven paid offers. These are product entitlements, never AI credits.
 *
 * Prices and grants are also stored in `billing_offers`; this module is the
 * shared vocabulary used by tests and UI copy. The database remains the source
 * of truth for what is charged and what is granted.
 */

export type BillingGrant =
  | "team_seats"
  | "premium_templates"
  | "priority_support"
  | "white_label"
  | "onboarding"
  | "automation_plus"
  | "build_release";

export type BillingOfferDefinition = {
  slug: string;
  label: string;
  description: string;
  priceCents: number;
  quantityLabel: string;
  minQuantity: number;
  maxQuantity: number;
  seatBased: boolean;
  grants: BillingGrant[];
  durationDays: number | null;
  sortOrder: number;
};

export const BILLING_OFFERS: BillingOfferDefinition[] = [
  {
    slug: "team_seats",
    label: "Team seats",
    description:
      "Add seats to a workspace for 30 days. The owner counts as one seat. Buy the total number of people you need, including the owner. Does not include AI credits.",
    priceCents: 1900,
    quantityLabel: "total seats",
    minQuantity: 2,
    maxQuantity: 50,
    seatBased: true,
    grants: ["team_seats"],
    durationDays: 30,
    sortOrder: 1,
  },
  {
    slug: "pro",
    label: "Pro bundle",
    description:
      "A 30-day bundle of premium templates, priority support and the white-label entitlement. Does not include AI credits or team seats.",
    priceCents: 4900,
    quantityLabel: "pass",
    minQuantity: 1,
    maxQuantity: 1,
    seatBased: false,
    grants: ["premium_templates", "priority_support", "white_label", "onboarding"],
    durationDays: 30,
    sortOrder: 2,
  },
  {
    slug: "automation_plus",
    label: "Automation add-on",
    description:
      "Raise the daily external-tool limit for 30 days: 500 calls and 100 writes per project per day instead of 100 and 25. Every action still needs its own approval.",
    priceCents: 1900,
    quantityLabel: "pass",
    minQuantity: 1,
    maxQuantity: 1,
    seatBased: false,
    grants: ["automation_plus"],
    durationDays: 30,
    sortOrder: 3,
  },
  {
    slug: "build_release",
    label: "Build & release pack",
    description:
      "Unlock production deployment for 90 days. Preview deployment, provider connections, checks, migration review and explicit approval still apply.",
    priceCents: 7900,
    quantityLabel: "pass",
    minQuantity: 1,
    maxQuantity: 1,
    seatBased: false,
    grants: ["build_release"],
    durationDays: 90,
    sortOrder: 4,
  },
  {
    slug: "premium_templates",
    label: "Premium templates",
    description:
      "Unlock the premium template collection for this account. One payment, no renewal. Does not include AI credits.",
    priceCents: 2900,
    quantityLabel: "collection",
    minQuantity: 1,
    maxQuantity: 1,
    seatBased: false,
    grants: ["premium_templates"],
    durationDays: null,
    sortOrder: 5,
  },
  {
    slug: "white_label",
    label: "White-label & custom domain",
    description:
      "Unlock custom-domain attachment for your generated apps and a white-label entitlement for this account. You still add the DNS records at your registrar; the app attaches the domain to the connected Vercel project.",
    priceCents: 9900,
    quantityLabel: "entitlement",
    minQuantity: 1,
    maxQuantity: 1,
    seatBased: false,
    grants: ["white_label"],
    durationDays: null,
    sortOrder: 6,
  },
  {
    slug: "priority_support",
    label: "Priority support & onboarding",
    description:
      "A 30-day priority support queue and the self-serve onboarding checklist. Messages are recorded here; GET TO IT does not promise a human response time. Does not include AI credits.",
    priceCents: 9900,
    quantityLabel: "pass",
    minQuantity: 1,
    maxQuantity: 1,
    seatBased: false,
    grants: ["priority_support", "onboarding"],
    durationDays: 30,
    sortOrder: 7,
  },
];

export function billingOffer(slug: string): BillingOfferDefinition | null {
  return BILLING_OFFERS.find((offer) => offer.slug === slug) ?? null;
}

export function offerPriceLabel(priceCents: number, quantity = 1): string {
  const cents = priceCents * quantity;
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export function offerDurationLabel(durationDays: number | null): string {
  if (durationDays === null) return "One-time, no renewal";
  return `${durationDays}-day pass, no auto-renew`;
}

export const BILLING_NOT_CREDITS =
  "These offers do not add AI credits or an AI allowance. AI work is still paid for separately from your credit balance.";
