"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BuildState } from "@/lib/action-state";
import {
  COMPOSIO_LIMITS,
  parseActionArguments,
  type ComposioActionStatus,
} from "@/lib/composio/contracts";
import {
  ComposioOperationError,
  approveAction,
  beginConnection,
  cancelAction,
  discoverTools,
  disconnectConnection,
  executeApprovedAction,
  markExecutionUncertain,
  proposeAction,
  refreshConnectionStatus,
  saveGrant,
} from "@/lib/composio/adapter";
import { getSession } from "@/lib/auth";
import { isUuid, readText } from "@/lib/validation";

/**
 * Composio server actions.
 *
 * The browser sends a project id, a connection id, a granted tool and the JSON
 * arguments. It never sends a Composio user id, a session id, a provider token
 * or an approval hash. Approve and execute accept only an action id; the stored
 * record decides what may run.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

function fail(message: string): BuildState {
  return { status: "error", message: message.slice(0, 1_000), nonce: Date.now() };
}

function done(message: string): BuildState {
  return { status: "success", message: message.slice(0, 1_000), nonce: Date.now() };
}

function refresh(projectId: string): void {
  revalidatePath("/build");
  revalidatePath(`/build/${projectId}`);
  revalidatePath(`/build/${projectId}/connections`);
  revalidatePath(`/build/${projectId}/team`);
}

function safeError(error: unknown): string {
  if (error instanceof ComposioOperationError) {
    return error.message.slice(0, 1_000);
  }
  return "The Composio action stopped before it could finish. Nothing was retried.";
}

async function ownerProject(session: Session, projectId: string): Promise<boolean> {
  if (!isUuid(projectId)) return false;
  const { data } = await session.supabase
    .from("app_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return Boolean(data);
}

export async function connectComposioAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const toolkit = readText(formData, "toolkit");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  let redirectUrl = "";
  try {
    const started = await beginConnection(session, projectId, toolkit);
    redirectUrl = started.redirectUrl;
  } catch (error) {
    return fail(safeError(error));
  }

  // Outside the try/catch so Next's redirect control flow is not swallowed.
  redirect(redirectUrl);
}

export async function discoverComposioToolsAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const connectionId = readText(formData, "connection_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(connectionId)) return fail(NOT_AVAILABLE);

  try {
    const result = await discoverTools(session, connectionId);
    refresh(projectId);
    return done(
      `Discovered ${result.accepted} usable tool${result.accepted === 1 ? "" : "s"} from Composio (${result.discovered} returned). Choose at most ${COMPOSIO_LIMITS.maxEnabledGrantsPerConnection} to grant to an agent role.`,
    );
  } catch (error) {
    return fail(safeError(error));
  }
}

export async function saveComposioGrantAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const connectionId = readText(formData, "connection_id");
  const toolSlug = readText(formData, "tool_slug");
  const role = readText(formData, "role");
  const enabled = readText(formData, "enabled") !== "false";

  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(connectionId) || toolSlug === "" || role === "") return fail(NOT_AVAILABLE);

  try {
    await saveGrant(session, { projectId, connectionId, toolSlug, role, enabled });
    refresh(projectId);
    return done(
      enabled
        ? "Tool granted to that agent role. A granted tool still needs a separate proposal and your approval for exact arguments."
        : "Tool grant removed for that role.",
    );
  } catch (error) {
    return fail(safeError(error));
  }
}

export async function refreshComposioConnectionAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const connectionId = readText(formData, "connection_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(connectionId)) return fail(NOT_AVAILABLE);

  try {
    const status = await refreshConnectionStatus(session, connectionId);
    refresh(projectId);
    return status === "active"
      ? done("Composio reports the connection is active.")
      : done("Composio reports the connection is no longer active. Reconnect the account.");
  } catch (error) {
    return fail(safeError(error));
  }
}

export async function disconnectComposioAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const connectionId = readText(formData, "connection_id");
  const mode = readText(formData, "mode");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(connectionId) || (mode !== "revoke" && mode !== "remove")) return fail(NOT_AVAILABLE);

  try {
    await disconnectConnection(session, connectionId, mode);
    refresh(projectId);
    return mode === "revoke"
      ? done("Composio revoked the provider authorization. Grants are disabled and pending proposals were cancelled.")
      : done("The connection was removed from GET TO IT. The provider authorization was not revoked.");
  } catch (error) {
    return fail(safeError(error));
  }
}

function proposalKey(formData: FormData, fallback: string): string {
  const supplied = readText(formData, "idempotency_key");
  if (/^[A-Za-z0-9_-]{8,128}$/.test(supplied)) return supplied;
  return fallback;
}

export async function proposeComposioActionAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const connectionId = readText(formData, "connection_id");
  const toolSlug = readText(formData, "tool_slug");
  const role = readText(formData, "role");
  const taskId = readText(formData, "task_id");
  const argumentsText = readText(formData, "arguments");

  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(connectionId) || !isUuid(taskId) || toolSlug === "" || role === "") {
    return fail("Choose a connection, a granted tool, an agent role and one of that role's tasks.");
  }

  const parsed = parseActionArguments(argumentsText);
  if (!parsed.ok) return fail(parsed.message);

  try {
    const result = await proposeAction(session, {
      projectId,
      connectionId,
      toolSlug,
      role,
      taskId,
      arguments: parsed.value,
      idempotencyKey: proposalKey(formData, randomUUID().replace(/-/g, "")),
    });
    refresh(projectId);
    return done(
      result.replayed
        ? "That proposal already existed, so no duplicate was created."
        : "Proposal created. It cannot run until you approve exactly these arguments.",
    );
  } catch (error) {
    return fail(safeError(error));
  }
}

export async function approveComposioActionAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const actionId = readText(formData, "action_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(actionId)) return fail(NOT_AVAILABLE);

  try {
    await approveAction(session, actionId);
    refresh(projectId);
    return done(
      "Approved for exactly these arguments. Running it uses this approval once; any argument change needs a new proposal and a new approval.",
    );
  } catch (error) {
    return fail(safeError(error));
  }
}

export async function executeComposioActionAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const actionId = readText(formData, "action_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(actionId)) return fail(NOT_AVAILABLE);

  try {
    const outcome = await executeApprovedAction(session, actionId);
    refresh(projectId);
    return outcome.status === "succeeded" ? done(outcome.message) : fail(outcome.message);
  } catch (error) {
    return fail(safeError(error));
  }
}

export async function cancelComposioActionAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const actionId = readText(formData, "action_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(actionId)) return fail(NOT_AVAILABLE);

  try {
    await cancelAction(session, actionId);
    refresh(projectId);
    return done("Proposal cancelled. No provider call was made.");
  } catch (error) {
    return fail(safeError(error));
  }
}

export async function markComposioUncertainAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const actionId = readText(formData, "action_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(actionId)) return fail(NOT_AVAILABLE);

  try {
    await markExecutionUncertain(session, actionId);
    refresh(projectId);
    return done("Marked outcome uncertain. It will not be retried automatically; verify the provider first.");
  } catch (error) {
    return fail(safeError(error));
  }
}

export type { ComposioActionStatus };
