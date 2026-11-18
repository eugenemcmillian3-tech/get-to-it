/**
 * Server-only Stripe Checkout adapter for paid product offers.
 *
 * Recurring offers use a server-side Stripe price ID; one-time offers use an
 * inline price. No amount or price is read from the browser. An offer becomes
 * active only after the signed webhook records a completed checkout.
 */

import {
  apiBase,
  getStripeKey,
  liveKeyConfigured,
  STRIPE_LIVE_KEY_MESSAGE,
  STRIPE_SETUP_MESSAGE,
} from "@/lib/credits/stripe";

export type BillingCheckoutInput = {
  purchaseId: string;
  userId: string;
  email: string | null;
  offerSlug: string;
  label: string;
  quantity: number;
  amountCents: number;
  currency: string;
  billingMode: "one_time" | "subscription";
  stripePriceId: string | null;
  successUrl: string;
  cancelUrl: string;
};

export function billingPriceId(offerSlug: string): string | null {
  const value = process.env[`STRIPE_PRICE_ID_${offerSlug.toUpperCase()}`]?.trim();
  return value?.startsWith("price_") ? value : null;
}

export type BillingCheckoutResult =
  | { ok: true; sessionId: string; url: string }
  | { ok: false; message: string };

export async function createBillingCheckoutSession(
  input: BillingCheckoutInput,
): Promise<BillingCheckoutResult> {
  const key = getStripeKey();
  if (!key) {
    return {
      ok: false,
      message: liveKeyConfigured() ? STRIPE_LIVE_KEY_MESSAGE : STRIPE_SETUP_MESSAGE,
    };
  }

  const body = new URLSearchParams();
  body.set("success_url", input.successUrl);
  body.set("cancel_url", input.cancelUrl);
  body.set("client_reference_id", input.purchaseId);
  body.set("metadata[purchase_id]", input.purchaseId);
  body.set("metadata[user_id]", input.userId);
  body.set("metadata[offer_slug]", input.offerSlug);
  if (input.email) body.set("customer_email", input.email);

  if (input.billingMode === "subscription") {
    if (!input.stripePriceId) {
      return {
        ok: false,
        message:
          "That subscription's Stripe price is not configured. Nothing was charged.",
      };
    }
    body.set("mode", "subscription");
    body.set("line_items[0][price]", input.stripePriceId);
    body.set("line_items[0][quantity]", String(input.quantity));
    body.set("subscription_data[metadata][purchase_id]", input.purchaseId);
    body.set("subscription_data[metadata][user_id]", input.userId);
    body.set("subscription_data[metadata][offer_slug]", input.offerSlug);
  } else {
    body.set("mode", "payment");
    body.set("payment_intent_data[metadata][purchase_id]", input.purchaseId);
    body.set("payment_intent_data[metadata][offer_slug]", input.offerSlug);
    body.set("line_items[0][quantity]", "1");
    body.set("line_items[0][price_data][currency]", input.currency);
    body.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
    body.set(
      "line_items[0][price_data][product_data][name]",
      input.quantity > 1 ? `${input.label} × ${input.quantity}` : input.label,
    );
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase()}/v1/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2024-06-20",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error(
      "Stripe billing checkout request failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return {
      ok: false,
      message: "We couldn't reach the payment provider. Nothing was charged. Try again.",
    };
  }

  if (!response.ok) {
    console.error("Stripe billing checkout returned", response.status);
    return {
      ok: false,
      message:
        response.status === 401
          ? "The payment provider rejected the configured key. Check STRIPE_SECRET_KEY and that it is a test key."
          : "The payment provider refused to start that checkout. Nothing was charged.",
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      message: "The payment provider sent a reply we couldn't read. Nothing was charged.",
    };
  }

  const record = payload as { id?: unknown; url?: unknown };
  if (typeof record.id !== "string" || typeof record.url !== "string") {
    return {
      ok: false,
      message: "The payment provider didn't return a checkout link. Nothing was charged.",
    };
  }

  return { ok: true, sessionId: record.id, url: record.url };
}

/**
 * Ends a subscription now. Used when a refund already revoked access: leaving
 * the Stripe subscription alive would keep charging for something the customer
 * has been refunded for, and a later paid invoice would buy the period back.
 * Cancelling twice is not an error — Stripe reports an unknown or already
 * canceled subscription, and both mean the outcome we wanted already holds.
 */
export async function cancelSubscriptionNow(
  subscriptionId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = getStripeKey();
  if (!key) {
    return {
      ok: false,
      message: liveKeyConfigured() ? STRIPE_LIVE_KEY_MESSAGE : STRIPE_SETUP_MESSAGE,
    };
  }

  let response: Response;
  try {
    response = await fetch(
      `${apiBase()}/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${key}`,
          "Stripe-Version": "2024-06-20",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    console.error(
      "Stripe immediate cancellation failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false, message: "We couldn't reach the payment provider. Nothing changed." };
  }

  if (response.ok || response.status === 404) {
    return { ok: true };
  }

  const body = await response.text().catch(() => "");
  if (/already been canceled|resource_missing/i.test(body)) {
    return { ok: true };
  }

  console.error("Stripe immediate cancellation returned", response.status);
  return {
    ok: false,
    message: "The payment provider refused to cancel that subscription. Nothing changed.",
  };
}

export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = getStripeKey();
  if (!key) {
    return {
      ok: false,
      message: liveKeyConfigured() ? STRIPE_LIVE_KEY_MESSAGE : STRIPE_SETUP_MESSAGE,
    };
  }

  let response: Response;
  try {
    response = await fetch(
      `${apiBase()}/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": "2024-06-20",
        },
        body: new URLSearchParams({ cancel_at_period_end: "true" }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    console.error(
      "Stripe subscription cancellation failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false, message: "We couldn't reach the payment provider. Nothing changed." };
  }

  if (!response.ok) {
    console.error("Stripe subscription cancellation returned", response.status);
    return {
      ok: false,
      message: "The payment provider refused to cancel that subscription. Nothing changed.",
    };
  }

  return { ok: true };
}
