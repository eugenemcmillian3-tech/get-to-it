import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { WorkflowEditor } from "@/components/workflow-forms";
import { requireSession } from "@/lib/auth";
import { listGoals } from "@/lib/data/goals";
import { listPersonalTemplates } from "@/lib/data/templates";
import { listWorkflows } from "@/lib/data/workflows";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { RUN_STATUS_LABELS, WORKFLOW_SCOPE_NOTE, type RunStatus } from "@/lib/workflows";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";

export const metadata: Metadata = { title: "Workflows — GET TO IT" };

export default async function WorkflowsPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, workflows, templates, goals] = await Promise.all([
    getIdentity(session),
    listWorkflows(session),
    listPersonalTemplates(session),
    listGoals(session),
  ]);

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
          Workflows
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          A short sequence you run yourself: collect input, draft, review it, and
          optionally save the approved text. Every external action has its own
          approval for exactly what it sends.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{WORKFLOW_SCOPE_NOTE}</p>

        <section aria-labelledby="workflow-list-heading" className="mt-8">
          <h2 id="workflow-list-heading" className="text-lg font-bold">
            Your workflows
          </h2>

          {workflows.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">No workflows yet.</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                The editor below starts with the weekly update example. Change the
                steps or copy one of your private templates.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {workflows.map((workflow) => (
                <li key={workflow.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold leading-snug">
                      <Link
                        href={`/workflows/${workflow.id}`}
                        className={`rounded hover:underline ${focusRing}`}
                      >
                        {workflow.name}
                      </Link>
                    </h3>
                    <span className={chipClass}>Version {workflow.current_version}</span>
                  </div>
                  {workflow.description ? (
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
                      {workflow.description}
                    </p>
                  ) : null}
                  <p className="mt-3">
                    <Link href={`/workflows/${workflow.id}`} className={secondaryButton}>
                      Open workflow
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="create-heading" className="mt-10">
          <h2 id="create-heading" className="text-lg font-bold">
            New workflow
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Steps run in the order shown. A workflow needs input, drafting, review
            and a completion checkpoint; a connector action is optional.
          </p>
          <div className="mt-4">
            <WorkflowEditor
              templates={templates.map((template) => ({
                id: template.id,
                name: template.name,
                stepCount: template.steps.length,
              }))}
              goals={goals.map((goal) => ({ id: goal.id, title: goal.title }))}
            />
          </div>
        </section>

        <p className="mt-8 text-xs leading-relaxed text-muted">
          Run states: {Object.values(RUN_STATUS_LABELS).join(", ")}. A run only
          counts as succeeded after you confirm its checkpoint.
        </p>
      </main>
    </div>
  );
}

export type { RunStatus };
