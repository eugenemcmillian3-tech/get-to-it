import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnerAdjustForm } from "@/components/owner-adjust-form";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { formatCredits, formatUsd } from "@/lib/credits/format";
import { getOwnerMetrics, isOwner } from "@/lib/data/credits";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { cardClass, chipClass, focusRing } from "@/lib/styles";
import type { OwnerMetrics } from "@/lib/types";

export const metadata: Metadata = { title: "Owner dashboard — GET TO IT" };
export const dynamic = "force-dynamic";

function count(metrics: OwnerMetrics, key: string): number {
  const value = metrics[key];
  return typeof value === "number" ? value : 0;
}

function text(metrics: OwnerMetrics, key: string): Record<string, number> {
  const value = metrics[key];
  return typeof value === "object" && value !== null
    ? (value as Record<string, number>)
    : {};
}

export default async function OwnerPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();

  // Server-side check before anything is read. A non-owner gets the same 404 as
  // a page that does not exist, so the dashboard's existence is not revealed.
  if (!(await isOwner(session))) notFound();

  const [identity, metrics] = await Promise.all([
    getIdentity(session),
    getOwnerMetrics(session),
  ]);

  if (!metrics) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-sm text-danger">
          The metrics query failed. Check the server logs.
        </p>
      </main>
    );
  }

  const byKind = text(metrics, "ai_by_kind_30d");
  const costUsd = formatUsd(Math.round(count(metrics, "cost_micros_known_30d") / 10_000));
  const unpriced = count(metrics, "requests_without_price_30d");

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href="/dashboard"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to your goals
        </Link>

        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
          Owner dashboard
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          Aggregate numbers only. No goal titles, task names, notes or saved work
          are read here.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className={chipClass}>
            {metrics.test_mode === true ? "Payments: test mode" : "Payments: live"}
          </span>
          <span className={chipClass}>{count(metrics, "users_total")} accounts</span>
        </div>

        <section aria-labelledby="people-heading" className="mt-8">
          <h2 id="people-heading" className="text-lg font-bold">
            People and activity
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Metric label="Accounts" value={count(metrics, "users_total")} />
            <Metric label="Used AI in the last 7 days" value={count(metrics, "users_with_ai_7d")} />
            <Metric label="Goals" value={count(metrics, "goals_total")} />
            <Metric label="Goals not archived" value={count(metrics, "goals_active")} />
            <Metric label="Tasks" value={count(metrics, "tasks_total")} />
            <Metric label="Tasks completed" value={count(metrics, "tasks_completed")} />
          </dl>
        </section>

        <section aria-labelledby="ai-heading" className="mt-8">
          <h2 id="ai-heading" className="text-lg font-bold">
            AI requests
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Metric label="Requests, last 7 days" value={count(metrics, "ai_requests_7d")} />
            <Metric label="Succeeded, last 7 days" value={count(metrics, "ai_succeeded_7d")} />
            <Metric label="Failed, last 7 days" value={count(metrics, "ai_failed_7d")} />
            <Metric label="Tokens in, last 30 days" value={count(metrics, "tokens_in_30d")} />
            <Metric label="Tokens out, last 30 days" value={count(metrics, "tokens_out_30d")} />
            <Metric label="Models with a price" value={count(metrics, "models_priced")} />
          </dl>

          <div className={`${cardClass} mt-3`}>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted">
              By kind, last 30 days
            </p>
            {Object.keys(byKind).length === 0 ? (
              <p className="mt-1 text-sm text-muted">No requests yet.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {Object.entries(byKind).map(([kind, total]) => (
                  <li key={kind} className="flex justify-between gap-3">
                    <span>{kind}</span>
                    <span className="font-semibold">{total}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={`${cardClass} mt-3`}>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted">
              Provider cost, last 30 days
            </p>
            <p className="mt-1 text-sm leading-relaxed">
              <strong>{costUsd}</strong> known from prices you entered.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {unpriced > 0
                ? `${unpriced} request(s) have no price for their model, so their cost is unknown, not zero. Token counts come from the provider; prices do not.`
                : "Every model used in this window has a price row."}
            </p>
          </div>
        </section>

        <section aria-labelledby="credits-heading" className="mt-8">
          <h2 id="credits-heading" className="text-lg font-bold">
            Credits
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Metric label="Credits sold" value={count(metrics, "credits_sold_total")} />
            <Metric label="Credits spent on AI" value={count(metrics, "credits_spent_total")} />
            <Metric label="Credit rows still held" value={count(metrics, "credits_held_total")} />
            <Metric label="Adjustments, last 30 days" value={count(metrics, "adjustments_30d")} />
          </dl>
          <p className="mt-2 text-xs text-muted">
            {formatCredits(count(metrics, "credits_held_total"))} of purchased or
            granted credits are still on accounts.
          </p>
        </section>

        <section aria-labelledby="payments-heading" className="mt-8">
          <h2 id="payments-heading" className="text-lg font-bold">
            Payments
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Metric label="Paid" value={count(metrics, "payments_paid")} />
            <Metric label="Refunded" value={count(metrics, "payments_refunded")} />
            <Metric label="Waiting for the provider" value={count(metrics, "payments_pending")} />
            <Metric label="Gross, cents" value={count(metrics, "revenue_cents")} />
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Revenue here is what the provider reported, before its own fees and
            before any tax. It is not a profit figure.
          </p>
        </section>

        <section aria-labelledby="errors-heading" className="mt-8">
          <h2 id="errors-heading" className="text-lg font-bold">
            Operational errors
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Metric label="Webhook events parked as failed" value={count(metrics, "events_failed")} />
            <Metric label="Webhook events ignored" value={count(metrics, "events_ignored")} />
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            A refund that would take a balance below zero is parked here instead
            of being applied. It needs a person, not a retry.
          </p>
        </section>

        <section aria-labelledby="adjust-heading" className="mt-8 border-t border-line pt-6">
          <h2 id="adjust-heading" className="text-lg font-bold">
            Manual credit adjustment
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            For support cases. Every adjustment needs a note and lands in the
            same ledger as purchases.
          </p>
          <OwnerAdjustForm />
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={cardClass}>
      <dt className="text-xs font-bold uppercase tracking-[0.15em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-black tabular-nums">
        {value.toLocaleString("en-US")}
      </dd>
    </div>
  );
}
