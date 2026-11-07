/**
 * Server-only Stripe Checkout adapter for paid product offers.
 *
 * One-time Checkout only: no subscription is created, nothing renews, and no
 * price is read from the browser. An offer becomes active only after the signed
 * webhook records a completed checkout.
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
  successUrl: string;
  cancelUrl: string;
};

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
  body.set("mode", "payment");
  body.set("success_url", input.successUrl);
  body.set("cancel_url", input.cancelUrl);
  body.set("client_reference_id", input.purchaseId);
  body.set("metadata[purchase_id]", input.purchaseId);
  body.set("metadata[user_id]", input.userId);
  body.set("metadata[offer_slug]", input.offerSlug);
  body.set("payment_intent_data[metadata][purchase_id]", input.purchaseId);
  body.set("payment_intent_data[metadata][offer_slug]", input.offerSlug);
  if (input.email) body.set("customer_email", input.email);

  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", input.currency);
  body.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
  body.set(
    "line_items[0][price_data][product_data][name]",
    input.quantity > 1 ? `${input.label} × ${input.quantity}` : input.label,
  );

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
