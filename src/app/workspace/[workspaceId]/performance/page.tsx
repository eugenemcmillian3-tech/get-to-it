import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RegisterProgramForm } from "@/components/performance-program-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import {
  listPerformancePrograms,
  readPerformanceReport,
} from "@/lib/data/performance-program";
import { getIdentity } from "@/lib/identity";
import {
  CLAIM_LABELS,
  ERROR_RECOVERY_FAMILY_VERSION,
  PERFORMANCE_CLAIMS,
  PERFORMANCE_FAMILY_OPTIONS,
  PERFORMANCE_FAMILY_VERSION,
  PERFORMANCE_STATUS_LABELS,
  REFUSED_CLAIM_NOTE,
  replacementPrefill,
  type RegisterPrefill,
  REQUEST_CLARITY_VERSION,
  familyLabel,
} from "@/lib/performance-program";
import { cardClass, chipClass } from "@/lib/styles";
import { isUuid } from "@/lib/validation";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Performance program — GET TO IT" };

export default async function PerformanceProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ scope?: string; claim?: string; from?: string }>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  const requestedClaim = PERFORMANCE_CLAIMS.find((claim) => claim === query.claim);
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, list] = await Promise.all([
    getIdentity(session),
    listPerformancePrograms(session, workspaceId),
  ]);
  if (!list) notFound();

  let prefill: RegisterPrefill | undefined;
  if (query.from && isUuid(query.from)) {
    const previous = await readPerformanceReport(session, query.from).catch(() => null);
    if (previous && previous.program.workspaceId === workspaceId) {
      prefill = replacementPrefill(previous.program);
    }
  }

  const registered = list.programs.filter((program) => program.status !== "draft");
  const withTrials = registered.filter((program) => program.trialRows > 0);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link href={`/workspace/${workspaceId}/improvements`} className="text-sm text-muted underline">
          Back to improvement proposals
        </Link>

        <h1 className="mt-3 text-3xl font-black tracking-tight">Performance program</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          One narrow task family, or every installed family at once, compared under rules that are
          written down before anything runs. A comparison registers its task distribution,
          inclusion and exclusion rules, scoring method, baseline, permitted tools, limits, trial
          count, human assistance policy, failure criteria and the single claim it could support.
          Registration freezes those fields; trials can only be recorded afterwards, and the claim
          verdict is re-derived from the recorded rows on every read. A program across every family
          reports each family separately and never pools them into one score.
        </p>
        <ul className="mt-3 grid gap-1 text-sm text-muted">
          <li>
            Three installed families: tool selection ({PERFORMANCE_FAMILY_VERSION}, twelve authored
            intents including the six refusals that must not move), error recovery
            ({ERROR_RECOVERY_FAMILY_VERSION}, twelve authored failures to classify before
            retrying), and request clarity ({REQUEST_CLARITY_VERSION}, twelve authored requests
            where the missing referent decides whether to act). Each family fixes its own baseline,
            candidate policies and digest.
          </li>
          <li>
            Claims are not interchangeable. Faster, lower cost, better on this benchmark and better
            on a documented real-world distribution are four different claims, and a program may
            register one.
          </li>
          <li>{REFUSED_CLAIM_NOTE}</li>
        </ul>

        <p className="mt-3 text-xs text-muted">
          {list.programs.length} {list.programs.length === 1 ? "program" : "programs"} ·{" "}
          {withTrials.length} with recorded trials
        </p>

        <RegisterProgramForm
          workspaceId={workspaceId}
          families={PERFORMANCE_FAMILY_OPTIONS}
          defaultAllFamilies={query.scope === "all_families"}
          defaultClaim={requestedClaim}
          prefill={prefill}
        />

        <section aria-labelledby="programs-heading" className="mt-10">
          <h2 id="programs-heading" className="text-xl font-bold">
            Registered comparisons
          </h2>
          {registered.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Nothing has been registered in this workspace yet. A comparison has to be registered
              before any trial is recorded, so there is no way to write the method after seeing the
              numbers.
            </p>
          ) : (
            <ul className="mt-3 grid gap-4">
              {registered.map((program) => {
                const complete =
                  program.trialRows === program.expectedRows && program.expectedRows > 0;
                return (
                  <li key={program.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-bold">
                          <Link
                            href={`/workspace/${workspaceId}/performance/${program.id}`}
                            className="underline"
                          >
                            {program.title}
                          </Link>
                        </h3>
                        <p className="text-xs text-muted">
                          {program.scope === "all_families"
                            ? `All installed families (${program.familyKeys.length})`
                            : familyLabel(program.taskFamily)}{" "}
                          · {program.baselineLabel} vs {program.candidateLabel} · {program.tasks}{" "}
                          tasks × {program.trials}{" "}
                          {program.trials === 1 ? "trial" : "trials"}
                        </p>
                      </div>
                      <span className={chipClass}>{PERFORMANCE_STATUS_LABELS[program.status]}</span>
                    </div>

                    <dl className="mt-3 grid gap-2 text-sm">
                      <div>
                        <dt className="font-semibold">Registered claim</dt>
                        <dd className="text-muted">
                          {CLAIM_LABELS[program.supportedClaim]} — {program.claimText}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold">Trials recorded</dt>
                        <dd className="text-muted">
                          {program.trialRows} of {program.expectedRows}
                          {complete ? " (complete)" : ""} · baseline {program.baselineRows},
                          candidate {program.candidateRows} · {program.disagreements} review{" "}
                          {program.disagreements === 1 ? "disagreement" : "disagreements"} ·{" "}
                          {program.humanReferences} documented human{" "}
                          {program.humanReferences === 1 ? "reference" : "references"}
                        </dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
