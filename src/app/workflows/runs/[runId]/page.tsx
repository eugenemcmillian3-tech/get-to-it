import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { WorkflowRunPanel } from "@/components/workflow-forms";
import { requireSession } from "@/lib/auth";
import { getWorkflowRun } from "@/lib/data/workflows";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { focusRing } from "@/lib/styles";

export const metadata: Metadata = { title: "Workflow run — GET TO IT" };

export default async function WorkflowRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const { runId } = await params;
  const session = await requireSession();
  const detail = await getWorkflowRun(session, runId);

  if (!detail) notFound();

  const identity = await getIdentity(session);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <div className="flex flex-wrap gap-4">
          <Link
            href="/workflows"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            ← All workflows
          </Link>
          {detail.run.workflow_id ? (
            <Link
              href={`/workflows/${detail.run.workflow_id}`}
              className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
            >
              Workflow ({detail.workflowMissing ? "deleted" : `version ${detail.latestVersion ?? detail.run.workflow_version}`})
            </Link>
          ) : null}
        </div>

        {detail.workflowMissing ? (
          <p className="mt-3 text-xs text-muted">
            The workflow that produced this run was deleted. The run, its outputs
            and its action records are unchanged.
          </p>
        ) : detail.latestVersion !== null &&
          detail.latestVersion > detail.run.workflow_version ? (
          <p className="mt-3 text-xs text-muted">
            This run used version {detail.run.workflow_version}; the workflow is now
            at version {detail.latestVersion}. Edits never reach a run already
            started.
          </p>
        ) : null}

        <div className="mt-5">
          <WorkflowRunPanel detail={detail} />
        </div>
      </main>
    </div>
  );
}
