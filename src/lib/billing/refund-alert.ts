import {
  alertClaimLabel,
  getGithubAlertConfig,
  publishGithubAlert,
} from "@/lib/github-alerts";

/**
 * A `charge.refunded` that matches neither a credit payment nor a billing
 * purchase means money went back and nothing here noticed: no credits were
 * taken back, no entitlement was revoked, no subscription was stopped. Stripe
 * will not send anything else about it, and retrying cannot turn it into a match,
 * so it has to reach a person.
 *
 * One issue per payment id, so a redelivery or a second refund of the same charge
 * reuses the open alert instead of opening another. The issue carries ids and an
 * amount only — no email address, name or card detail.
 */

export type UnmatchedRefund = {
  eventId: string;
  paymentId: string | null;
  amountCents: number | null;
  currency: string | null;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** GitHub caps a label at 50 characters: 14 for the prefix plus 32 hex. */
const LABEL_PREFIX = "stripe-refund-";
const LABEL_COLOR = "b60205";
const LABEL_DESCRIPTION = "Stripe refund alert claim";

function safeId(value: string | null): string | null {
  return value && SAFE_ID.test(value) ? value : null;
}

export function unmatchedRefundSubject(paymentId: string | null): string {
  return safeId(paymentId) ?? "unknown payment";
}

export function unmatchedRefundTitle(refund: UnmatchedRefund): string {
  return `Stripe refund could not be matched: ${unmatchedRefundSubject(refund.paymentId)}`;
}

export function unmatchedRefundBody(refund: UnmatchedRefund): string {
  const amount =
    refund.amountCents === null ? "unknown" : `${(refund.amountCents / 100).toFixed(2)}`;
  const currency = refund.currency ? ` ${refund.currency.toUpperCase()}` : "";
  const eventId = safeId(refund.eventId) ?? "unknown event";

  return [
    "A Stripe `charge.refunded` matched neither a credit payment nor a billing purchase.",
    "",
    `- Payment intent: \`${unmatchedRefundSubject(refund.paymentId)}\``,
    `- Refunded amount: ${amount}${currency}`,
    `- Event: \`${eventId}\``,
    "",
    "Money has gone back, and nothing here revoked an entitlement or stopped a subscription.",
    "Open the charge in Stripe, then take the access back by hand and cancel any",
    "subscription attached to it. Check that the webhook endpoint is subscribed to",
    "the events this payment came from.",
    "",
    "This alert intentionally carries ids only: no customer address, name or card detail.",
  ].join("\n");
}

/**
 * Returns "unconfigured" rather than throwing when the alert channel has no
 * token, so a deployment without GitHub alerting still records the refund and
 * logs the miss instead of failing every delivery forever.
 */
export async function publishUnmatchedRefundAlert(
  refund: UnmatchedRefund,
): Promise<"created" | "existing" | "unconfigured"> {
  const config = getGithubAlertConfig();
  if (!config) return "unconfigured";

  return publishGithubAlert(config, {
    title: unmatchedRefundTitle(refund),
    body: unmatchedRefundBody(refund),
    label: alertClaimLabel(LABEL_PREFIX, unmatchedRefundSubject(refund.paymentId), 32),
    labelColor: LABEL_COLOR,
    labelDescription: LABEL_DESCRIPTION,
  });
}
