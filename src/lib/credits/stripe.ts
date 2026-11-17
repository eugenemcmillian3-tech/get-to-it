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
import { CREDIT_PACK_DEFINITIONS } from "./pricing";

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
  /** Database pack credits; omitted callers cannot use a saved price. */
  credits?: number;
  amountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResult =
  | { ok: true; sessionId: string; url: string }
  | { ok: false; message: string };

/**
 * Returns the configured Stripe price for this pack only when the database
 * amount and credit count still match the five-pack definition. This prevents
 * an old database row from being paired with a newly sized Stripe price before
 * the catalogue migration is applied.
 */
export function packPriceId(
  input: Pick<CheckoutInput, "packSlug" | "credits" | "amountCents">,
): string | null {
  const pack = CREDIT_PACK_DEFINITIONS.find(
    (definition) => definition.slug === input.packSlug,
  );
  if (
    !pack ||
    pack.credits !== input.credits ||
    pack.amount_cents !== input.amountCents
  ) {
    return null;
  }

  const value = process.env[`STRIPE_PRICE_ID_${pack.slug.toUpperCase()}`]?.trim();
  return value && /^price_[A-Za-z0-9]+$/.test(value) ? value : null;
}

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

  const priceId = packPriceId(input);
  body.set("line_items[0][quantity]", "1");
  if (priceId) {
    body.set("line_items[0][price]", priceId);
  } else {
    body.set("line_items[0][price_data][currency]", input.currency);
    body.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
    body.set("line_items[0][price_data][product_data][name]", input.label);
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

export type SubscriptionFacts = {
  subscriptionId: string | null;
  customerId: string | null;
  status: string | null;
  priceId: string | null;
  quantity: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
  purchaseId: string | null;
};

function objectId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  const id = (value as { id?: unknown } | undefined)?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}

function metadataPurchaseId(value: unknown): string | null {
  const metadata = value as { purchase_id?: unknown } | undefined;
  return typeof metadata?.purchase_id === "string" && metadata.purchase_id.length > 0
    ? metadata.purchase_id
    : null;
}

/** Subscription and invoice fields used by the billing webhook. */
export function subscriptionFactsFromEvent(event: StripeEvent): SubscriptionFacts {
  const object = event.data.object;

  if (event.type.startsWith("customer.subscription.")) {
    const items = object.items as
      | {
          data?: Array<{
            price?: { id?: unknown };
            quantity?: unknown;
            current_period_start?: unknown;
            current_period_end?: unknown;
          }>;
        }
      | undefined;
    const item = items?.data?.[0];
    // Stripe keeps the original current_period_end when a subscription is
    // cancelled immediately, while ended_at marks when access actually stops.
    // Feed the database the real cutoff so it revokes instead of leaving the
    // entitlement active until the unused part of the period.
    const endedAt =
      event.type === "customer.subscription.deleted"
        ? timestamp(
            object.ended_at ??
              object.canceled_at ??
              Math.floor(Date.now() / 1000),
          )
        : null;
    return {
      subscriptionId: objectId(object.id),
      customerId: objectId(object.customer),
      status: typeof object.status === "string" ? object.status : null,
      priceId: objectId(item?.price?.id),
      quantity: typeof item?.quantity === "number" ? item.quantity : null,
      periodStart: timestamp(
        object.current_period_start ?? item?.current_period_start,
      ),
      periodEnd:
        endedAt ?? timestamp(object.current_period_end ?? item?.current_period_end),
      cancelAtPeriodEnd:
        typeof object.cancel_at_period_end === "boolean"
          ? object.cancel_at_period_end
          : null,
      purchaseId: metadataPurchaseId(object.metadata),
    };
  }

  const lines = object.lines as
    | {
        data?: Array<{
          price?: { id?: unknown };
          quantity?: unknown;
          period?: { start?: unknown; end?: unknown };
        }>;
      }
    | undefined;
  const line = lines?.data?.[0];
  const subscriptionDetails = object.subscription_details as
    | { metadata?: unknown }
    | undefined;

  return {
    subscriptionId: objectId(object.subscription),
    customerId: objectId(object.customer),
    status: event.type === "invoice.payment_failed" ? "past_due" : "active",
    priceId: objectId(line?.price?.id),
    quantity: typeof line?.quantity === "number" ? line.quantity : null,
    periodStart: timestamp(line?.period?.start ?? object.period_start),
    periodEnd: timestamp(line?.period?.end ?? object.period_end),
    cancelAtPeriodEnd: null,
    purchaseId:
      metadataPurchaseId(subscriptionDetails?.metadata) ??
      metadataPurchaseId(object.metadata),
  };
}

export type PaymentDetails = {
  customerEmail: string | null;
  amountTotal: number | null;
  currency: string | null;
};

/**
 * Buyer and amount, for the receipt email. Kept separate from `EventFacts` so the
 * ingestion contract stays exactly the fields the database needs.
 */
export function paymentDetailsFromEvent(event: StripeEvent): PaymentDetails {
  const object = event.data.object;

  const customer = object.customer_details as { email?: unknown } | undefined;
  const customerEmail =
    typeof customer?.email === "string" && customer.email.length > 0
      ? customer.email
      : typeof object.customer_email === "string" && object.customer_email.length > 0
        ? object.customer_email
        : null;

  const amountTotal =
    typeof object.amount_total === "number"
      ? object.amount_total
      : typeof object.amount === "number"
        ? object.amount
        : null;

  const currency =
    typeof object.currency === "string" && object.currency.length > 0
      ? object.currency
      : null;

  return { customerEmail, amountTotal, currency };
}
