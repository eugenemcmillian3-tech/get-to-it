"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  approveDeploymentAction,
  connectGitHubAction,
  connectSupabaseAction,
  connectVercelAction,
  createDeploymentPlanAction,
  disconnectProviderAction,
  refreshDeploymentAction,
  redeploySnapshotAction,
  runDeploymentPrechecksAction,
  setEnvValueAction,
} from "@/lib/actions/app-deployments";
import { dangerButton, inputClass, primaryButton, secondaryButton } from "@/lib/styles";
import type { AppProvider } from "@/lib/types";
import type { DeploymentTarget } from "@/lib/deployments";

function Note({ state }: { state: BuildState }) {
  if (state.status === "error") return <span className="text-sm text-danger" role="alert">{state.message}</span>;
  if (state.status === "success") {
    return (
      <span className="text-sm text-mint">
        {state.message}
        {state.link ? (
          <>
            {" "}
            <a href={state.link} target="_blank" rel="noreferrer noopener" className="underline">
              Open deployment
            </a>
          </>
        ) : null}
      </span>
    );
  }
  return <span className="text-sm text-muted">No external action yet.</span>;
}

export function GitHubConnectionForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(connectGitHubAction, idleBuildState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block text-sm font-semibold">
        Scoped GitHub token
        <input name="token" type="password" autoComplete="new-password" required className={`${inputClass} mt-1`} placeholder="github_pat_…" />
      </label>
      <label className="block text-sm font-semibold">
        Repository (owner/name)
        <input name="repo" required className={`${inputClass} mt-1`} placeholder="your-name/your-app" />
      </label>
      <label className="block text-sm font-semibold">
        Branch
        <input name="branch" defaultValue="main" required className={`${inputClass} mt-1`} />
      </label>
      <p className="text-xs leading-relaxed text-muted">
        Use a fine-grained token limited to this repository with Contents read/write and Metadata read. It is encrypted on the server and never shown again.
      </p>
      <SubmitButton className={primaryButton} pendingLabel="Checking GitHub…">Connect GitHub</SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function VercelConnectionForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(connectVercelAction, idleBuildState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block text-sm font-semibold">
        Scoped Vercel token
        <input name="token" type="password" autoComplete="new-password" required className={`${inputClass} mt-1`} />
      </label>
      <label className="block text-sm font-semibold">
        Vercel project id or name
        <input name="project" required className={`${inputClass} mt-1`} placeholder="prj_… or my-app" />
      </label>
      <label className="block text-sm font-semibold">
        Team id (only if the project belongs to a team)
        <input name="team_id" className={`${inputClass} mt-1`} placeholder="team_…" />
      </label>
      <p className="text-xs leading-relaxed text-muted">
        Use a token limited to this Vercel account or team and project. It is encrypted on the server and never shown again.
      </p>
      <SubmitButton className={primaryButton} pendingLabel="Checking Vercel…">Connect Vercel</SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function SupabaseConnectionForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(connectSupabaseAction, idleBuildState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block text-sm font-semibold">
        Development Postgres URL
        <input name="development_url" type="password" autoComplete="new-password" required className={`${inputClass} mt-1`} placeholder="postgresql://role:…@host:5432/db?sslmode=require" />
      </label>
      <label className="block text-sm font-semibold">
        Production Postgres URL
        <input name="production_url" type="password" autoComplete="new-password" required className={`${inputClass} mt-1`} placeholder="postgresql://role:…@host:5432/db?sslmode=require" />
      </label>
      <p className="text-xs leading-relaxed text-muted">
        Use two different Supabase projects and a dedicated migration role, not the postgres superuser. Include sslmode=require. Preview deployments never apply production migrations.
      </p>
      <SubmitButton className={primaryButton} pendingLabel="Checking databases…">Connect Supabase</SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function DisconnectForm({ projectId, provider }: { projectId: string; provider: AppProvider }) {
  const [state, action] = useActionState(disconnectProviderAction, idleBuildState);
  return (
    <form action={action}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="provider" value={provider} />
      <SubmitButton className={dangerButton} pendingLabel="Disconnecting…">Disconnect {provider}</SubmitButton>
      <p className="mt-1"><Note state={state} /></p>
    </form>
  );
}

export function EnvValueForm({
  projectId,
  environment,
  name,
  visibility,
  set,
}: {
  projectId: string;
  environment: "preview" | "production";
  name: string;
  visibility: "public" | "server";
  set: boolean;
}) {
  const [state, action] = useActionState(setEnvValueAction, idleBuildState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-t border-line py-2 first:border-0">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="environment" value={environment} />
      <input type="hidden" name="name" value={name} />
      <div className="min-w-52 flex-1">
        <p className="break-all font-mono text-xs font-semibold">{name}</p>
        <p className="text-xs text-muted">{visibility === "public" ? "Public (NEXT_PUBLIC_)" : "Server-only"} · {set ? "set" : "missing"}</p>
      </div>
      <label className="min-w-52 flex-1 text-xs font-medium">
        {set ? "Replace value" : "Value"}
        <input name="value" type="password" autoComplete="new-password" required className={`${inputClass} mt-1`} />
      </label>
      <SubmitButton className={secondaryButton} pendingLabel="Saving…">{set ? "Replace" : "Save"}</SubmitButton>
      <div className="w-full"><Note state={state} /></div>
    </form>
  );
}

export function CreatePlanForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(createDeploymentPlanAction, idleBuildState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block text-sm font-semibold">
        Target
        <select name="target" defaultValue="preview" className={`${inputClass} mt-1`}>
          <option value="preview">Preview — no production migrations</option>
          <option value="production">Production — may apply approved production migrations</option>
        </select>
      </label>
      <p className="text-xs leading-relaxed text-muted">
        Creating a plan makes no external change. It pins the exact source digest, provider targets, environment names and migration preview.
      </p>
      <SubmitButton className={primaryButton} pendingLabel="Building the plan…">Create deployment plan</SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function PrecheckForm({ projectId, deploymentId }: { projectId: string; deploymentId: string }) {
  const [state, action] = useActionState(runDeploymentPrechecksAction, idleBuildState);
  return (
    <form action={action}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="deployment_id" value={deploymentId} />
      <SubmitButton className={secondaryButton} pendingLabel="Running pre-deploy checks…">Run pre-deploy checks</SubmitButton>
      <p className="mt-1"><Note state={state} /></p>
    </form>
  );
}

export function ApproveDeploymentForm({
  projectId,
  deploymentId,
  planHash,
  disabled,
}: {
  projectId: string;
  deploymentId: string;
  planHash: string;
  disabled: boolean;
}) {
  const [state, action] = useActionState(approveDeploymentAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="deployment_id" value={deploymentId} />
      <input type="hidden" name="plan_hash" value={planHash} />
      <label className="block text-sm font-semibold">
        Type <code>DEPLOY</code> to approve these exact external actions
        <input name="confirmation" autoComplete="off" required className={`${inputClass} mt-1 max-w-xs`} />
      </label>
      <SubmitButton className={dangerButton} pendingLabel="Approved; running the pipeline…" disabled={disabled}>
        Approve and start deployment
      </SubmitButton>
      <p className="text-xs text-muted">
        This approval is bound to fingerprint <code>{planHash.slice(0, 16)}…</code>. If files, providers, environment names or migration preview change, approval is refused.
      </p>
      <Note state={state} />
    </form>
  );
}

export function RefreshDeploymentForm({ projectId, deploymentId }: { projectId: string; deploymentId: string }) {
  const [state, action] = useActionState(refreshDeploymentAction, idleBuildState);
  return (
    <form action={action}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="deployment_id" value={deploymentId} />
      <SubmitButton className={secondaryButton} pendingLabel="Polling the host…">Poll status and smoke-check</SubmitButton>
      <p className="mt-1"><Note state={state} /></p>
    </form>
  );
}

export function RedeploySnapshotForm({
  projectId,
  deploymentId,
  target,
}: {
  projectId: string;
  deploymentId: string;
  target: DeploymentTarget;
}) {
  const [state, action] = useActionState(redeploySnapshotAction, idleBuildState);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="deployment_id" value={deploymentId} />
      <input type="hidden" name="target" value={target} />
      <SubmitButton className={secondaryButton} pendingLabel="Creating a new plan…">Redeploy this source snapshot</SubmitButton>
      <p className="mt-1"><Note state={state} /></p>
    </form>
  );
}
