import type { Metadata } from "next";
import Link from "next/link";
import { CreateEvaluationForm } from "@/components/evaluation-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { listAppProjects } from "@/lib/data/app-projects";
import { listEvaluationWorkspaces } from "@/lib/data/evaluations";
import { EVAL_BUDGET_NOTE, EVAL_NO_SCORE_NOTE } from "@/lib/evaluations";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Evaluations — GET TO IT" };

export default async function EvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, projects, workspaces, query] = await Promise.all([
    getIdentity(session),
    listAppProjects(session),
    listEvaluationWorkspaces(session),
    searchParams,
  ]);

  const requestedProject = typeof query.project === "string" ? query.project : "";
  const defaultProjectId = isUuid(requestedProject) ? requestedProject : undefined;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href="/build"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to Build an App
        </Link>

        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
          Evaluations
        </h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted">
          Compare agent configurations on the same bounded tasks. Inspect failures,
          review the evidence and decide whether a routing or role change is
          justified.
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          {EVAL_NO_SCORE_NOTE}
        </p>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">
          {EVAL_BUDGET_NOTE}
        </p>

        <section aria-labelledby="new-evaluation-heading" className={`${cardClass} mt-8`}>
          <h2 id="new-evaluation-heading" className="text-xl font-bold">
            New evaluation workspace
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Uses the five initial categories: small frontend change, backend
            validation change, bug repair, test generation and existing-code
            explanation. Development examples and held-out tasks stay separate.
          </p>
          <div className="mt-4">
            <CreateEvaluationForm
              projects={projects.map((project) => ({
                id: project.id,
                name: project.name,
                current_version: project.current_version,
              }))}
              defaultProjectId={defaultProjectId}
            />
          </div>
        </section>

        <section aria-labelledby="workspaces-heading" className="mt-10">
          <h2 id="workspaces-heading" className="text-xl font-bold">
            Your evaluation workspaces
          </h2>

          {workspaces.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">No evaluations yet.</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Start with the synthetic fixture. It contains no customer data and
                no credentials.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {workspaces.map((workspace) => {
                const budget = workspace.budget;
                return (
                  <li key={workspace.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-lg font-semibold leading-snug">
                        <Link
                          href={`/evaluations/${workspace.id}`}
                          className={`rounded hover:underline ${focusRing}`}
                        >
                          {workspace.name}
                        </Link>
                      </h3>
                      <span className={chipClass}>
                        {workspace.source_kind === "synthetic" ? "Synthetic fixture" : "Approved project snapshot"}
                      </span>
                    </div>
                    {workspace.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted">{workspace.description}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                      {workspace.status === "draft" ? <span className={chipClass}>Draft — setup incomplete</span> : null}
                      <span className={chipClass}>{workspace.task_count} tasks</span>
                      <span className={chipClass}>{workspace.run_count} runs</span>
                      <span className={chipClass}>{workspace.failed_run_count} did not pass</span>
                      <span className={chipClass}>
                        {budget
                          ? `Budget ${budget.used_runs}/${budget.approved_runs} · ${budget.status}`
                          : "No approved budget"}
                      </span>
                    </div>
                    <p className="mt-3">
                      <Link
                        href={`/evaluations/${workspace.id}`}
                        className={`rounded text-sm font-semibold underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
                      >
                        Compare configurations and inspect failures
                      </Link>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={`${cardClass} mt-10`}>
          <h2 className="text-lg font-bold">What this workspace guarantees</h2>
          <ul className="mt-2 space-y-1 text-sm leading-relaxed text-muted">
            <li>Every run needs an approved budget, even though fixture runs cost nothing.</li>
            <li>Acceptance checks and expected output are locked after the first run.</li>
            <li>Failed and errored runs are preserved; human review cannot rewrite them.</li>
            <li>Deterministic checks are separate from AI-judged opinions.</li>
            <li>Recommendations never change production configurations automatically.</li>
            <li>No provider call, deployment, install or customer project is used without permission.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
