import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPurchaseReceipt,
  formatReceiptAmount,
  sendPurchaseReceipt,
} from "../src/lib/credits/receipt";
import { paymentDetailsFromEvent } from "../src/lib/credits/stripe";

const saved = {
  key: process.env.RESEND_API_KEY,
  from: process.env.RESEND_FROM,
  origin: process.env.APP_ORIGIN,
  base: process.env.RESEND_API_BASE,
  contact: process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function receiptInput(overrides: Partial<Parameters<typeof sendPurchaseReceipt>[0]> = {}) {
  return {
    email: "buyer@example.test",
    paymentId: "payment-1",
    credits: 50,
    amountCents: 500,
    currency: "usd",
    receiptUrl: "https://pay.example/receipt",
    ...overrides,
  };
}

beforeEach(() => {
  restore("RESEND_API_KEY", "re_test_key");
  restore("RESEND_FROM", undefined);
  restore("APP_ORIGIN", "https://app.example");
  restore("RESEND_API_BASE", undefined);
  restore("NEXT_PUBLIC_LEGAL_CONTACT_EMAIL", undefined);
});

afterEach(() => {
  restore("RESEND_API_KEY", saved.key);
  restore("RESEND_FROM", saved.from);
  restore("APP_ORIGIN", saved.origin);
  restore("RESEND_API_BASE", saved.base);
  restore("NEXT_PUBLIC_LEGAL_CONTACT_EMAIL", saved.contact);
  vi.unstubAllGlobals();
});

describe("purchase receipt", () => {
  it("reads the buyer and amount from a checkout event", () => {
    const details = paymentDetailsFromEvent({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          amount_total: 500,
          currency: "usd",
          customer_details: { email: "buyer@example.test" },
        },
      },
    });

    expect(details).toEqual({
      customerEmail: "buyer@example.test",
      amountTotal: 500,
      currency: "usd",
    });
  });

  it("falls back to customer_email and reads a charge amount", () => {
    const details = paymentDetailsFromEvent({
      id: "evt_2",
      type: "charge.refunded",
      data: { object: { id: "ch_1", amount: 500, currency: "usd", customer_email: "c@example.test" } },
    });

    expect(details.customerEmail).toBe("c@example.test");
    expect(details.amountTotal).toBe(500);
  });

  it("names the credits, the amount and the refund policy", () => {
    const built = buildPurchaseReceipt(receiptInput());

    expect(built.subject).toContain("50 credits");
    expect(built.text).toContain("Paid: $5.00");
    expect(built.text).toContain("https://pay.example/receipt");
    expect(built.text).toContain("https://app.example/refunds");
    expect(built.html).toContain("50");
  });

  it("never invites a reply to the no-reply sender", () => {
    const built = buildPurchaseReceipt(receiptInput());

    expect(built.text).not.toMatch(/reply to this email/i);
    expect(built.html).not.toMatch(/reply to this email/i);
    expect(built.text).toContain("support form on the Plans page");
  });

  it("names the published support inbox instead of asking for a reply", () => {
    process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL = "help@example.test";

    const built = buildPurchaseReceipt(receiptInput());

    expect(built.text).toContain("help@example.test");
    expect(built.text).not.toMatch(/reply to this email/i);
  });

  it("formats money without throwing on an unknown currency", () => {
    expect(formatReceiptAmount(2500, "usd")).toBe("$25.00");
    expect(formatReceiptAmount(null, "usd")).toBeNull();
    expect(formatReceiptAmount(100, "zzz")).toContain("1.00");
  });

  it("skips an address it cannot use, without calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendPurchaseReceipt(receiptInput({ email: null }));

    expect(result).toEqual({ sent: false, reason: "no-address" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips when no sending key is configured", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendPurchaseReceipt(receiptInput());

    expect(result).toEqual({ sent: false, reason: "no-key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends once with a stable idempotency key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendPurchaseReceipt(receiptInput());

    expect(result).toEqual({ sent: true, id: "email_1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("receipt-payment-1");
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: ["buyer@example.test"],
      subject: expect.stringContaining("50 credits"),
    });
  });

  it("reports a provider rejection without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    const result = await sendPurchaseReceipt(receiptInput());

    expect(result).toEqual({ sent: false, reason: "status-500" });
  });
});
