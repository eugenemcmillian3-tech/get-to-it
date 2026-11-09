import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/legal-shell";
import { ACCOUNT_DELETION_POLICY, REFUND_POLICY } from "@/lib/credits/format";
import { CREDIT_VALUE_LABEL } from "@/lib/credits/pricing";
import { focusRing } from "@/lib/styles";

export const metadata: Metadata = { title: "Refunds — GET TO IT" };

export default function RefundsPage() {
  return (
    <LegalShell
      title="Refund policy"
      summary={`This page explains what can be refunded for AI credits and for the one-time paid offers. A credit is worth ${CREDIT_VALUE_LABEL}; credits you have already spent bought AI work that has already been delivered.`}
    >
      <section>
        <h2 className="text-lg font-bold">1. AI credits</h2>
        <p className="mt-2 rounded-xl border border-line bg-card p-3 text-sm">
          {REFUND_POLICY}
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
          <li>
            &quot;Unused&quot; means credits still on your balance. The credit
            ledger records every purchase, charge, return and adjustment, so the
            unused amount is read from that record rather than estimated.
          </li>
          <li>
            A refund is issued to the original payment method through our payment
            provider. It is not paid as cash or as a transfer to another account.
          </li>
          <li>
            Once a refund is recorded, the unused credits are removed from the
            balance at the same time.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold">2. One-time paid offers</h2>
        <p className="mt-2 text-muted">
          Plans, seats, releases, templates, custom domains and support are bought
          once and do not renew. If an offer was paid for but never delivered, ask
          within 30 days of the purchase and we will either deliver it or refund
          it. Where an offer has already been delivered, a refund is at our
          discretion unless your local consumer law says otherwise. A refund for
          an offer ends the access it granted.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">3. Duplicate or unexpected charges</h2>
        <p className="mt-2 text-muted">
          If you were charged twice, charged after cancelling a checkout, or do not
          recognise a charge, contact us with the receipt reference. Confirmed
          duplicate or fraudulent charges are reversed in full. Card disputes are
          handled by your bank, but talking to us first is usually faster.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">4. Deleting your account</h2>
        <p className="mt-2 rounded-xl border border-line bg-card p-3 text-sm">
          {ACCOUNT_DELETION_POLICY}
        </p>
        <p className="mt-2 text-muted">
          If you want a refund for unused credits, request it before deleting the
          account. Once the account is gone, the balance is gone with it.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">5. Your statutory rights</h2>
        <p className="mt-2 text-muted">
          Nothing here removes a right you have under the consumer law that
          applies where you live. Where that law gives you a stronger right, it
          wins over this page.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">6. How to ask</h2>
        <p className="mt-2 text-muted">
          Reply to the receipt email the payment provider sent you, or use the
          support request form on the{" "}
          <Link
            href="/billing"
            className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
          >
            Plans
          </Link>{" "}
          page while signed in. Include the receipt reference and the email on the
          account. We aim to answer within five working days.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">7. Seeing what you were charged</h2>
        <p className="mt-2 text-muted">
          Every purchase, charge and adjustment appears in the credit ledger on
          the{" "}
          <Link
            href="/credits"
            className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
          >
            credits
          </Link>{" "}
          page, and paid offers appear under Purchases on the Plans page. That
          record is what a refund decision is made from.
        </p>
      </section>
    </LegalShell>
  );
}
