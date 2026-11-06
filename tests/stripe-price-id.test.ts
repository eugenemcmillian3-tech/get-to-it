import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckoutSession } from "@/lib/credits/stripe";

const savedKey = process.env.STRIPE_SECRET_KEY;
const savedStarterPrice = process.env.STRIPE_PRICE_ID_STARTER;

function checkoutInput(overrides: { credits?: number; label?: string } = {}) {
  return {
    paymentId: "pay_1",
    userId: "user_1",
    email: null,
    packSlug: "starter",
    label: overrides.label ?? "50 credits",
    credits: overrides.credits ?? 50,
    amountCents: 500,
    currency: "usd",
    successUrl: "https://example.test/credits?checkout=done",
    cancelUrl: "https://example.test/credits?checkout=cancelled",
  };
}

function stubCheckout() {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body as URLSearchParams;
    expect(body.get("line_items[0][quantity]")).toBe("1");
    return new Response(
      JSON.stringify({ id: "cs_test", url: "https://checkout.test" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = savedKey;
  if (savedStarterPrice === undefined) delete process.env.STRIPE_PRICE_ID_STARTER;
  else process.env.STRIPE_PRICE_ID_STARTER = savedStarterPrice;
  vi.unstubAllGlobals();
});

describe("Stripe price-ID checkout", () => {
  it("uses the configured price when the database pack matches the catalogue", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    process.env.STRIPE_PRICE_ID_STARTER = "price_teststarter";
    const fetchMock = stubCheckout();

    const result = await createCheckoutSession(checkoutInput());

    expect(result).toEqual({
      ok: true,
      sessionId: "cs_test",
      url: "https://checkout.test",
    });
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("line_items[0][price]")).toBe("price_teststarter");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBeNull();
  });

  it("falls back to inline pricing while the old database packs are active", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    process.env.STRIPE_PRICE_ID_STARTER = "price_teststarter";
    const fetchMock = stubCheckout();

    const result = await createCheckoutSession(
      checkoutInput({ credits: 20, label: "Starter pack" }),
    );

    expect(result.ok).toBe(true);
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("line_items[0][price]")).toBeNull();
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("500");
    expect(body.get("line_items[0][price_data][product_data][name]")).toBe(
      "Starter pack",
    );
  });
});
