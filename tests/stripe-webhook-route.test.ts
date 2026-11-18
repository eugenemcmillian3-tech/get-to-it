import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Stripe webhook route, exercised as a real signed request.
 *
 * The database is stubbed at the PostgREST boundary: `supabase.rpc` is the only
 * thing the route does with it, so recording which calls it makes — and with
 * which arguments — is exactly what these tests need to prove. Stripe is never
 * called here; the cancellation helper is covered by `stripe-cancel.test.ts`.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

const state = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  results: {} as Record<string, RpcResult>,
  alerts: [] as Array<Record<string, unknown>>,
  alertFailure: null as Error | null,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      return state.results[name] ?? { data: { ok: true }, error: null };
    },
  }),
}));

vi.mock("@/lib/billing/refund-alert", () => ({
  publishUnmatchedRefundAlert: async (refund: Record<string, unknown>) => {
    if (state.alertFailure) throw state.alertFailure;
    state.alerts.push(refund);
    return "created";
  },
}));

import { POST } from "@/app/api/stripe/webhook/route";

const SECRET = "whsec_route_test_secret";
const TOKEN = "credit-rpc-token-000000000000000000";
const NOW = Math.floor(Date.now() / 1000);

function signed(
  event: Record<string, unknown>,
  options: { secret?: string; timestamp?: number; signature?: string } = {},
) {
  const payload = JSON.stringify(event);
  const timestamp = options.timestamp ?? NOW;
  const digest =
    options.signature ??
    createHmac("sha256", options.secret ?? SECRET)
      .update(`${timestamp}.${payload}`)
      .digest("hex");

  return new Request("https://get-to-it.test/api/stripe/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${digest}`,
    },
    body: payload,
  });
}

function invoicePaid(object: Record<string, unknown> = {}) {
  return {
    id: "evt_invoice_paid",
    type: "invoice.paid",
    created: NOW,
    data: {
      object: {
        id: "in_1",
        subscription: "sub_1",
        customer: "cus_1",
        subscription_details: { metadata: { purchase_id: "0b6f1f3e-0000-4000-8000-000000000000" } },
        lines: {
          data: [
            {
              price: { id: "price_1" },
              quantity: 1,
              period: { start: NOW, end: NOW + 30 * 24 * 60 * 60 },
            },
          ],
        },
        ...object,
      },
    },
  };
}

function refundedCharge(object: Record<string, unknown> = {}) {
  return {
    id: "evt_refund_1",
    type: "charge.refunded",
    created: NOW,
    data: {
      object: {
        id: "ch_1",
        payment_intent: "pi_orphan",
        amount: 4900,
        currency: "usd",
        refunded: true,
        ...object,
      },
    },
  };
}

