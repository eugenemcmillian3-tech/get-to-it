import type { Metadata } from "next";
import Link from "next/link";
import { ExportPanel, ImportPanel } from "@/components/data-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { EXCLUDED_FIELDS, EXPORT_DATASETS, EXPORT_VERSION } from "@/lib/export";
import { getIdentity } from "@/lib/identity";
import { IMPORT_EXCLUDES_NOTE, IMPORT_SCOPE_NOTE } from "@/lib/import";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { cardClass, chipClass, focusRing } from "@/lib/styles";

export const metadata: Metadata = { title: "Your data — GET TO IT" };

export default async function DataPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const identity = await getIdentity(session);

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
          Your data
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          Take a copy of what you have written here, and bring a copy back into
          this account. Export and import use one documented format, so nothing
          depends on a spreadsheet layout or a hidden identifier.
        </p>

        <div className="mt-6 space-y-6">
          <ExportPanel />
          <ImportPanel />
        </div>

        <section aria-labelledby="format-heading" className="mt-10">
          <h2 id="format-heading" className="text-lg font-bold">
            The format
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            A JSON export carries <code>format: &quot;get-to-it.export&quot;</code>,{" "}
            <code>version: {EXPORT_VERSION}</code>, counts, goals with their
            tasks and saved results, weekly reflections and your saved
            preferences. Goals and tasks are referenced locally
            (<code>g1</code>, <code>g1-t1</code>): no account id is written, and
            no id in a file is trusted on import.
          </p>

          <ul className="mt-3 space-y-2">
            {EXPORT_DATASETS.map((dataset) => (
              <li key={dataset.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className={chipClass}>{dataset.label}</span>
                <span className="text-muted">{dataset.description}</span>
              </li>
            ))}
          </ul>

          <h3 className="mt-5 text-sm font-bold">Deliberately not included</h3>
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {EXCLUDED_FIELDS.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>

          <p className="mt-4 text-xs leading-relaxed text-muted">
            {IMPORT_EXCLUDES_NOTE} {IMPORT_SCOPE_NOTE}
          </p>
        </section>

        <section aria-labelledby="account-heading" className={`${cardClass} mt-10`}>
          <h2 id="account-heading" className="text-lg font-bold">
            Deleting your account
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Deleting your account is permanent and has no undo, so export first if
            you want a copy. The account control lives in{" "}
            <Link
              href="/settings"
              className={`rounded font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
            >
              Settings
            </Link>
            .
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-bold">Deleted with the account</h3>
              <ul className="mt-1 space-y-1 text-sm text-muted">
                <li>Your profile, email and sign-in record</li>
                <li>Goals, tasks and saved results</li>
                <li>Focus sessions, weekly reflections and daily check-ins</li>
                <li>Preferences, reminders, templates and daily plans</li>
                <li>
                  Your AI request history, learning paths, workflows, future
                  paths with their scenarios, reviews with their perspectives,
                  radar topics and signals, and missions with their evidence,
                  decisions, tasks, outcomes and suggestions, and outcome reviews
                  with their observations, forecasts and improvement records, and
                  app projects with their specifications, files, snapshots,
                  preview workspace runs, and agent-team runs with their task
                  branches, integration evidence and oversight log
                </li>
                <li>Workspaces you own, and your membership of others</li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-bold">Kept, without your content</h3>
              <ul className="mt-1 space-y-1 text-sm text-muted">
                <li>
                  The shared daily AI counter: a number with no account attached,
                  so deleting an account cannot hand allowance back
                </li>
                <li>
                  Credit ledger rows, kept as the accounting record with the
                  account removed; unused credits are not refunded
                </li>
                <li>
                  Feedback you sent, kept with the account link removed — remove
                  the goal text from it before sending if you would rather not
                  keep it
                </li>
                <li>Partner messages and reports held by the other person</li>
                <li>Operational logs: event names, counts and codes only</li>
              </ul>
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted">
            Nothing is anonymised into a profile: there is no analytics record,
            behavioural profile or shadow account. The full matrix, including
            what a workspace keeps after you leave, is in OPERATIONS.md.
          </p>
        </section>

        <p className="mt-8 text-xs leading-relaxed text-muted">
          Exports are generated in memory and sent to your browser; they are not
          stored on the server, and no export is emailed anywhere.
        </p>
      </main>
    </div>
  );
}
