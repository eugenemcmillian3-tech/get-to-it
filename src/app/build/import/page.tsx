import type { Metadata } from "next";
import Link from "next/link";
import { ImportAppForm } from "@/components/import-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { IMPORT_LIMITS, IMPORT_STACK } from "@/lib/app-import-constants";
import { requireSession } from "@/lib/auth";
import { listAppImports, listGitHubImportSources } from "@/lib/data/app-import";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Import my app — GET TO IT" };

const BASELINE_LABELS: Record<string, string> = {
  not_run: "Baseline not run",
  passed: "Baseline passed",
  failed: "Baseline has pre-existing failures",
  blocked: "Baseline blocked",
};

export default async function ImportAppPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, imports, sources] = await Promise.all([
    getIdentity(session),
    listAppImports(session),
    listGitHubImportSources(session),
  ]);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href="/build"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All app projects
        </Link>

        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
          Import my app
        </h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted">
          Bring an existing supported app into the same project storage, preview sandbox and change-review workflow.
          Import first inspects files; it never runs install scripts or project code.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className={chipClass}>{IMPORT_STACK.label}</span>
          <span className={chipClass}>Static inspection only</span>
          <span className={chipClass}>Secrets excluded</span>
          <span className={chipClass}>Archive max {Math.floor(IMPORT_LIMITS.maxArchiveBytes / 1024 / 1024)} MB</span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">{IMPORT_STACK.note}</p>

        <section aria-labelledby="import-form-heading" className={`${cardClass} mt-6`}>
          <h2 id="import-form-heading" className="text-lg font-bold">Choose a source</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            ZIP archives must contain package.json, app/ and the supported stack. GitHub imports reuse an encrypted
            connection you already authorized. Unsupported frameworks and the pages router are refused with a clear
            reason.
          </p>
          <div className="mt-4">
            <ImportAppForm sources={sources} />
          </div>
        </section>

        <section aria-labelledby="imports-heading" className="mt-10">
          <h2 id="imports-heading" className="text-xl font-bold">Your imported apps</h2>
          {imports.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">No imports yet.</p>
              <p className="mt-1 text-sm text-muted">Choose an authorized GitHub repository or a project ZIP above.</p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {imports.map((record) => (
                <li key={record.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold">
                        <Link href={`/build/${record.project_id}/import`} className={`rounded hover:underline ${focusRing}`}>
                          {record.project_name}
                        </Link>
                      </h3>
                      <p className="mt-1 break-all text-sm text-muted">{record.source_label}</p>
                    </div>
                    <span className={chipClass}>{BASELINE_LABELS[record.baseline_status] ?? record.baseline_status}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                    <span className={chipClass}>{record.framework} {record.framework_version}</span>
                    <span className={chipClass}>{record.file_count} files</span>
                    <span className={chipClass}>{record.package_manager ?? "unknown package manager"}</span>
                    <span className={chipClass}>{record.source_kind === "git" ? "GitHub" : "ZIP"}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted">{record.map.summary}</p>
                  <p className="mt-3">
                    <Link href={`/build/${record.project_id}/import`} className={focusRing}>
                      <span className="text-sm font-semibold underline decoration-line underline-offset-4">Inspect map, baseline and modernization</span>
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
