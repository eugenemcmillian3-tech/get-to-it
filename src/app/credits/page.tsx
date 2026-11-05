import type { Metadata } from "next";
import Link from "next/link";
import { CreditPackForm } from "@/components/credit-pack-form";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { cancelCheckoutAction } from "@/lib/actions/credits";
import { requireSession } from "@/lib/auth";
import {
  ACCOUNT_DELETION_POLICY,
  REFUND_POLICY,
  formatCredits,
  formatSignedCredits,
  formatUsd,
  ledgerReasonLabel,
  paymentStatusLabel,
} from "@/lib/credits/format";
import {
  AI_OPERATION_PRICES,
  BUILD_MAX_CREDITS,
  CREDIT_VALUE_CENTS,
  CREDIT_VALUE_LABEL,
  WORKFLOW_MAX_CREDITS,
  formatCreditsWithUsd,
  operationLabel,
} from "@/lib/credits/pricing";
import { stripeConfigState } from "@/lib/credits/stripe";
import { getCreditOverview } from "@/lib/data/credits";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import {
  cardClass,
  chipClass,
  focusRing,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

export const metadata: Metadata = { title: "AI credits — GET TO IT" };
export const dynamic = "force-dynamic";

function whenLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, overview, params] = await Promise.all([
    getIdentity(session),
    getCreditOverview(session),
    searchParams,
  ]);

  const { summary, packs, payments, ledger, usage } = overview;
  const stripeState = stripeConfigState();
  const stripeReady = stripeState === "ready";

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
          AI credits
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          AI work is prepaid. There is no free plan and no trial: new accounts
          start with zero credits, and each credit is worth {CREDIT_VALUE_LABEL}.
          Add credits before starting AI work.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className={chipClass}>{formatCredits(summary.balance)} left</span>
          <span className={chipClass}>
            {formatUsd(summary.balance * CREDIT_VALUE_CENTS)} value
          </span>
          <span className={chipClass}>{CREDIT_VALUE_LABEL} per credit</span>
          <span className={chipClass}>Test mode</span>
        </div>

        <p className="mt-3 rounded-xl border border-line bg-paper p-3 text-sm leading-relaxed">
          At zero credits, new paid AI work is blocked. Your existing results,
          account settings and billing history stay available. Nothing is charged
          automatically, and no free AI or sample output is substituted.
        </p>

        <section aria-labelledby="prices-heading" className="mt-9">
          <h2 id="prices-heading" className="text-lg font-bold">
            What AI work costs
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Each request reserves its price before the model call and releases it
            if the call fails. These are fixed estimates, not token counts.
          </p>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-card">
            {AI_OPERATION_PRICES.map((operation) => (
              <li
                key={operation.kind}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium">{operation.label}</p>
                  <p className="text-xs text-muted">{operation.note}</p>
                </div>
                <p className="text-sm font-semibold">
                  {formatCreditsWithUsd(operation.credits)}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            A build repair costs 2 credits per attempt and can use at most{" "}
            {BUILD_MAX_CREDITS} credits per workspace. A workflow run has a
            user-chosen limit of up to {WORKFLOW_MAX_CREDITS} credits. Swarms are
            fixture-only today and make no paid calls, so they use 0 credits.
          </p>
        </section>

        {params.checkout === "done" ? (
          <p className="mt-4 rounded-xl border border-line bg-paper p-3 text-sm leading-relaxed">
            Checkout finished. Credits appear here once the payment provider
            confirms it — this page never adds credits on its own. Reload in a
            moment if the balance is unchanged.
          </p>
        ) : null}

        {params.checkout === "cancelled" ? (
          <p className="mt-4 rounded-xl border border-line bg-paper p-3 text-sm leading-relaxed">
            Checkout was cancelled. Nothing was charged and no credits were added.
          </p>
        ) : null}

        <section aria-labelledby="packs-heading" className="mt-9">
          <h2 id="packs-heading" className="text-lg font-bold">
            Buy credits
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            A one-time purchase, not a subscription. Nothing renews.
          </p>

          {stripeReady ? null : (
            <p className="mt-3 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
              {stripeState === "live-blocked" ? (
                <>
                  A live Stripe key is configured, but this build refuses live
                  payments, so checkout is unavailable. Use an{" "}
                  <code>sk_test_</code> key instead; taking real money needs a
                  deliberate change.
                </>
              ) : (
                <>
                  Stripe isn&apos;t configured on this deployment, so checkout is
                  unavailable. Add <code>STRIPE_SECRET_KEY</code> and{" "}
                  <code>STRIPE_WEBHOOK_SECRET</code> in test mode, plus{" "}
                  <code>CREDIT_RPC_TOKEN</code> for the webhook.
                </>
              )}
            </p>
          )}

          {packs.length > 0 ? (
            <CreditPackForm packs={packs} enabled={stripeReady} />
          ) : (
            <p className="mt-3 text-sm text-muted">No packs are on sale right now.</p>
          )}

          <p className="mt-3 text-xs leading-relaxed text-muted">
            Credits are added only after a verified payment webhook. A success
            page on its own is not proof of payment.
          </p>
        </section>

        {payments.length > 0 ? (
          <section aria-labelledby="payments-heading" className="mt-10">
            <h2 id="payments-heading" className="text-lg font-bold">
              Purchases
            </h2>

            <ul className="mt-3 space-y-2">
              {payments.map((payment) => (
                <li key={payment.id} className={cardClass}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {formatCredits(payment.credits)} · {formatUsd(payment.amount_cents)}
                    </p>
                    <p className="text-xs font-medium text-muted">
                      {paymentStatusLabel(payment.status)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted">{whenLabel(payment.created_at)}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {payment.receipt_url ? (
                      <a
                        href={payment.receipt_url}
                        rel="noreferrer noopener"
                        target="_blank"
                        className={`rounded text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
                      >
                        Receipt
                      </a>
                    ) : null}

                    <span className="text-xs text-muted">
                      Reference {payment.id.slice(0, 8)}
                    </span>

                    {payment.status === "pending" ? (
                      <form action={cancelCheckoutAction}>
                        <input type="hidden" name="payment_id" value={payment.id} />
                        <button type="submit" className={quietButton}>
                          Cancel this checkout
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="history-heading" className="mt-10">
          <h2 id="history-heading" className="text-lg font-bold">
            Credit history
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Every change is one row. Rows are never edited or removed.
          </p>

          {ledger.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No credit changes yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-card">
              {ledger.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">{ledgerReasonLabel(entry.reason)}</p>
                    {entry.note ? (
                      <p className="text-xs text-muted">{entry.note}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">
                      {formatSignedCredits(entry.delta)}
                    </p>
                    <p className="text-xs text-muted">{whenLabel(entry.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="usage-heading" className="mt-10">
          <h2 id="usage-heading" className="text-lg font-bold">
            Recent AI requests
          </h2>

          {usage.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No AI requests yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {usage.map((row) => (
                <li key={row.id} className="rounded-xl border border-line bg-card p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">
                      {operationLabel(row.kind)}
                    </p>
                    <p className="text-xs text-muted">{whenLabel(row.started_at)}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {row.status === "succeeded"
                      ? "Succeeded"
                      : row.status === "failed"
                        ? `Failed${row.error_code ? ` (${row.error_code})` : ""}`
                        : "In progress"}
                    {row.credits_charged > 0
                      ? ` · ${formatCredits(row.credits_charged)} used`
                      : " · no charge"}
                    {row.tokens_in !== null || row.tokens_out !== null
                      ? ` · ${row.tokens_in ?? 0} in / ${row.tokens_out ?? 0} out tokens`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="policy-heading" className="mt-10 border-t border-line pt-6">
          <h2 id="policy-heading" className="text-lg font-bold">
            Refunds and closing your account
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{REFUND_POLICY}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{ACCOUNT_DELETION_POLICY}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Payments run through Stripe. In test mode no real card is charged;
            with live keys, the provider&apos;s own receipt is the record of the
            payment.
          </p>
        </section>

        <p className="mt-8">
          <Link href="/dashboard" className={secondaryButton}>
            Back to your goals
          </Link>
        </p>
      </main>
    </div>
  );
}
