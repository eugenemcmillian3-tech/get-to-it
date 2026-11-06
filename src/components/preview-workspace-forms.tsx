"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import { operationChargeLabel } from "@/lib/credits/pricing";
import {
  previewWorkspaceAction,
  repairWorkspaceAction,
  runWorkspaceChecksAction,
  startWorkspaceAction,
  stopWorkspaceAction,
} from "@/lib/actions/app-workspaces";
import { dangerButton, primaryButton, secondaryButton } from "@/lib/styles";

function Note({ state, idle }: { state: BuildState; idle?: string }) {
  if (state.status === "error") {
    return (
      <span className="text-danger" role="alert">
        {state.message}
      </span>
    );
  }
  if (state.status === "success") {
    return (
      <span className="text-mint">
        {state.message}
        {state.link ? (
          <>
            {" "}
            <a href={state.link} target="_blank" rel="noreferrer noopener" className="underline">
              Open preview
            </a>
          </>
        ) : null}
      </span>
    );
  }
  return idle ? <span className="text-muted">{idle}</span> : null;
}

export function StartWorkspaceForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(startWorkspaceAction, idleBuildState);
  return (
    <form action={formAction}>
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={primaryButton} pendingLabel="Starting the sandbox…">
        Start workspace and run checks
      </SubmitButton>
      <p className="mt-2 text-sm">
        <Note
          state={state}
          idle="Creates a fresh separate directory, installs from the pinned cache, then runs typecheck, lint and build."
        />
      </p>
    </form>
  );
}

export function RunChecksForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(runWorkspaceChecksAction, idleBuildState);
  return (
    <form action={formAction}>
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={secondaryButton} pendingLabel="Running checks…">
        Run checks again
      </SubmitButton>
      <p className="mt-2 text-sm">
        <Note state={state} idle="Reads the current stored files and reruns every configured check." />
      </p>
    </form>
  );
}

export function RepairWorkspaceForm({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState(repairWorkspaceAction, idleBuildState);
  return (
    <form action={formAction}>
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={secondaryButton} pendingLabel="Repairing one iteration…" disabled={disabled}>
        Repair one iteration
      </SubmitButton>
      <p className="mt-2 text-sm">
        <Note
          state={state}
          idle={`One AI repair costs ${operationChargeLabel("app_repair")}. Applies only existing source files, never tests or configs, then reruns every check. Maximum three attempts and six credits per workspace.`}
        />
      </p>
    </form>
  );
}

export function PreviewForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(previewWorkspaceAction, idleBuildState);
  return (
    <form action={formAction}>
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={primaryButton} pendingLabel="Starting the preview…">
        Start isolated preview
      </SubmitButton>
      <p className="mt-2 text-sm">
        <Note
          state={state}
          idle="Builds if needed, then serves the app on its own host with a signed, expiring link."
        />
      </p>
    </form>
  );
}

export function StopWorkspaceForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(stopWorkspaceAction, idleBuildState);
  return (
    <form action={formAction}>
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={dangerButton} pendingLabel="Stopping…">
        Stop and remove workspace
      </SubmitButton>
      <p className="mt-2 text-sm">
        <Note state={state} idle="Kills the sandbox and preview, then removes its directory." />
      </p>
    </form>
  );
}
