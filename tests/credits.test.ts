import { createHmac } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import {
  ACCOUNT_DELETION_POLICY,
  creditLimitMessage,
  formatCredits,
  formatSignedCredits,
  formatUsd,
  ledgerReasonLabel,
  paymentStatusLabel,
  REFUND_POLICY,
} from "@/lib/credits/format";
import {
  CREDIT_PACK_DEFINITIONS,
  CREDIT_VALUE_CENTS,
  CREDIT_VALUE_LABEL,
  creditNote,
  creditsToCents,
  formatCreditsWithUsd,
} from "@/lib/credits/pricing";
import {
  createCheckoutSession,
  factsFromEvent,
  getStripeKey,
  hasStripeKey,
  liveKeyConfigured,
  livePaymentsAllowed,
  parseSignatureHeader,
  parseStripeEvent,
  SIGNATURE_TOLERANCE_SECONDS,
  STRIPE_LIVE_KEY_MESSAGE,
  STRIPE_SETUP_MESSAGE,
  stripeConfigState,
  verifyStripeSignature,
} from "@/lib/credits/stripe";

const SECRET = "whsec_test_secret_value";

function sign(payload: string, timestamp: number, secret = SECRET): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

describe("stripe key handling", () => {
  const savedKey = process.env.STRIPE_SECRET_KEY;
  const savedAllowLive = process.env.STRIPE_ALLOW_LIVE;

  function setEnv(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  afterEach(() => {
    setEnv("STRIPE_SECRET_KEY", savedKey);
    setEnv("STRIPE_ALLOW_LIVE", savedAllowLive);
  });

  it("treats a blank key as missing", () => {
    process.env.STRIPE_SECRET_KEY = "   ";
    expect(getStripeKey()).toBeNull();
    expect(hasStripeKey()).toBe(false);
    expect(stripeConfigState()).toBe("missing");
  });

  it("accepts and trims a test key", () => {
    process.env.STRIPE_SECRET_KEY = "  sk_test_abc123  ";
    expect(getStripeKey()).toBe("sk_test_abc123");
    expect(liveKeyConfigured()).toBe(false);
    expect(stripeConfigState()).toBe("ready");
  });

  it("refuses a live key until live payments are deliberately allowed", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    delete process.env.STRIPE_ALLOW_LIVE;

    expect(liveKeyConfigured()).toBe(true);
    expect(livePaymentsAllowed()).toBe(false);
    expect(getStripeKey()).toBeNull();
    expect(hasStripeKey()).toBe(false);
    expect(stripeConfigState()).toBe("live-blocked");

    process.env.STRIPE_ALLOW_LIVE = "true";
    expect(getStripeKey()).toBe("sk_live_abc123");
    expect(stripeConfigState()).toBe("ready");
  });

  it("only the exact string true enables live payments", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    process.env.STRIPE_ALLOW_LIVE = "1";
    expect(livePaymentsAllowed()).toBe(false);
    expect(getStripeKey()).toBeNull();
  });

  it("explains a live key instead of contacting the provider", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    delete process.env.STRIPE_ALLOW_LIVE;

    const result = await createCheckoutSession({
      paymentId: "pay_1",
      userId: "user_1",
      email: null,
      packSlug: "starter",
      label: "Starter pack",
      amountCents: 500,
      currency: "usd",
      successUrl: "https://example.test/credits?checkout=done",
      cancelUrl: "https://example.test/credits?checkout=cancelled",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toBe(STRIPE_LIVE_KEY_MESSAGE);
  });

  it("explains a missing key without contacting the provider", async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const result = await createCheckoutSession({
      paymentId: "pay_1",
      userId: "user_1",
      email: "person@example.test",
      packSlug: "starter",
      label: "Starter pack",
      amountCents: 500,
      currency: "usd",
      successUrl: "https://example.test/credits?checkout=done",
      cancelUrl: "https://example.test/credits?checkout=cancelled",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toBe(STRIPE_SETUP_MESSAGE);
  });
});

describe("credit formatting", () => {
  it("uses the singular for exactly one credit", () => {
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(0)).toBe("0 credits");
    expect(formatCredits(20)).toBe("20 credits");
  });

  it("truncates fractional input rather than inventing credits", () => {
    expect(formatCredits(2.9)).toBe("2 credits");
  });

  it("signs ledger deltas with a real minus and plus", () => {
    expect(formatSignedCredits(5)).toBe("+5 credits");
    expect(formatSignedCredits(-1)).toBe("−1 credit");
  });

  it("formats cents as dollars", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(500)).toBe("$5.00");
    expect(formatUsd(1205)).toBe("$12.05");
    expect(formatUsd(123456)).toBe("$1,234.56");
  });

  it("falls back safely for a non-finite amount", () => {
    expect(formatUsd(Number.NaN)).toBe("$0.00");
  });

  it("labels every ledger reason and survives an unknown one", () => {
    expect(ledgerReasonLabel("purchase")).toBe("Purchase");
    expect(ledgerReasonLabel("ai_release")).toBe("Returned");
    expect(ledgerReasonLabel("something-else")).toBe("Credit change");
  });

  it("labels payment states, including an unknown one", () => {
    expect(paymentStatusLabel("pending")).toBe("Waiting for the provider");
    expect(paymentStatusLabel("refunded")).toBe("Refunded");
    expect(paymentStatusLabel("weird")).toBe("Unknown");
  });
});

