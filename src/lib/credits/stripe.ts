/**
 * Server-only Stripe adapter.
 *
 * Deliberately dependency-free: hosted Checkout is one form-encoded POST, and
 * webhook signatures are HMAC-SHA256, so the `stripe` package would add weight
 * without adding safety here. The key is read at call time so a deployment
 * without keys still builds and runs.
 *
 * `STRIPE_API_BASE` exists so tests can point the same code at a local stub.
 * It must never be set in production.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_API_DEFAULT = "https://api.stripe.com";

/** Stripe's own tolerance for replayed webhook timestamps. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const LIVE_KEY_PREFIX = "sk_live_";

/**
 * A live key is valid Stripe config but not permission to take money. Taking
 * real payments is an explicit decision, so a live key is ignored unless
 * `STRIPE_ALLOW_LIVE=true` is also set. Test keys need no such flag.
 */
export function liveKeyConfigured(): boolean {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return Boolean(key && key.startsWith(LIVE_KEY_PREFIX));
}

export function livePaymentsAllowed(): boolean {
  return process.env.STRIPE_ALLOW_LIVE === "true";
}

export function getStripeKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (key.startsWith(LIVE_KEY_PREFIX) && !livePaymentsAllowed()) return null;
  return key;
}

export function hasStripeKey(): boolean {
  return getStripeKey() !== null;
}

/** Why checkout is unavailable, as a state a page can render. */
export function stripeConfigState(): "ready" | "missing" | "live-blocked" {
  if (hasStripeKey()) return "ready";
  return liveKeyConfigured() ? "live-blocked" : "missing";
}

export function getWebhookSecret(): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return null;
  const trimmed = secret.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function apiBase(): string {
  const base = process.env.STRIPE_API_BASE;
  if (!base) return STRIPE_API_DEFAULT;
  return base.replace(/\/+$/, "");
}

export const STRIPE_SETUP_MESSAGE =
  "Stripe isn't connected yet. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in test mode, restart the server, then try again. No card is charged until then.";

export const STRIPE_LIVE_KEY_MESSAGE =
  "A live Stripe key is configured, but this build refuses live payments. Use an sk_test_ key, or set STRIPE_ALLOW_LIVE=true when you deliberately intend to charge real money. Nothing was charged.";

export type CheckoutInput = {
  paymentId: string;
  userId: string;
  email: string | null;
  packSlug: string;
  label: string;
  amountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResult =
  | { ok: true; sessionId: string; url: string }
  | { ok: false; message: string };

/**
 * Creates a one-time Checkout Session. `client_reference_id` and the metadata
 * carry our own payment id, which is how the webhook finds the row again.
 */
export async function createCheckoutSession(
  input: CheckoutInput,
): Promise<CheckoutResult> {
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
  body.set("client_reference_id", input.paymentId);
  body.set("metadata[payment_id]", input.paymentId);
  body.set("metadata[user_id]", input.userId);
  body.set("metadata[pack_slug]", input.packSlug);
  body.set("payment_intent_data[metadata][payment_id]", input.paymentId);
  if (input.email) body.set("customer_email", input.email);

  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", input.currency);
  body.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
  body.set("line_items[0][price_data][product_data][name]", input.label);

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
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error("Stripe checkout request failed:", reason);
    return {
      ok: false,
      message: "We couldn't reach the payment provider. Nothing was charged. Try again.",
    };
  }

  if (!response.ok) {
    console.error("Stripe checkout returned", response.status);
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

export type ParsedSignature = {
  timestamp: number;
  signatures: string[];
};

/** Parses `t=...,v1=...,v1=...` without trusting any of it yet. */
export function parseSignatureHeader(header: string | null): ParsedSignature | null {
  if (!header) return null;

  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const [rawKey, rawValue] = part.split("=");
    const key = rawKey?.trim();
    const value = rawValue?.trim();
    if (!key || !value) continue;

    if (key === "t") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) return null;
      timestamp = parsed;
      continue;
    }

    if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) {
      signatures.push(value.toLowerCase());
    }
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Verifies a Stripe webhook: the signed payload is `timestamp.body`, and the
 * header must be recent. A missing or malformed header is a rejection.
 */
export function verifyStripeSignature(input: {
  payload: string;
  header: string | null;
  secret: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  const parsed = parseSignatureHeader(input.header);
  if (!parsed) return false;

  if (Math.abs(now - parsed.timestamp) > tolerance) return false;

  const expected = createHmac("sha256", input.secret)
    .update(`${parsed.timestamp}.${input.payload}`)
    .digest("hex");

  return parsed.signatures.some((candidate) => {
    if (candidate.length !== expected.length) return false;
    try {
      return timingSafeEqual(
        Buffer.from(candidate, "hex"),
        Buffer.from(expected, "hex"),
      );
    } catch {
      return false;
    }
  });
}

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

/** Structural validation only; the signature is what makes the body trusted. */
export function parseStripeEvent(raw: string): StripeEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const record = payload as {
    id?: unknown;
    type?: unknown;
    data?: { object?: unknown };
  };

  if (typeof record.id !== "string" || record.id.length === 0) return null;
  if (typeof record.type !== "string" || record.type.length === 0) return null;
  if (
    typeof record.data !== "object" ||
    record.data === null ||
    typeof record.data.object !== "object" ||
    record.data.object === null
  ) {
    return null;
  }

  return {
    id: record.id,
    type: record.type,
    data: { object: record.data.object as Record<string, unknown> },
  };
}

/** The fields our ingestion needs, and nothing else. */
export type EventFacts = {
  sessionId: string | null;
  providerPaymentId: string | null;
  receiptUrl: string | null;
};

export function factsFromEvent(event: StripeEvent): EventFacts {
  const object = event.data.object;
  const read = (key: string): string | null => {
    const value = object[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };

  const isSession = event.type.startsWith("checkout.session.");
  const paymentIntent =
    typeof object.payment_intent === "string"
      ? object.payment_intent
      : typeof (object.payment_intent as { id?: unknown } | undefined)?.id === "string"
        ? String((object.payment_intent as { id: string }).id)
        : null;

  return {
    sessionId: isSession ? read("id") : null,
    providerPaymentId: paymentIntent ?? (isSession ? null : read("id")),
    receiptUrl: read("receipt_url"),
  };
}
