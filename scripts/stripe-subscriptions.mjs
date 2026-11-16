#!/usr/bin/env node
/**
 * Create the recurring Stripe catalogue for the five existing time-limited
 * offers. Prices use 30-day and 90-day recurring intervals, matching the
 * durations already shown in the app.
 *
 * The command is a dry run unless --apply is passed. A live key is refused
 * unless STRIPE_ALLOW_LIVE=true is also set, so test mode cannot silently be
 * mistaken for live mode.
 *
 * Usage:
 *   npm run stripe:subscriptions
 *   npm run stripe:subscriptions -- --apply
 */

const token = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
const apply = process.argv.includes("--apply");
const live = token.startsWith("sk_live_");

const plans = [
  {
    slug: "team_seats",
    name: "GET TO IT — Team seats",
    description:
      "Add seats to a workspace. The owner is seat one. Billed every 30 days. Does not include AI credits.",
    amountCents: 1900,
    interval: "day",
    intervalCount: 30,
    lookupKey: "get_to_it_team_seats_30d",
    env: "STRIPE_PRICE_ID_TEAM_SEATS",
  },
  {
    slug: "pro",
    name: "GET TO IT — Pro bundle",
    description:
      "Premium templates, priority support, white-label and onboarding. Billed every 30 days. Does not include AI credits or team seats.",
    amountCents: 4900,
    interval: "day",
    intervalCount: 30,
    lookupKey: "get_to_it_pro_30d",
    env: "STRIPE_PRICE_ID_PRO",
  },
  {
    slug: "automation_plus",
    name: "GET TO IT — Automation add-on",
    description:
      "Higher daily external-tool limits. Billed every 30 days. Every action still needs its own approval. Does not include AI credits.",
    amountCents: 1900,
    interval: "day",
    intervalCount: 30,
    lookupKey: "get_to_it_automation_plus_30d",
    env: "STRIPE_PRICE_ID_AUTOMATION_PLUS",
  },
  {
    slug: "build_release",
    name: "GET TO IT — Build & release",
    description:
      "Production deployment access, billed every 90 days. Checks, migration review and explicit approval still apply.",
    amountCents: 7900,
    interval: "day",
    intervalCount: 90,
    lookupKey: "get_to_it_build_release_90d",
    env: "STRIPE_PRICE_ID_BUILD_RELEASE",
  },
  {
    slug: "priority_support",
    name: "GET TO IT — Priority support & onboarding",
    description:
      "Priority support queue and onboarding checklist. Billed every 30 days. No human response time is promised. Does not include AI credits.",
    amountCents: 9900,
    interval: "day",
    intervalCount: 30,
    lookupKey: "get_to_it_priority_support_30d",
    env: "STRIPE_PRICE_ID_PRIORITY_SUPPORT",
  },
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function stripe(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      "Stripe-Version": "2024-06-20",
    },
    body: body ? body.toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const detail = payload ? JSON.stringify(payload).slice(0, 500) : text.slice(0, 500);
    throw new Error(`Stripe ${path} returned ${response.status}: ${detail}`);
  }
  return payload;
}

async function listAll(path) {
  const items = [];
  let startingAfter = "";
  for (;;) {
    const params = new URLSearchParams({ limit: "100" });
    if (startingAfter) params.set("starting_after", startingAfter);
    const page = await stripe(`${path}?${params}`);
    const data = Array.isArray(page?.data) ? page.data : [];
    items.push(...data);
    if (!page?.has_more || data.length === 0) return items;
    startingAfter = data[data.length - 1].id;
  }
}

async function ensureProduct(plan, products) {
  const existing = products.find(
    (product) => product?.metadata?.get_to_it_offer_slug === plan.slug,
  );

  if (existing) {
    if (!apply) return existing;
    if (
      existing.name !== plan.name ||
      existing.description !== plan.description ||
      existing.active !== true
    ) {
      const body = new URLSearchParams({
        name: plan.name,
        description: plan.description,
        active: "true",
        "metadata[get_to_it_offer_slug]": plan.slug,
        "metadata[get_to_it_billing_mode]": "subscription",
      });
      return stripe(`/v1/products/${existing.id}`, { method: "POST", body });
    }
    return existing;
  }

  if (!apply) return null;
  const body = new URLSearchParams({
    name: plan.name,
    description: plan.description,
    "metadata[get_to_it_offer_slug]": plan.slug,
    "metadata[get_to_it_billing_mode]": "subscription",
  });
  return stripe("/v1/products", { method: "POST", body });
}

function priceMatches(price, plan) {
  return (
    price?.active === true &&
    price?.unit_amount === plan.amountCents &&
    price?.currency === "usd" &&
    price?.recurring?.interval === plan.interval &&
    price?.recurring?.interval_count === plan.intervalCount
  );
}

async function ensurePrice(plan, product) {
  const params = new URLSearchParams({ limit: "100", "lookup_keys[]": plan.lookupKey });
  const found = await stripe(`/v1/prices?${params}`);
  const existing = (found?.data ?? []).find((price) => price?.lookup_key === plan.lookupKey);

  if (existing && priceMatches(existing, plan)) return existing;
  if (!apply) return existing ?? null;

  const body = new URLSearchParams({
    product: product.id,
    currency: "usd",
    unit_amount: String(plan.amountCents),
    "recurring[interval]": plan.interval,
    "recurring[interval_count]": String(plan.intervalCount),
    lookup_key: plan.lookupKey,
    transfer_lookup_key: existing ? "true" : "false",
    nickname: plan.name,
    "metadata[get_to_it_offer_slug]": plan.slug,
    "metadata[get_to_it_billing_mode]": "subscription",
  });
  const created = await stripe("/v1/prices", { method: "POST", body });

  if (existing && existing.id !== created.id && apply) {
    await stripe(`/v1/prices/${existing.id}`, {
      method: "POST",
      body: new URLSearchParams({ active: "false" }),
    });
  }
  return created;
}

async function main() {
  if (!token) {
    fail("STRIPE_SECRET_KEY is not set.");
    return;
  }
  if (live && process.env.STRIPE_ALLOW_LIVE !== "true") {
    fail("Refusing a live key unless STRIPE_ALLOW_LIVE=true is also set.");
    return;
  }

  console.log(`Stripe mode: ${live ? "live" : "test"}`);
  console.log(apply ? "Applying subscription catalogue." : "Dry run; pass --apply to write.");

  const products = await listAll("/v1/products");
  const mappings = [];

  for (const plan of plans) {
    const product = await ensureProduct(plan, products);
    if (!product) {
      console.log(`would create product ${plan.slug}`);
      continue;
    }

    const price = await ensurePrice(plan, product);
    if (!price) {
      console.log(`would create price ${plan.slug}`);
      continue;
    }

    mappings.push({ plan, product, price });
    console.log(
      `${plan.slug}: product=${product.id} price=${price.id} ${plan.amountCents / 100} USD every ${plan.intervalCount} ${plan.interval}(s)`,
    );
  }

  if (mappings.length > 0) {
    console.log("\nEnvironment values:");
    for (const { plan, price } of mappings) {
      console.log(`${plan.env}=${price.id}`);
    }
  }

  if (!apply) {
    console.log("\nNo changes made.");
  }
}

main().catch((error) => fail(error.message));