describe("credit pricing", () => {
  it("sets the retail value of one credit to ten cents", () => {
    expect(CREDIT_VALUE_CENTS).toBe(10);
    expect(CREDIT_VALUE_LABEL).toBe("$0.10");
    expect(creditsToCents(50)).toBe(500);
    expect(formatCreditsWithUsd(50)).toBe("50 credits ($5.00)");
  });

  it("keeps all five packs at exactly ten cents per credit", () => {
    expect(CREDIT_PACK_DEFINITIONS).toHaveLength(5);
    for (const pack of CREDIT_PACK_DEFINITIONS) {
      expect(pack.amount_cents).toBe(pack.credits * CREDIT_VALUE_CENTS);
    }
    expect(CREDIT_PACK_DEFINITIONS.map((pack) => pack.credits)).toEqual([
      50, 100, 250, 500, 1000,
    ]);
  });
});

describe("credit copy", () => {
  it("does not invent a free allowance when credits run out", () => {
    const message = creditLimitMessage("needs-credits");
    expect(message).toContain("out of credits");
    expect(message).toContain("Add credits");
    expect(message).not.toContain("free");
  });

  it("still reads sensibly without a known allowance", () => {
    expect(creditLimitMessage("needs-credits")).toContain("credits");
  });

  it("says nothing for codes it does not own", () => {
    expect(creditLimitMessage("in-flight")).toBe("");
  });

  it("shows a balance note with its dollar value", () => {
    expect(creditNote(3)).toBe("3 credits available ($0.30).");
    expect(creditNote(0)).toContain("No credits available");
  });

  it("states that refunds only cover unused credits", () => {
    expect(REFUND_POLICY).toContain("have not used");
    expect(REFUND_POLICY).toContain("not refundable");
  });

  it("says unused credits are not refunded on deletion", () => {
    expect(ACCOUNT_DELETION_POLICY).toContain("not");
    expect(ACCOUNT_DELETION_POLICY).toContain("credits");
  });
});

