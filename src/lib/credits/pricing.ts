/**
 * Credit pricing. Pure functions and constants only, so the browser, server
 * actions and tests use exactly the same numbers.
 *
 * A credit is retail value, not a token count. The final per-operation rate
 * card is deliberately not encoded here: it needs owner approval before it can
 * be activated.
 */

import { formatCredits, formatUsd } from "./format";

/** Retail value of one credit in US cents. */
export const CREDIT_VALUE_CENTS = 10;

/** Display form of the retail credit value. */
export const CREDIT_VALUE_LABEL = formatUsd(CREDIT_VALUE_CENTS);

/**
 * The current test-mode reservation. This is not the final model-specific
 * operation rate card, and it is not a promise that every operation costs one
 * credit.
 */
export const TEST_MODE_CREDITS_PER_REQUEST = 1;

export const TEST_MODE_REQUEST_COST_LABEL = `${formatCredits(
  TEST_MODE_CREDITS_PER_REQUEST,
)} (${formatUsd(TEST_MODE_CREDITS_PER_REQUEST * CREDIT_VALUE_CENTS)})`;

export type CreditPackDefinition = {
  slug: string;
  credits: number;
  amount_cents: number;
  label: string;
  sort_order: number;
};

/** The five packs in the pricing decision. The database remains the source. */
export const CREDIT_PACK_DEFINITIONS: CreditPackDefinition[] = [
  { slug: "starter", credits: 50, amount_cents: 500, label: "50 credits", sort_order: 1 },
  { slug: "steady", credits: 100, amount_cents: 1000, label: "100 credits", sort_order: 2 },
  { slug: "deep", credits: 250, amount_cents: 2500, label: "250 credits", sort_order: 3 },
  { slug: "builder", credits: 500, amount_cents: 5000, label: "500 credits", sort_order: 4 },
  { slug: "studio", credits: 1000, amount_cents: 10000, label: "1,000 credits", sort_order: 5 },
];

export function creditsToCents(credits: number): number {
  if (!Number.isFinite(credits)) return 0;
  return Math.trunc(credits) * CREDIT_VALUE_CENTS;
}

/** Example: `50 credits ($5.00)`. */
export function formatCreditsWithUsd(credits: number): string {
  return `${formatCredits(credits)} (${formatUsd(creditsToCents(credits))})`;
}

/** Short note under an AI control once credits exist. */
export function creditNote(balance: number): string | null {
  if (balance > 0) {
    return `${formatCredits(balance)} available (${formatUsd(
      creditsToCents(balance),
    )}).`;
  }

  return "No credits available. AI work needs credits; everything you've saved is still here.";
}
