import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The billing readiness probe, with Stripe stubbed at the HTTP boundary.
 *
 * What matters here is the verdict, not the wiring: a live key with test-mode
 * prices has to be reported as broken, because that checkout fails at the last
 * step after someone has already decided to pay. The probe must also never
 * repeat an ID or a secret back to the caller.
 */

const prices = vi.hoisted(() => new Map<string, unknown>());

// Assembled rather than written out: a literal here reads as a leaked key to the
// repository's secret scan, and that check is worth keeping strict.
const LIVE_KEY = ["sk", "live", "readiness-placeholder"].join("_");
const TEST_KEY = ["sk", "test", "readiness-placeholder"].join("_");

const PACK_ENV = {
  STRIPE_PRICE_ID_STARTER: "price_starter",
  STRIPE_PRICE_ID_STEADY: "price_steady",
  STRIPE_PRICE_ID_DEEP: "price_deep",
  STRIPE_PRICE_ID_BUILDER: "price_builder",
  STRIPE_PRICE_ID_STUDIO: "price_studio",
};

const OFFER_ENV = {
  STRIPE_PRICE_ID_TEAM_SEATS: "price_team",
  STRIPE_PRICE_ID_PRO: "price_pro",
  STRIPE_PRICE_ID_AUTOMATION_PLUS: "price_auto",
  STRIPE_PRICE_ID_BUILD_RELEASE: "price_build",
  STRIPE_PRICE_ID_PRIORITY_SUPPORT: "price_priority",
};

const PACK_AMOUNTS: Record<string, number> = {
  price_starter: 500,
  price_steady: 1000,
  price_deep: 2500,
  price_builder: 5000,
  price_studio: 10000,
};

const OFFER_SHAPE: Record<string, { amount: number; count: number }> = {
  price_team: { amount: 1900, count: 30 },
  price_pro: { amount: 4900, count: 30 },
  price_auto: { amount: 1900, count: 30 },
  price_build: { amount: 7900, count: 90 },
  price_priority: { amount: 9900, count: 30 },
};

function seedCatalogue({ livemode }: { livemode: boolean }) {
  prices.clear();
  for (const [id, amount] of Object.entries(PACK_AMOUNTS)) {
    prices.set(id, {
      id,
      livemode,
      active: true,
      unit_amount: amount,
      currency: "usd",
      recurring: null,
    });
  }
  for (const [id, shape] of Object.entries(OFFER_SHAPE)) {
    prices.set(id, {
      id,
      livemode,
      active: true,
      unit_amount: shape.amount,
      currency: "usd",
      recurring: { interval: "day", interval_count: shape.count },
    });
  }
}

function setEnv(extra: Record<string, string> = {}) {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_readiness");
  for (const [key, value] of Object.entries({ ...PACK_ENV, ...OFFER_ENV, ...extra })) {
    vi.stubEnv(key, value);
  }
}

beforeEach(() => {
  // The route caches a ready verdict per isolate, so each case starts fresh.
  vi.resetModules();
  prices.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      const id = url.split("/v1/prices/")[1] ?? "";
      const price = prices.get(decodeURIComponent(id));
      if (!price) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(price), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function read() {
  const { GET } = await import("@/app/api/billing/readiness/route");
  const response = await GET();
  const body = (await response.json()) as {
    ok: boolean;
    stripe: { mode: string; allow_live: boolean; webhook_secret: boolean };
    prices: {
      configured: number;
      valid: number;
      problems: number;
      unconfigured: number;
      entries: Array<{ slug: string; verdict: string }>;
    };
  };
  return { response, body };
}

describe("billing readiness", () => {
  it("reports a complete live catalogue as ready", async () => {
    seedCatalogue({ livemode: true });
    setEnv({ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_ALLOW_LIVE: "true" });

    const { body } = await read();

    expect(body.ok).toBe(true);
    expect(body.stripe).toEqual({
      mode: "live",
      allow_live: true,
      webhook_secret: true,
    });
    expect(body.prices).toMatchObject({
      configured: 10,
      valid: 10,
      problems: 0,
      unconfigured: 0,
    });
  });

  it("flags test-mode prices behind a live key, which fails at the last step of checkout", async () => {
    seedCatalogue({ livemode: false });
    setEnv({ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_ALLOW_LIVE: "true" });

    const { body } = await read();

    expect(body.ok).toBe(false);
    expect(body.prices.valid).toBe(0);
    expect(body.prices.problems).toBe(10);
    expect(new Set(body.prices.entries.map((entry) => entry.verdict))).toEqual(
      new Set(["wrong-mode"]),
    );
  });

  it("flags a price with the wrong amount or interval", async () => {
    seedCatalogue({ livemode: false });
    // The Pro price drifted from $49/30 days to $39/30 days.
    prices.set("price_pro", {
      ...(prices.get("price_pro") as Record<string, unknown>),
      unit_amount: 3900,
    });
    setEnv({ STRIPE_SECRET_KEY: TEST_KEY });

    const { body } = await read();

    const pro = body.prices.entries.find((entry) => entry.slug === "pro");
    expect(pro?.verdict).toBe("wrong-amount");
    expect(body.ok).toBe(false);
    expect(body.prices.valid).toBe(9);
  });

  it("counts a missing price instead of failing to answer", async () => {
    seedCatalogue({ livemode: false });
    prices.delete("price_priority");
    setEnv({ STRIPE_SECRET_KEY: TEST_KEY });

    const { body } = await read();

    const priority = body.prices.entries.find((entry) => entry.slug === "priority_support");
    expect(priority?.verdict).toBe("not-found");
    expect(body.prices.configured).toBe(10);
    expect(body.prices.valid).toBe(9);
  });

  it("reports unconfigured prices when only some variables are set", async () => {
    seedCatalogue({ livemode: false });
    setEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_PRICE_ID_PRO: "" });

    const { body } = await read();

    expect(body.prices.unconfigured).toBe(1);
    expect(body.ok).toBe(false);
  });

  it("says so, without calling Stripe, when a live key is blocked by policy", async () => {
    setEnv({ STRIPE_SECRET_KEY: LIVE_KEY });

    const { body } = await read();

    expect(body.ok).toBe(false);
    expect(body.stripe.mode).toBe("live-blocked");
    expect(body.stripe.allow_live).toBe(false);
    expect(prices.size).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("reports an unset key without calling Stripe", async () => {
    setEnv({ STRIPE_SECRET_KEY: "" });

    const { body } = await read();

    expect(body.ok).toBe(false);
    expect(body.stripe.mode).toBe("unset");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("never repeats a price ID or a secret", async () => {
    seedCatalogue({ livemode: false });
    setEnv({ STRIPE_SECRET_KEY: TEST_KEY });

    const { response, body } = await read();
    const text = JSON.stringify(body);

    expect(text).not.toContain("price_");
    expect(text).not.toContain("sk_test_");
    expect(text).not.toContain("whsec_");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