describe("stripe signature header", () => {
  const digest = "a".repeat(64);

  it("reads a timestamp and one signature", () => {
    expect(parseSignatureHeader(`t=1700000000,v1=${digest}`)).toEqual({
      timestamp: 1700000000,
      signatures: [digest],
    });
  });

  it("keeps several signatures so a rotated secret still verifies", () => {
    const parsed = parseSignatureHeader(
      `t=1700000000,v1=${digest},v1=${"b".repeat(64)}`,
    );
    expect(parsed?.signatures).toHaveLength(2);
  });

  it("rejects a header without a timestamp or without a signature", () => {
    expect(parseSignatureHeader("")).toBeNull();
    expect(parseSignatureHeader(null)).toBeNull();
    expect(parseSignatureHeader(`v1=${digest}`)).toBeNull();
    expect(parseSignatureHeader("t=1700000000")).toBeNull();
  });

  it("rejects a non-numeric timestamp and non-hex signatures", () => {
    expect(parseSignatureHeader(`t=later,v1=${digest}`)).toBeNull();
    expect(parseSignatureHeader("t=1700000000,v1=nothex")).toBeNull();
  });
});

describe("stripe signature verification", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = 1_700_000_000;

  it("accepts a correctly signed, recent body", () => {
    expect(
      verifyStripeSignature({
        payload,
        header: sign(payload, now),
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it("accepts an older signature inside the tolerance window", () => {
    expect(
      verifyStripeSignature({
        payload,
        header: sign(payload, now - SIGNATURE_TOLERANCE_SECONDS + 1),
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it("rejects a replayed signature outside the tolerance window", () => {
    expect(
      verifyStripeSignature({
        payload,
        header: sign(payload, now - SIGNATURE_TOLERANCE_SECONDS - 1),
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("rejects a timestamp far in the future", () => {
    expect(
      verifyStripeSignature({
        payload,
        header: sign(payload, now + SIGNATURE_TOLERANCE_SECONDS + 60),
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("rejects a body that changed after signing", () => {
    const header = sign(payload, now);
    expect(
      verifyStripeSignature({
        payload: payload.replace("evt_1", "evt_2"),
        header,
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(
      verifyStripeSignature({
        payload,
        header: sign(payload, now, "whsec_other"),
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(
      verifyStripeSignature({ payload, header: null, secret: SECRET, nowSeconds: now }),
    ).toBe(false);
  });
});

describe("stripe event parsing", () => {
  it("keeps only the id, type and object", () => {
    const event = parseStripeEvent(
      JSON.stringify({
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: { id: "cs_1" } },
        extra: "ignored",
      }),
    );
    expect(event).toEqual({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1" } },
    });
  });

  it("rejects unreadable or incomplete bodies", () => {
    expect(parseStripeEvent("not json")).toBeNull();
    expect(parseStripeEvent(JSON.stringify({ type: "x", data: { object: {} } }))).toBeNull();
    expect(parseStripeEvent(JSON.stringify({ id: "evt", data: { object: {} } }))).toBeNull();
    expect(parseStripeEvent(JSON.stringify({ id: "evt", type: "x" }))).toBeNull();
    expect(parseStripeEvent(JSON.stringify({ id: "evt", type: "x", data: {} }))).toBeNull();
  });

  it("takes the session id from a checkout event", () => {
    const event = parseStripeEvent(
      JSON.stringify({
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: { id: "cs_test_1", payment_intent: "pi_1", receipt_url: null } },
      }),
    );
    expect(event).not.toBeNull();
    expect(factsFromEvent(event!)).toEqual({
      sessionId: "cs_test_1",
      providerPaymentId: "pi_1",
      receiptUrl: null,
    });
  });

  it("takes the payment id from a refund event", () => {
    const event = parseStripeEvent(
      JSON.stringify({
        id: "evt_2",
        type: "charge.refunded",
        data: { object: { id: "pi_2", receipt_url: "https://pay.example/receipt" } },
      }),
    );
    expect(factsFromEvent(event!)).toEqual({
      sessionId: null,
      providerPaymentId: "pi_2",
      receiptUrl: "https://pay.example/receipt",
    });
  });

  it("reads an expanded payment_intent object", () => {
    const event = parseStripeEvent(
      JSON.stringify({
        id: "evt_3",
        type: "checkout.session.completed",
        data: { object: { id: "cs_3", payment_intent: { id: "pi_3" } } },
      }),
    );
    expect(factsFromEvent(event!).providerPaymentId).toBe("pi_3");
  });
});
