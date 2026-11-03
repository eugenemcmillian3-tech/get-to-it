import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import {
  DeleteWorkflowForm,
  RunRow,
  StartWorkflowForm,
  WorkflowEditor,
  WorkflowPreview,
} from "@/components/workflow-forms";
import { requireSession } from "@/lib/auth";
import { listGoals } from "@/lib/data/goals";
import { getWorkflowDetail } from "@/lib/data/workflows";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { workflowStepsSchema } from "@/lib/workflows";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import type { WorkflowStepInput } from "@/lib/workflows";

export const metadata: Metadata = { title: "Workflow — GET TO IT" };

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const { workflowId } = await params;
  const session = await requireSession();
  const detail = await getWorkflowDetail(session, workflowId);

  if (!detail) notFound();

  const [identity, goals] = await Promise.all([getIdentity(session), listGoals(session)]);
  const latest = detail.versions[0];
  const parsedSteps = latest ? workflowStepsSchema.safeParse(latest.steps) : null;
  const steps: WorkflowStepInput[] = parsedSteps?.success ? parsedSteps.data : [];

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href="/workflows"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All workflows
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              {detail.workflow.name}
            </h1>
            {detail.workflow.description ? (
              <p className="mt-2 max-w-xl leading-relaxed text-muted">
                {detail.workflow.description}
              </p>
            ) : null}
          </div>
          <span className={chipClass}>Version {detail.workflow.current_version}</span>
        </div>

        <section className={`${cardClass} mt-6`}>
          <h2 className="text-lg font-bold">Start</h2>
          <div className="mt-2">
            <WorkflowPreview steps={steps} />
          </div>
          <div className="mt-4">
            <StartWorkflowForm workflowId={detail.workflow.id} />
          </div>
        </section>

        <section aria-labelledby="runs-heading" className="mt-10">
          <h2 id="runs-heading" className="text-lg font-bold">
            Runs
          </h2>
          <p className="mt-1 text-sm text-muted">
            Each run keeps the version it started with, even after you edit this
            workflow.
          </p>

          {detail.runs.length === 0 ? (
            <p className="mt-3 text-sm text-muted">This workflow has not run yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {detail.runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  href={`/workflows/runs/${run.id}`}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="edit-heading" className="mt-10">
          <h2 id="edit-heading" className="text-lg font-bold">
            Edit
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Saving creates version {detail.workflow.current_version + 1}. Runs in
            progress keep the steps they started with.
          </p>
          <div className="mt-4">
            <WorkflowEditor
              workflowId={detail.workflow.id}
              templates={detail.templates.map((template) => ({
                id: template.id,
                name: template.name,
                stepCount: template.steps.length,
              }))}
              goals={goals.map((goal) => ({ id: goal.id, title: goal.title }))}
              initial={{
                name: detail.workflow.name,
                description: detail.workflow.description ?? "",
                goal_id: detail.workflow.goal_id ?? "",
                steps,
              }}
            />
          </div>
        </section>

        <section aria-labelledby="versions-heading" className="mt-10">
          <h2 id="versions-heading" className="text-lg font-bold">
            Versions
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {detail.versions.map((version) => (
              <li key={version.version}>
                Version {version.version} — {version.name}
                {version.version === detail.workflow.current_version ? " (current)" : ""}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="delete-heading" className="mt-10 border-t border-line pt-6">
          <h2 id="delete-heading" className="text-lg font-bold">
            Delete
          </h2>
          <div className="mt-2">
            <DeleteWorkflowForm workflowId={detail.workflow.id} />
          </div>
        </section>

        <p className="mt-8 text-xs leading-relaxed text-muted">
          <Link href="/workflows" className={secondaryButton}>
            Back to workflows
          </Link>
        </p>
      </main>
    </div>
  );
}
