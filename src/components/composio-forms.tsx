"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  approveComposioActionAction,
  cancelComposioActionAction,
  connectComposioAction,
  disconnectComposioAction,
  discoverComposioToolsAction,
  executeComposioActionAction,
  markComposioUncertainAction,
  proposeComposioActionAction,
  refreshComposioConnectionAction,
  saveComposioGrantAction,
} from "@/lib/actions/composio";
import { TEAM_ROLE_LABELS, TEAM_ROLES, type TeamRole } from "@/lib/agent-team";
import {
  COMPOSIO_LIMITS,
  type ComposioAction,
  type ComposioConnection,
  type ComposioGrant,
  type ComposioTool,
} from "@/lib/composio/contracts";
import {
  dangerButton,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

/**
 * Client forms for Composio connections.
 *
 * Every mutation is a server action. These components never receive an API key,
 * a session reference, a provider token or an approval hash.
 */

function Message({ state }: { state: BuildState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={
        state.status === "error"
          ? "mt-2 rounded-lg border border-danger/30 bg-danger/5 p-2 text-sm text-danger"
          : "mt-2 rounded-lg border border-line bg-paper p-2 text-sm text-muted"
      }
    >
      {state.message}
    </p>
  );
}

function PendingButton({
  label,
  pendingLabel,
  className = primaryButton,
  value,
}: {
  label: string;
  pendingLabel: string;
  className?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={value ? "intent" : undefined} value={value}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function ConnectComposioForm({
  projectId,
  toolkit,
  label,
}: {
  projectId: string;
  toolkit: string;
  label: string;
}) {
  const [state, formAction] = useActionState(connectComposioAction, idleBuildState);
  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="toolkit" value={toolkit} />
      <PendingButton label={`Connect ${label}`} pendingLabel="Opening Composio…" />
      <Message state={state} />
    </form>
  );
}

export function DiscoverToolsForm({
  projectId,
  connectionId,
}: {
  projectId: string;
  connectionId: string;
}) {
  const [state, formAction] = useActionState(discoverComposioToolsAction, idleBuildState);
  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="connection_id" value={connectionId} />
      <PendingButton label="Discover tools" pendingLabel="Asking Composio…" className={secondaryButton} />
      <Message state={state} />
    </form>
  );
}

export function GrantToolForm({
  projectId,
  connectionId,
  toolSlug,
  roles,
}: {
  projectId: string;
  connectionId: string;
  toolSlug: string;
  roles: string[];
}) {
  const [state, formAction] = useActionState(saveComposioGrantAction, idleBuildState);
  const available = TEAM_ROLES.filter((role) => !roles.includes(role));
  if (available.length === 0) {
    return <p className="mt-1 text-xs text-muted">Granted to every agent role.</p>;
  }

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="connection_id" value={connectionId} />
      <input type="hidden" name="tool_slug" value={toolSlug} />
      <input type="hidden" name="enabled" value="true" />
      <label className="text-xs font-semibold">
        <span className="sr-only">Agent role for {toolSlug}</span>
        <select name="role" className={`${inputClass} min-h-9 py-1 text-xs`} defaultValue="frontend">
          {available.map((role) => (
            <option key={role} value={role}>
              {TEAM_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>
      <PendingButton label="Grant to role" pendingLabel="Saving…" className={secondaryButton} />
      <Message state={state} />
    </form>
  );
}

export function RevokeGrantForm({
  projectId,
  connectionId,
  toolSlug,
  role,
  label,
}: {
  projectId: string;
  connectionId: string;
  toolSlug: string;
  role: string;
  label: string;
}) {
  const [state, formAction] = useActionState(saveComposioGrantAction, idleBuildState);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="connection_id" value={connectionId} />
      <input type="hidden" name="tool_slug" value={toolSlug} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="enabled" value="false" />
      <button type="submit" className={quietButton} title={`Revoke this tool from ${label}`}>
        Revoke {label}
      </button>
      {state.status === "error" ? <Message state={state} /> : null}
    </form>
  );
}

export function ConnectionControls({
  projectId,
  connection,
}: {
  projectId: string;
  connection: ComposioConnection;
}) {
  const [refreshState, refreshAction] = useActionState(refreshComposioConnectionAction, idleBuildState);
  const [revokeState, revokeAction] = useActionState(disconnectComposioAction, idleBuildState);
  const [removeState, removeAction] = useActionState(disconnectComposioAction, idleBuildState);

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={refreshAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="connection_id" value={connection.id} />
          <PendingButton label="Check status" pendingLabel="Checking…" className={secondaryButton} />
        </form>
        <form
          action={revokeAction}
          onSubmit={(event) => {
            if (!window.confirm("Revoke the provider authorization? The external account will lose this app's access.")) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="connection_id" value={connection.id} />
          <input type="hidden" name="mode" value="revoke" />
          <PendingButton label="Revoke access" pendingLabel="Revoking…" className={dangerButton} />
        </form>
        <form
          action={removeAction}
          onSubmit={(event) => {
            if (!window.confirm("Remove locally? The provider authorization stays in place.")) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="connection_id" value={connection.id} />
          <input type="hidden" name="mode" value="remove" />
          <PendingButton label="Remove locally" pendingLabel="Removing…" className={secondaryButton} />
        </form>
      </div>
      <Message state={refreshState} />
      <Message state={revokeState} />
      <Message state={removeState} />
    </div>
  );
}

export function ProposeComposioActionForm({
  projectId,
  connections,
  tools,
  grants,
  tasks,
  idempotencyKey,
}: {
  projectId: string;
  connections: ComposioConnection[];
  tools: ComposioTool[];
  grants: ComposioGrant[];
  tasks: { id: string; role: string; position: number; status: string; objective: string }[];
  idempotencyKey: string;
}) {
  const [state, formAction] = useActionState(proposeComposioActionAction, idleBuildState);
  const [role, setRole] = useState<TeamRole>("frontend");
  const [connectionId, setConnectionId] = useState("");
  const [toolSlug, setToolSlug] = useState("");
  const [taskId, setTaskId] = useState("");

  const roleConnections = connections.filter(
    (connection) =>
      connection.status === "active" &&
      grants.some(
        (grant) => grant.enabled && grant.connection_id === connection.id && grant.role === role,
      ),
  );
  const effectiveConnection = roleConnections.some((entry) => entry.id === connectionId)
    ? connectionId
    : (roleConnections[0]?.id ?? "");

  const roleTools = tools.filter(
    (tool) =>
      tool.connection_id === effectiveConnection &&
      grants.some(
        (grant) =>
          grant.enabled &&
          grant.connection_id === tool.connection_id &&
          grant.tool_slug === tool.tool_slug &&
          grant.role === role,
      ),
  );
  const effectiveTool = roleTools.some((tool) => tool.tool_slug === toolSlug)
    ? toolSlug
    : (roleTools[0]?.tool_slug ?? "");
  const selectedTool = roleTools.find((tool) => tool.tool_slug === effectiveTool) ?? null;

  const roleTasks = tasks.filter(
    (task) =>
      task.role === role &&
      ["queued", "running", "blocked", "awaiting_review", "completed"].includes(task.status),
  );
  const effectiveTask = roleTasks.some((task) => task.id === taskId) ? taskId : (roleTasks[0]?.id ?? "");

  if (connections.length === 0) {
    return <p className="text-sm text-muted">Connect an account and discover tools first.</p>;
  }

  return (
    <form action={formAction} className="mt-3 space-y-4">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Agent role
          <select
            name="role"
            className={`${inputClass} mt-1`}
            value={role}
            onChange={(event) => setRole(event.target.value as TeamRole)}
          >
            {TEAM_ROLES.map((entry) => (
              <option key={entry} value={entry}>
                {TEAM_ROLE_LABELS[entry]}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          Connected account
          <select
            name="connection_id"
            className={`${inputClass} mt-1`}
            value={effectiveConnection}
            onChange={(event) => setConnectionId(event.target.value)}
          >
            {roleConnections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.account_label} ({connection.toolkit})
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          Granted tool
          <select
            name="tool_slug"
            className={`${inputClass} mt-1`}
            value={effectiveTool}
            onChange={(event) => setToolSlug(event.target.value)}
          >
            {roleTools.map((tool) => (
              <option key={tool.tool_slug} value={tool.tool_slug}>
                {tool.name} · {tool.tool_slug}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          Agent task
          <select
            name="task_id"
            className={`${inputClass} mt-1`}
            value={effectiveTask}
            onChange={(event) => setTaskId(event.target.value)}
          >
            {roleTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.position + 1}. {task.objective.slice(0, 70)} ({task.status})
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedTool ? <p className={hintClass}>{selectedTool.description || "No description returned by Composio."}</p> : null}

      {roleConnections.length === 0 || roleTools.length === 0 || roleTasks.length === 0 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          This role needs an active connection, an enabled tool grant and a current task before it can
          request an action.
        </p>
      ) : null}

      <label className={labelClass}>
        Exact tool arguments (JSON object)
        <textarea
          key={effectiveTool}
          name="arguments"
          rows={8}
          defaultValue="{}"
          spellCheck={false}
          className={`${inputClass} mt-1 font-mono text-xs`}
          placeholder={'{"owner": "your-org", "repo": "your-repo", "title": "..."}'}
        />
      </label>
      <p className={hintClass}>
        Arguments are stored as the proposal. Approval covers this exact object; there is no edit after
        approval. Maximum {Math.floor(COMPOSIO_LIMITS.maxArgumentsBytes / 1024)} KB.
      </p>

      <PendingButton label="Prepare action proposal" pendingLabel="Preparing…" />
      <Message state={state} />
    </form>
  );
}

export function ActionControls({
  projectId,
  action,
}: {
  projectId: string;
  action: ComposioAction;
}) {
  const [approveState, approveFormAction] = useActionState(approveComposioActionAction, idleBuildState);
  const [executeState, executeFormAction] = useActionState(executeComposioActionAction, idleBuildState);
  const [cancelState, cancelFormAction] = useActionState(cancelComposioActionAction, idleBuildState);
  const [uncertainState, uncertainFormAction] = useActionState(markComposioUncertainAction, idleBuildState);

  if (action.status === "proposed") {
    return (
      <div className="mt-2">
        <div className="flex flex-wrap gap-2">
          <form
            action={approveFormAction}
            onSubmit={(event) => {
              if (
                !window.confirm(
                  "Approve exactly these arguments? Running the action will send them to the provider.",
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="action_id" value={action.id} />
            <PendingButton label="Approve these exact arguments" pendingLabel="Approving…" />
          </form>
          <form action={cancelFormAction}>
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="action_id" value={action.id} />
            <PendingButton label="Cancel proposal" pendingLabel="Cancelling…" className={secondaryButton} />
          </form>
        </div>
        <Message state={approveState} />
        <Message state={cancelState} />
      </div>
    );
  }

  if (action.status === "approved") {
    return (
      <div className="mt-2">
        <div className="flex flex-wrap gap-2">
          <form
            action={executeFormAction}
            onSubmit={(event) => {
              if (!window.confirm("Run this approved action now? It will contact the external provider.")) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="action_id" value={action.id} />
            <PendingButton label="Run approved action" pendingLabel="Running…" />
          </form>
          <form action={cancelFormAction}>
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="action_id" value={action.id} />
            <PendingButton label="Cancel before it runs" pendingLabel="Cancelling…" className={secondaryButton} />
          </form>
        </div>
        <Message state={executeState} />
        <Message state={cancelState} />
      </div>
    );
  }

  if (action.status === "executing") {
    return (
      <div className="mt-2">
        <p className="text-xs text-muted">
          In flight. It is never retried automatically. If it has been more than a minute without a
          result, mark the outcome uncertain and check the provider before retrying.
        </p>
        <form action={uncertainFormAction} className="mt-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="action_id" value={action.id} />
          <PendingButton
            label="Mark outcome uncertain"
            pendingLabel="Recording…"
            className={secondaryButton}
          />
        </form>
        <Message state={uncertainState} />
      </div>
    );
  }

  return null;
}
