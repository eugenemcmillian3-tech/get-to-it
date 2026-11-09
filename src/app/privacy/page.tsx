import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/legal-shell";
import { CONTACT_EMAIL, OPERATOR_ADDRESS, OPERATOR_NAME } from "@/lib/legal";
import { focusRing } from "@/lib/styles";

export const metadata: Metadata = { title: "Privacy — GET TO IT" };

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy notice"
      summary="This notice lists what GET TO IT stores, which services process it, how long it stays, and how to remove it. It describes the software as it is built, not a marketing promise."
    >
      <section>
        <h2 className="text-lg font-bold">1. Who is responsible</h2>
        <p className="mt-2 text-muted">
          {OPERATOR_NAME} is the controller of the data described here
          {OPERATOR_ADDRESS ? `, at ${OPERATOR_ADDRESS}` : ""}. Privacy requests
          go to{" "}
          {CONTACT_EMAIL ? (
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
            >
              {CONTACT_EMAIL}
            </a>
          ) : (
            "the support request form on the Plans page"
          )}
          .
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">2. What we store</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>
            <strong className="text-ink">Account details:</strong> your email
            address and an internal account id. Passwords are handled by our
            authentication provider and stored only as a hash; we never see them.
          </li>
          <li>
            <strong className="text-ink">Content you create:</strong> goals,
            tasks, plans, learning paths, reviews, specifications, generated
            files, workspace comments and shared links.
          </li>
          <li>
            <strong className="text-ink">Usage records:</strong> which AI
            operation ran, how many credits it cost, your credit ledger, and
            developer API request records (credential prefix, operation, status,
            timestamp).
          </li>
          <li>
            <strong className="text-ink">Payment metadata:</strong> the amount,
            currency, status, receipt link and the payment provider&apos;s
            identifiers. Card numbers never reach our servers.
          </li>
          <li>
            <strong className="text-ink">Integration credentials you add:</strong>
            tokens for GitHub, Vercel, Supabase or connected tools, sealed with
            encryption before they are stored and never returned to the browser.
          </li>
          <li>
            <strong className="text-ink">Error records:</strong> sanitised
            server-side error events used to keep the service working. These are
            not used for advertising.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold">2. Who processes it</h2>
        <p className="mt-2 text-muted">
          We use a small set of providers, each for one job:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>
            <strong className="text-ink">Supabase</strong> — database, file
            storage and authentication. Row-level security limits each account to
            its own rows.
          </li>
          <li>
            <strong className="text-ink">Vercel</strong> — application hosting and
            server logs.
          </li>
          <li>
            <strong className="text-ink">Stripe</strong> — card payments and
            receipts. Stripe receives your payment details directly.
          </li>
          <li>
            <strong className="text-ink">Ollama Cloud</strong> — the model
            provider for AI operations. The text needed for a request (for
            example a task or a specification) is sent there to produce the
            reply.
          </li>
          <li>
            <strong className="text-ink">Resend</strong> — transactional email
            such as sign-in and reminder messages.
          </li>
          <li>
            <strong className="text-ink">GitHub, Vercel and Supabase APIs</strong>{" "}
            — only when you connect a project and ask the app to act on your
            behalf.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold">3. Cookies</h2>
        <p className="mt-2 text-muted">
          The app sets session cookies so you stay signed in, and a short-lived
          cookie during the sign-in callback. There are no advertising or
          cross-site tracking cookies.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">4. How long it stays</h2>
        <p className="mt-2 text-muted">
          Content stays until you delete it or delete your account. Payment and
          credit records are kept after deletion where accounting or tax rules
          require it. Sanitised error records are retained for a limited period to
          diagnose faults.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">5. Deleting your data</h2>
        <p className="mt-2 text-muted">
          Settings → Your data lets you export your content and delete your
          account. Deleting the account removes your content and any unused
          credits; as stated in the{" "}
          <Link
            href="/refunds"
            className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
          >
            refund policy
          </Link>
          , unused credits are not refunded automatically on deletion. A small
          amount of payment history may be retained as described above.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">6. Your choices</h2>
        <p className="mt-2 text-muted">
          You can correct your account details, export your content, disconnect an
          integration at any time, and ask us to delete your data. Depending on
          where you live you may also have the right to object to a particular use
          or to ask for a copy of what we hold. Use the support form on the Plans
          page to make a request.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">7. Security</h2>
        <p className="mt-2 text-muted">
          Access is enforced in the database with row-level security as well as in
          the app. Developer API keys are stored only as hashes. Integration
          secrets are sealed with encryption before storage. No service can
          promise perfect security, so treat generated applications and shared
          links as public until you have reviewed them.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">8. Changes</h2>
        <p className="mt-2 text-muted">
          If this notice changes in a way that affects what is collected or who
          receives it, the change will be shown in the app before it applies. The
          date at the top of this page is the date of the last change.
        </p>
      </section>
    </LegalShell>
  );
}
