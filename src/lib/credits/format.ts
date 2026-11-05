/**
 * Credit wording and formatting. Pure functions only, so they can be tested
 * without a database or a browser.
 */

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
  return LEDGER_REASON_LABELS[reason as LedgerReason] ?? "Credit change";
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

/** Wording for a refused AI request. There is no free allowance to name. */
export function creditLimitMessage(code?: string): string {
  switch (code) {
    case "needs-credits":
      return "You're out of credits. Add credits to run AI work; your goals, tasks, saved work, account settings and billing history still work.";
    default:
      return "";
  }
}
