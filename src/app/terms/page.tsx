import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/legal-shell";
import { formatUsd } from "@/lib/credits/format";
import { CREDIT_VALUE_LABEL, AI_OPERATION_PRICES } from "@/lib/credits/pricing";
import { focusRing } from "@/lib/styles";

export const metadata: Metadata = { title: "Terms — GET TO IT" };

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of use"
      summary="These terms cover your account, the work you do in GET TO IT, the AI credits you buy, and the one-time paid offers. They are written to be readable rather than impressive."
    >
      <section>
        <h2 className="text-lg font-bold">1. What GET TO IT is</h2>
        <p className="mt-2 text-muted">
          GET TO IT helps you name work you have been putting off, break it into
          steps, and build small applications from a written specification. The app
          builder generates files from your specification using a deterministic
          scaffolder. Nothing you generate is executed on our servers, and no shell
          or arbitrary code runs there.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">2. Your account</h2>
        <p className="mt-2 text-muted">
          You need an account to use most of the app. Keep your password to
          yourself; activity under your account is treated as yours. You must be
          old enough to enter a binding contract where you live. One person per
          account, and the details you give us should be accurate.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">3. AI work and credits</h2>
        <p className="mt-2 text-muted">
          AI features are paid per operation with prepaid credits. One credit is
          worth {CREDIT_VALUE_LABEL} of retail value. There is no free AI
          allowance: when your balance reaches zero, AI requests stop and
          everything you have already saved keeps working.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
          {AI_OPERATION_PRICES.map((operation) => (
            <li key={operation.kind}>
              {operation.label}: {operation.credits}{" "}
              {operation.credits === 1 ? "credit" : "credits"} (
              {formatUsd(operation.credits * 10)}). {operation.note}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-muted">
          Credits are a prepaid balance for this service only. They are not
          money, they cannot be transferred or sold, and they have no cash value
          outside a refund under the{" "}
          <Link
            href="/refunds"
            className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
          >
            refund policy
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">4. One-time paid offers</h2>
        <p className="mt-2 text-muted">
          Plans, seats, releases, templates, domains and support are separate
          one-time purchases from AI credits. They do not renew automatically.
          Access to a paid offer begins only after the payment provider confirms
          the payment to us; a success page on its own does not activate
          anything.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">5. Acceptable use</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>Do not use the service to break the law or to harm other people.</li>
          <li>
            Do not attack, overload, probe or attempt to bypass the service, its
            rate limits or its access controls.
          </li>
          <li>
            Do not resell the service or the developer API as your own product
            without written permission.
          </li>
          <li>
            Do not use generated applications to deceive people, to collect data
            unlawfully, or to send unsolicited bulk messages.
          </li>
        </ul>
        <p className="mt-3 text-muted">
          We may suspend an account that puts the service or other people at
          risk. Where it is reasonable to do so, we will tell you why.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">6. Your content and generated output</h2>
        <p className="mt-2 text-muted">
          You keep ownership of what you write: goals, tasks, specifications and
          the files you generate from them. You give us permission to store and
          process that content only to run the service for you. AI operations send
          the relevant text to the model provider named in the{" "}
          <Link
            href="/privacy"
            className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
          >
            privacy notice
          </Link>
          .
        </p>
        <p className="mt-3 text-muted">
          Generated files are a starting point, not a finished product. Review
          them, including anything that touches authentication, payments or
          personal data, before you deploy or share them.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">7. Availability and changes</h2>
        <p className="mt-2 text-muted">
          The service is provided on a best-effort basis. Features may change,
          and an individual integration may be unavailable while a provider is
          down. We will not remove paid access you have already been granted
          without a refund, except where an account is suspended for breaking
          these terms.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">8. Liability</h2>
        <p className="mt-2 text-muted">
          The service is provided as is, without warranties beyond those the law
          does not allow us to exclude. To the extent the law permits, our total
          liability for a claim relating to the service is limited to the greater
          of the amount you paid us in the three months before the claim or USD
          50. We are not liable for indirect or consequential loss, or for loss
          caused by AI output you chose to rely on without reviewing it.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">9. Ending your use</h2>
        <p className="mt-2 text-muted">
          You can delete your account at any time from Settings. Deleting your
          account removes any unused credits, and they are not refunded
          automatically. We may close an account that has been inactive for a
          long period, after warning you at the address on the account.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">10. Changes to these terms</h2>
        <p className="mt-2 text-muted">
          If these terms change in a way that affects what you pay or what you
          are allowed to do, we will show the change in the app before it applies
          to you. The date at the top of this page is the date of the last
          change.
        </p>
      </section>
    </LegalShell>
  );
}
