/**
 * Credit wording and formatting. Pure functions only, so they can be tested
 * without a database or a browser.
 */

/** One credit buys one AI request after the free daily allowance is gone. */
export const CREDITS_PER_REQUEST = 1;

export const REFUND_POLICY = [
  "Refunds are full and only for credits you have not used.",
  "Ask within 30 days of the purchase and include the receipt reference.",
  "Once a refund is recorded, the unused credits are removed from the balance.",
  "Credits already spent on AI requests are not refundable.",
].join(" ");

export const ACCOUNT_DELETION_POLICY = [
  "Deleting your account removes any unused credits, and they are not",
  "refunded automatically.",
].join(" ");

export function formatCredits(count: number): string {
  const rounded = Math.trunc(count);
  return `${rounded} ${Math.abs(rounded) === 1 ? "credit" : "credits"}`;
}

export function formatSignedCredits(delta: number): string {
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${formatCredits(Math.abs(delta))}`;
}

/** Cents to a plain dollar string. USD only, by design. */
export function formatUsd(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const whole = Math.trunc(safe / 100);
  const part = Math.abs(safe % 100);
  return `$${whole.toLocaleString("en-US")}.${String(part).padStart(2, "0")}`;
}

export type LedgerReason =
  | "purchase"
  | "ai_charge"
  | "ai_release"
  | "refund"
  | "adjustment"
  | "forfeit";

export const LEDGER_REASON_LABELS: Record<LedgerReason, string> = {
  purchase: "Purchase",
  ai_charge: "AI request",
  ai_release: "Returned",
  refund: "Refund",
  adjustment: "Adjustment",
  forfeit: "Unused at deletion",
};

export function ledgerReasonLabel(reason: string): string {
  return (
    LEDGER_REASON_LABELS[reason as LedgerReason] ?? "Credit change"
  );
}

export type PaymentStatus = "pending" | "paid" | "refunded" | "failed" | "canceled";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Waiting for the provider",
  paid: "Paid",
  refunded: "Refunded",
  failed: "Failed",
  canceled: "Canceled",
};

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status as PaymentStatus] ?? "Unknown";
}

/**
 * Wording for a refused AI request. `needs-credits` is the only new outcome
 * Phase 10 adds to the free allowance; everything else is unchanged.
 */
export function creditLimitMessage(code?: string, limit?: number): string {
  const allowance = typeof limit === "number" && limit > 0 ? limit : null;

  switch (code) {
    case "needs-credits":
      return allowance
        ? `You've used today's ${allowance} free AI requests and have no credits. Add credits, or keep going by hand — goals, tasks and saved work all still work.`
        : "You've used today's free AI requests and have no credits. Add credits, or keep going by hand.";
    default:
      return "";
  }
}

/** Short note under an AI control once credits exist. */
export function creditNote(balance: number, freeRemaining: number): string | null {
  if (balance > 0) return `${formatCredits(balance)} available.`;
  if (freeRemaining === 0) return "No free AI requests or credits left today.";
  return null;
}
