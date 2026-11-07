import type { Metadata } from "next";
import Link from "next/link";
import { BillingOfferForm, CustomDomainForm, SupportRequestForm } from "@/components/billing-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { cancelBillingPurchaseAction } from "@/lib/actions/billing";
import { requireSession } from "@/lib/auth";
import { BILLING_NOT_CREDITS, billingGrantLabel, offerPriceLabel } from "@/lib/billing/offers";
import { stripeConfigState } from "@/lib/credits/stripe";
import { activeGrants, getBillingOverview } from "@/lib/data/billing";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { cardClass, chipClass, focusRing, quietButton, secondaryButton } from "@/lib/styles";
import type { BillingEntitlement } from "@/lib/types";

export const metadata: Metadata = { title: "Paid offers — GET TO IT" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "Checkout open",
  paid: "Paid",
  refunded: "Refunded",
  failed: "Failed",
  canceled: "Cancelled",
  expired: "Expired",
};

function whenLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function entitlementIsActive(entitlement: BillingEntitlement, now: Date): boolean {
  return (
    entitlement.status === "active" &&
    (!entitlement.expires_at || new Date(entitlement.expires_at) > now)
  );
}

export default async function BillingPage({
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
    getBillingOverview(session),
    searchParams,
  ]);

  const stripeState = stripeConfigState();
  const stripeReady = stripeState === "ready";
  const now = new Date();
  const grants = activeGrants(overview.entitlements, now);
  const active = overview.entitlements.filter((item) => entitlementIsActive(item, now));
  const offerBySlug = new Map(overview.offers.map((offer) => [offer.slug, offer]));

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href="/dashboard"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to your goals
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            Paid offers
          </h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-muted">
            Seven add-ons for teams, automation, releases, templates, domains and
            support. They are separate from AI credits.
          </p>
          <p className="mt-3 rounded-xl border border-brand/30 bg-brand-soft p-3 text-sm font-medium leading-relaxed">
            {BILLING_NOT_CREDITS}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className={chipClass}>Stripe test mode</span>
            <span className={chipClass}>No auto-renewal</span>
            <span className={chipClass}>Access starts after webhook confirmation</span>
            <Link href="/credits" className={chipClass}>
              AI credits are separate
            </Link>
          </div>
        </header>

        {params.checkout === "done" ? (
          <p className="mt-4 rounded-xl border border-line bg-paper p-3 text-sm leading-relaxed">
            Checkout finished. Your entitlement appears here only after the signed
            payment webhook confirms it. Reload in a moment if it is not listed yet.
          </p>
        ) : null}
        {params.checkout === "cancelled" ? (
          <p className="mt-4 rounded-xl border border-line bg-paper p-3 text-sm leading-relaxed">
            Checkout was cancelled. Nothing was charged and nothing was activated.
          </p>
        ) : null}

        {active.length > 0 ? (
          <section aria-labelledby="active-heading" className="mt-8">
            <h2 id="active-heading" className="text-lg font-bold">
              Active on this account
            </h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {active.map((entitlement) => {
                const offer = offerBySlug.get(entitlement.offer_slug);
                return (
                  <li key={entitlement.id} className={cardClass}>
                    <p className="font-semibold">{offer?.label ?? entitlement.offer_slug}</p>
                    <p className="mt-1 text-xs text-muted">
                      Started {whenLabel(entitlement.starts_at)}
                      {entitlement.expires_at
                        ? ` · ends ${whenLabel(entitlement.expires_at)}`
                        : " · no expiry"}
                      {entitlement.quantity > 1 ? ` · ×${entitlement.quantity}` : ""}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      {entitlement.grants.map(billingGrantLabel).join(" · ")}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {!stripeReady ? (
          <p className="mt-6 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {stripeState === "live-blocked"
              ? "A live Stripe key is configured, but this build refuses live payments. Use an sk_test_ key; taking real money needs a deliberate change."
              : "Stripe is not configured on this deployment, so checkout is unavailable. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in test mode, plus CREDIT_RPC_TOKEN for the webhook."}
          </p>
        ) : null}

        <section aria-labelledby="offers-heading" className="mt-9">
          <h2 id="offers-heading" className="text-lg font-bold">
            The seven offers
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Each offer becomes an entitlement automatically after payment. Nothing
            renews and nothing is approved by hand.
          </p>

          {overview.offers.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
              No offers are on sale right now.
            </p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {overview.offers.map((offer) => (
                <BillingOfferForm
                  key={offer.slug}
                  offer={offer}
                  workspaces={overview.workspaces}
                  enabled={stripeReady}
                />
              ))}
            </div>
          )}
        </section>

        {grants.has("white_label") ? (
          <section aria-labelledby="domains-heading" className="mt-10 border-t border-line pt-6">
            <h2 id="domains-heading" className="text-lg font-bold">
              Custom domains
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Attach a domain to a generated app that is connected to Vercel. DNS
              records are the one part this app cannot edit for you.
            </p>
            <CustomDomainForm projects={overview.projects} />
            {overview.domains.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {overview.domains.map((domain) => (
                  <li key={domain.id} className={cardClass}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold">{domain.domain}</p>
                      <span className={chipClass}>{domain.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Added {whenLabel(domain.created_at)} ·{" "}
                      {overview.projects.find((project) => project.id === domain.project_id)?.name ??
                        "App project"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {grants.has("priority_support") ? (
          <section aria-labelledby="support-heading" className="mt-10 border-t border-line pt-6">
            <h2 id="support-heading" className="text-lg font-bold">
              Priority support
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Requests are recorded immediately and marked priority. This is a queue,
              not a promise of a response time, and no human is automatically paged.
            </p>
            <SupportRequestForm />
            {overview.supportRequests.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {overview.supportRequests.map((request) => (
                  <li key={request.id} className={cardClass}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold">{request.subject}</p>
                      <span className={chipClass}>{request.status}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{request.body}</p>
                    <p className="mt-1 text-xs text-muted">
                      {request.priority} · {whenLabel(request.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {grants.has("onboarding") ? (
          <section aria-labelledby="onboarding-heading" className="mt-10 border-t border-line pt-6">
            <h2 id="onboarding-heading" className="text-lg font-bold">
              Onboarding checklist
            </h2>
            <ol className="mt-3 space-y-2 text-sm leading-relaxed">
              <li className={cardClass}>
                1. Add a goal and use a template.{" "}
                <Link href="/templates" className={`underline ${focusRing}`}>
                  Open templates
                </Link>
              </li>
              <li className={cardClass}>
                2. Create a workspace and invite the people who will use it.{" "}
                <Link href="/workspace" className={`underline ${focusRing}`}>
                  Open workspaces
                </Link>{" "}
                Seat limits apply separately.
              </li>
              <li className={cardClass}>
                3. Connect a project to GitHub, Vercel and Supabase before planning a
                release. <Link href="/build" className={`underline ${focusRing}`}>Open Build an App</Link>
              </li>
              <li className={cardClass}>
                4. Keep AI credits separate.{" "}
                <Link href="/credits" className={`underline ${focusRing}`}>
                  Check your balance
                </Link>
              </li>
            </ol>
          </section>
        ) : null}

        {overview.purchases.length > 0 ? (
          <section aria-labelledby="purchases-heading" className="mt-10 border-t border-line pt-6">
            <h2 id="purchases-heading" className="text-lg font-bold">
              Purchases
            </h2>
            <ul className="mt-3 space-y-2">
              {overview.purchases.map((purchase) => {
                const offer = offerBySlug.get(purchase.offer_slug);
                return (
                  <li key={purchase.id} className={cardClass}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold">
                        {offer?.label ?? purchase.offer_slug}
                        {purchase.quantity > 1 ? ` × ${purchase.quantity}` : ""}
                      </p>
                      <p className="text-sm font-semibold">
                        {offerPriceLabel(purchase.amount_cents)}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {STATUS_LABEL[purchase.status] ?? purchase.status} ·{" "}
                      {whenLabel(purchase.created_at)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {purchase.receipt_url ? (
                        <a
                          href={purchase.receipt_url}
                          rel="noreferrer noopener"
                          target="_blank"
                          className={`rounded text-sm font-semibold underline decoration-line underline-offset-4 ${focusRing}`}
                        >
                          Receipt
                        </a>
                      ) : null}
                      {purchase.status === "pending" ? (
                        <form action={cancelBillingPurchaseAction}>
                          <input type="hidden" name="purchase_id" value={purchase.id} />
                          <button type="submit" className={quietButton}>
                            Cancel this checkout
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <p className="mt-10">
          <Link href="/dashboard" className={secondaryButton}>
            Back to your goals
          </Link>
        </p>
      </main>
    </div>
  );
}
