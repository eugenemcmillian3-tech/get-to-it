#!/usr/bin/env node
/**
 * Checks one live refund rehearsal (LIVE_BILLING.md §6 step 3).
 *
 * After a real subscription purchase is refunded in Stripe, this answers one
 * question from the rows the webhook wrote: did the refund revoke access and stop
 * the subscription? It also asks Stripe whether the subscription is really
 * canceled, when a key is available locally.
 *
 * Read-only: it never writes, cancels or refunds anything.
 *
 * Usage:
 *   npm run check:refund
 *   npm run check:refund -- --json
 *   npm run check:refund -- --payment pi_...   # pin one refunded payment
 *
 * Connection: DATABASE_URL or POSTGRES_URL (a direct Postgres URL), otherwise
 * SUPABASE_MANAGEMENT_API with SUPABASE_PROJECT_REF / SCHEMA_DRIFT_PROJECT_REF.
 * Stripe: STRIPE_SECRET_KEY, read from .env.local by the npm script.
 */

import pg from "pg";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const paymentFlag = args.indexOf("--payment");
const wantedPayment = paymentFlag === -1 ? null : args[paymentFlag + 1];

const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_URL_NON_POOLING;
const apiToken = process.env.SUPABASE_MANAGEMENT_API ?? "";
const projectRef = process.env.SUPABASE_PROJECT_REF ?? process.env.SCHEMA_DRIFT_PROJECT_REF ?? "";

async function query(sql) {
  if (connectionString) {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      return (await client.query(sql)).rows;
    } finally {
      await client.end();
    }
  }

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(`Management API ${response.status}: ${body.slice(0, 200)}`);
  const rows = JSON.parse(body);
  return Array.isArray(rows) ? rows : [];
}

const escape = (value) => value.replace(/'/g, "''");

async function stripeSubscriptionStatus(subscriptionId) {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return { checked: false, reason: "STRIPE_SECRET_KEY not set" };

  const base = (process.env.STRIPE_API_BASE ?? "https://api.stripe.com").replace(/\/+$/, "");
  let response;
  try {
    response = await fetch(`${base}/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2024-06-20" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { checked: false, reason: `Stripe unreachable: ${error.message}` };
  }

  // A subscription that no longer exists cannot raise another invoice.
  if (response.status === 404) return { checked: true, canceled: true, status: "missing" };
  if (!response.ok) return { checked: false, reason: `Stripe returned ${response.status}` };

  const body = await response.json().catch(() => ({}));
  return {
    checked: true,
    canceled: body?.status === "canceled",
    status: typeof body?.status === "string" ? body.status : "unknown",
    cancelAtPeriodEnd: body?.cancel_at_period_end === true,
  };
}

if (!connectionString && !(apiToken && projectRef)) {
  console.error(
    "No database access: set DATABASE_URL/POSTGRES_URL, or SUPABASE_MANAGEMENT_API with SUPABASE_PROJECT_REF.",
  );
  process.exit(2);
}

const filter = wantedPayment ? ` and (p.provider_payment_id = '${escape(wantedPayment)}' or s.provider_payment_id = '${escape(wantedPayment)}')` : "";
const refunded = await query(`
  select p.offer_slug, p.status as purchase_status, p.amount_cents, p.refunded_at,
         s.provider_subscription_id, s.status as subscription_status, s.canceled_at,
         s.provider_payment_id as invoice_payment_id,
         e.status as entitlement_status, e.expires_at
    from public.billing_purchases p
    left join public.billing_subscriptions s on s.purchase_id = p.id
    left join public.billing_entitlements e on e.purchase_id = p.id
   where p.refunded_at is not null${filter}
   order by p.refunded_at desc
   limit 1
`);

const results = [];
const add = (name, ok, detail) => results.push({ name, ok, detail });

const row = refunded[0];
if (!row) {
  add(
    "refunded purchase recorded",
    false,
    wantedPayment
      ? `no refunded billing purchase for ${wantedPayment}`
      : "no refunded billing purchase yet — refund the charge in Stripe, then rerun",
  );
} else {
  add(
    "refunded purchase recorded",
    row.purchase_status === "refunded",
    `${row.offer_slug} ${(row.amount_cents / 100).toFixed(2)} refunded ${row.refunded_at}` +
      (row.purchase_status === "refunded" ? "" : ` (status ${row.purchase_status})`),
  );

  if (!row.provider_subscription_id) {
    add("subscription recorded", false, "no subscription row: was this a one-time offer?");
  } else {
    add("subscription recorded", true, row.provider_subscription_id);
    const canceled = row.subscription_status === "canceled" || row.canceled_at !== null;
    add(
      "subscription canceled in our records",
      canceled,
      canceled
        ? `status ${row.subscription_status}, canceled_at ${row.canceled_at}`
        : `status ${row.subscription_status} — the deletion webhook may still be in flight; rerun in a minute, and cancel in Stripe by hand if it stays active`,
    );
    add(
      "entitlement revoked",
      row.entitlement_status === "revoked",
      `entitlement ${row.entitlement_status}, expires ${row.expires_at}`,
    );
    add(
      "invoice payment intent recorded",
      Boolean(row.invoice_payment_id),
      row.invoice_payment_id ?? "none — the refund had nothing to match on",
    );

    const stripe = await stripeSubscriptionStatus(row.provider_subscription_id);
    add(
      "Stripe reports the subscription canceled",
      stripe.checked ? Boolean(stripe.canceled) : true,
      stripe.checked
        ? stripe.canceled
          ? `status ${stripe.status}`
          : `status ${stripe.status}${stripe.cancelAtPeriodEnd ? ", cancel_at_period_end" : ""} — it can still invoice`
        : `skipped (${stripe.reason})`,
    );
    if (!stripe.checked) results.at(-1).skipped = true;
  }
}

const events = await query(`
  select status, detail, received_at
    from public.billing_events
   where type = 'charge.refunded'
   order by received_at desc
   limit 1
`);
const event = events[0];
add(
  "charge.refunded recorded as processed",
  Boolean(event) && event.status === "processed",
  event ? `${event.status}${event.detail ? ` (${event.detail})` : ""} at ${event.received_at}` : "no charge.refunded event",
);

const failed = results.filter((entry) => !entry.ok);
const skipped = results.filter((entry) => entry.skipped);

if (asJson) {
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
} else {
  console.log(
    row
      ? `Refund rehearsal: ${row.offer_slug} ${(row.amount_cents / 100).toFixed(2)}, refunded ${row.refunded_at}`
      : "Refund rehearsal: nothing to check yet",
  );
  for (const entry of results) {
    const label = entry.skipped ? "SKIP" : entry.ok ? "PASS" : "FAIL";
    console.log(`  ${label}  ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`);
  }
  console.log(
    failed.length === 0
      ? `All checks passed${skipped.length > 0 ? ` (${skipped.length} skipped)` : ""}.`
      : `${failed.length} check(s) failed.`,
  );
}

process.exit(failed.length === 0 ? 0 : 1);