beforeEach(() => {
  state.calls.length = 0;
  state.alerts.length = 0;
  state.results = {};
  state.alertFailure = null;

  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("CREDIT_RPC_TOKEN", TOKEN);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-placeholder");
  // No key: the refund-cancel path is not what these tests are about.
  vi.stubEnv("STRIPE_SECRET_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("invoice.paid over the webhook route", () => {
  it("records the invoice payment intent so a refund can find the subscription", async () => {
    const response = await POST(signed(invoicePaid({ payment_intent: "pi_invoice_1" })));
    expect(response.status).toBe(200);

    expect(state.calls.map((call) => call.name)).toEqual([
      "billing_handle_subscription_event",
      "billing_record_invoice_payment",
    ]);

    const subscriptionCall = state.calls[0].args;
    expect(subscriptionCall).toMatchObject({
      p_token: TOKEN,
      p_event_id: "evt_invoice_paid",
      p_type: "invoice.paid",
      p_subscription_id: "sub_1",
    });
    expect(subscriptionCall.p_event_created).toBe(new Date(NOW * 1000).toISOString());

    expect(state.calls[1].args).toEqual({
      p_token: TOKEN,
      p_subscription_id: "sub_1",
      p_provider_payment_id: "pi_invoice_1",
    });
  });

  it("reads the payment intent from the newer payments[] shape", async () => {
    const response = await POST(
      signed(
        invoicePaid({
          payments: { data: [{ payment: { payment_intent: "pi_invoice_new" } }] },
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(state.calls[1]).toMatchObject({
      name: "billing_record_invoice_payment",
      args: { p_provider_payment_id: "pi_invoice_new" },
    });
  });

  it("returns 500 when the invoice payment cannot be recorded", async () => {
    state.results.billing_record_invoice_payment = {
      data: null,
      error: { message: "connection reset by peer" },
    };

    const response = await POST(signed(invoicePaid({ payment_intent: "pi_invoice_1" })));
    const body = (await response.json()) as { ok?: boolean; error?: string };

    // 500 so Stripe retries: both statements are idempotent, and a refund of
    // this invoice has to be able to find the subscription afterwards.
    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("could not be recorded");
    expect(state.calls.map((call) => call.name)).toContain("billing_record_invoice_payment");
  });

  it("does not record a payment intent for other subscription events", async () => {
    const response = await POST(
      signed({
        id: "evt_subscription_updated",
        type: "customer.subscription.updated",
        created: NOW,
        data: {
          object: {
            id: "sub_1",
            customer: "cus_1",
            status: "active",
            payment_intent: "pi_not_an_invoice",
            items: { data: [{ price: { id: "price_1" }, quantity: 1 }] },
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(state.calls.map((call) => call.name)).toEqual(["billing_handle_subscription_event"]);
  });

  it("records nothing when the invoice carries no payment intent", async () => {
    const response = await POST(signed(invoicePaid()));

    expect(response.status).toBe(200);
    expect(state.calls.map((call) => call.name)).toEqual(["billing_handle_subscription_event"]);
  });

  it("rejects an unsigned body before touching the database", async () => {
    const response = await POST(
      signed(invoicePaid({ payment_intent: "pi_invoice_1" }), { signature: "0".repeat(64) }),
    );

    expect(response.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
});

describe("unmatched charge.refunded over the webhook route", () => {
  const unknownPayment = {
    data: { ok: true, ignored: true, reason: "unknown-payment" },
    error: null,
  };

  it("raises an alert instead of acknowledging it silently", async () => {
    state.results.credit_handle_event = unknownPayment;
    state.results.billing_handle_event = unknownPayment;

    const response = await POST(signed(refundedCharge()));
    const body = (await response.json()) as { ok?: boolean; ignored?: string; alerted?: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, ignored: "unmatched-refund", alerted: "created" });
    expect(state.alerts).toEqual([
      {
        eventId: "evt_refund_1",
        paymentId: "pi_orphan",
        amountCents: 4900,
        currency: "usd",
      },
    ]);
    // Nothing here knows what to cancel, so no lookup is attempted.
    expect(state.calls.map((call) => call.name)).not.toContain(
      "billing_subscription_for_payment",
    );
  });

  it("returns 500 when the alert cannot be raised, so Stripe retries", async () => {
    state.results.credit_handle_event = unknownPayment;
    state.results.billing_handle_event = unknownPayment;
    state.alertFailure = new Error("GitHub request failed with status 403.");

    const response = await POST(signed(refundedCharge()));
    const body = (await response.json()) as { ok?: boolean; error?: string };

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("raised for a person");
    expect(state.alerts).toHaveLength(0);
  });

  it("stays quiet when the credit handler did recognise the payment", async () => {
    // A refunded credit pack: the billing handler disclaims it, the credit
    // handler owns it. That is normal, not an unmatched refund.
    state.results.credit_handle_event = {
      data: { ok: true, refunded: true, payment_id: "payment_1" },
      error: null,
    };
    state.results.billing_handle_event = unknownPayment;

    const response = await POST(signed(refundedCharge()));

    expect(response.status).toBe(200);
    expect(state.alerts).toHaveLength(0);
  });
});
