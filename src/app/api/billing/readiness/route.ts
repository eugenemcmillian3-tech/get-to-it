import { NextResponse } from "next/server";
import {
  RECURRING_OFFERS,
  classifyPrice,
  offerPriceEnvKey,
  type PriceExpectation,
  type PriceFacts,
  type PriceVerdict,
} from "@/lib/billing/catalogue";
import { CREDIT_PACK_DEFINITIONS } from "@/lib/credits/pricing";
import {
  apiBase,
  getStripeKey,
  getWebhookSecret,
  livePaymentsAllowed,
} from "@/lib/credits/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe billing readiness.
 *
 * Buying anything needs two things that cannot be checked at build time: a key
 * for the mode the deployment intends to use, and price IDs that exist in that
 * same mode with the expected amount and interval. A mismatch only shows up as a
 * failed checkout after someone has decided to pay — and a live key paired with
 * test-mode prices is exactly the mistake `LIVE_BILLING.md` warns about.
 *
 * The response carries only counts, one-word verdicts and booleans. No price ID,
 * key, secret, customer or amount total is included, so it is safe to poll from
 * outside. It is a configuration check, not a health check: `/api/health`
 * remains the liveness signal, and this endpoint always answers 200 so a poller
 * can read the verdict.
 */

const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; body: ReadinessBody } | null = null;

type ReadinessBody = {
  ok: boolean;
  stripe: {
    mode: "live" | "test" | "unset" | "live-blocked";
    allow_live: boolean;
    webhook_secret: boolean;
  };
  prices: {
    configured: number;
    valid: number;
    unconfigured: number;
    problems: number;
    entries: Array<{ slug: string; kind: "pack" | "offer"; verdict: PriceVerdict }>;
  };
};

function priceFacts(payload: unknown): PriceFacts | null {
  if (payload === null || typeof payload !== "object") return null;
  const value = payload as {
    id?: unknown;
    livemode?: unknown;
    active?: unknown;
    unit_amount?: unknown;
    currency?: unknown;
    recurring?: { interval?: unknown; interval_count?: unknown } | null;
  };
  if (typeof value.id !== "string") return null;

  const recurring =
    value.recurring && typeof value.recurring.interval === "string"
      ? {
          interval: value.recurring.interval,
          intervalCount:
            typeof value.recurring.interval_count === "number"
              ? value.recurring.interval_count
              : 0,
        }
      : null;

  return {
    id: value.id,
    livemode: value.livemode === true,
    active: value.active === true,
    unitAmount: typeof value.unit_amount === "number" ? value.unit_amount : null,
    currency: typeof value.currency === "string" ? value.currency : null,
    recurring,
  };
}

/** One price, by id, through the same API base the checkout code uses. */
async function fetchPrice(key: string, priceId: string): Promise<PriceFacts | null> {
  try {
    const response = await fetch(`${apiBase()}/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2024-06-20" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return priceFacts(await response.json());
  } catch {
    // Treated as not found: the verdict then says the price does not work,
    // which is the safe direction for a readiness probe.
    return null;
  }
}

function configuredId(envKey: string): string | null {
  const value = process.env[envKey]?.trim();
  return value && /^price_[A-Za-z0-9]+$/.test(value) ? value : null;
}

async function readiness(): Promise<ReadinessBody> {
  const allowLive = livePaymentsAllowed();
  const key = getStripeKey();
  const webhookSecret = getWebhookSecret() !== null;

  if (!key) {
    const liveKey = process.env.STRIPE_SECRET_KEY?.trim()?.startsWith("sk_live_") ?? false;
    return {
      ok: false,
      stripe: {
        mode: liveKey ? "live-blocked" : process.env.STRIPE_SECRET_KEY?.trim() ? "test" : "unset",
        allow_live: allowLive,
        webhook_secret: webhookSecret,
      },
      prices: {
        configured: 0,
        valid: 0,
        unconfigured: 0,
        problems: 0,
        entries: [],
      },
    };
  }

  const mode: "live" | "test" = key.startsWith("sk_live_") ? "live" : "test";

  const targets: Array<{ slug: string; kind: "pack" | "offer"; envKey: string; expectation: PriceExpectation }> = [
    ...CREDIT_PACK_DEFINITIONS.map((pack) => ({
      slug: pack.slug,
      kind: "pack" as const,
      envKey: `STRIPE_PRICE_ID_${pack.slug.toUpperCase()}`,
      expectation: { kind: "one-time" as const, slug: pack.slug, amountCents: pack.amount_cents },
    })),
    ...RECURRING_OFFERS.map((offer) => ({
      slug: offer.slug,
      kind: "offer" as const,
      envKey: offerPriceEnvKey(offer.slug),
      expectation: {
        kind: "recurring" as const,
        slug: offer.slug,
        amountCents: offer.amountCents,
        interval: offer.interval,
        intervalCount: offer.intervalCount,
      },
    })),
  ];

  const entries = await Promise.all(
    targets.map(async (target) => {
      const priceId = configuredId(target.envKey);
      if (!priceId) {
        return { slug: target.slug, kind: target.kind, verdict: "unconfigured" as PriceVerdict };
      }
      const price = await fetchPrice(key, priceId);
      return {
        slug: target.slug,
        kind: target.kind,
        verdict: classifyPrice(price, target.expectation, mode),
      };
    }),
  );

  const configured = entries.filter((entry) => entry.verdict !== "unconfigured").length;
  const valid = entries.filter((entry) => entry.verdict === "ok").length;
  const unconfigured = entries.length - configured;
  const problems = configured - valid;

  return {
    ok: problems === 0 && unconfigured === 0 && webhookSecret,
    stripe: { mode, allow_live: allowLive, webhook_secret: webhookSecret },
    prices: { configured, valid, unconfigured, problems, entries },
  };
}

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    return NextResponse.json(cached.body, { headers: { "cache-control": "no-store" } });
  }

  let body: ReadinessBody;
  try {
    body = await readiness();
  } catch (error) {
    console.error(
      "Stripe readiness check failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { ok: false, error: "The billing configuration could not be read." },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  // Only a complete, usable catalogue is cached; an incomplete one is re-read on
  // the next request so a fixed deployment does not keep reporting the old
  // verdict for five minutes.
  if (body.ok) cached = { at: now, body };

  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
