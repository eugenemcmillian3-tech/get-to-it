import { randomBytes } from "node:crypto";
import type { Session } from "@/lib/auth";
import {
  COMPOSIO_LIMITS,
  COMPOSIO_SETUP_MESSAGE,
  approvalCoversAction,
  canCancelAction,
  completionForThrownError,
  composioToolkit,
  composioUserId,
  isComposioToolkit,
  isValidConnectedAccountId,
  isValidToolSlug,
  providerErrorCategory,
  redactProviderResult,
  safeProviderMessage,
  type ComposioAction,
  type ComposioActionStatus,
  type ComposioConnection,
  type ComposioGrant,
  type ComposioTool,
  type ComposioToolkit,
} from "@/lib/composio/contracts";
import {
  ComposioConfigError,
  getComposioClient,
  isComposioConfigured,
  requireAppOrigin,
  sessionIdOf,
  type ComposioConnectedAccountLike,
  type ComposioSessionLike,
} from "@/lib/composio/sdk";

/**
 * Server-side Composio adapter.
 *
 * Every operation starts from the authenticated Supabase session and the
 * project owner check. The Composio user id is derived from the app user id,
 * never from a form field. Provider tokens and session MCP URLs never leave
 * this layer, and no raw provider error is returned to the browser.
 *
 * This sits behind the same approval boundary as the existing connector model:
 * a proposal is a stored, exact argument object; approval binds its hash; a
 * conditional claim gives it one execution attempt. There is no generic
 * "execute any tool" operation exposed to an agent.
 */

const NOT_AVAILABLE = "That app project is not available to you.";

export class ComposioOperationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ComposioOperationError";
    this.code = code;
  }
}

function isEnabled(): boolean {
  return isComposioConfigured();
}

export function composioAvailable(): boolean {
  return isEnabled();
}

async function rpc<T>(session: Session, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await session.supabase.rpc(name, args);
  if (error) {
    throw new ComposioOperationError("rpc_failed", "The connection operation could not be recorded. Try again.");
  }
  return data as T;
}

type RpcResult = {
  ok?: boolean;
  code?: string;
  message?: string;
  [key: string]: unknown;
};

function unwrap(data: RpcResult, fallback: string): RpcResult {
  if (!data || data.ok !== true) {
    throw new ComposioOperationError(data?.code ?? "failed", data?.message ?? fallback);
  }
  return data;
}

export async function getProject(session: Session, projectId: string) {
  const { data, error } = await session.supabase
    .from("app_projects")
    .select("id, name, purpose")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) console.error("composio project read failed:", error.message);
  return data as { id: string; name: string; purpose: string } | null;
}

async function connectionFor(session: Session, connectionId: string): Promise<ComposioConnection> {
  const { data, error } = await session.supabase
    .from("app_composio_connections")
    .select("id, project_id, toolkit, account_label, status, last_verified_at, created_at")
    .eq("id", connectionId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !data) throw new ComposioOperationError("not_found", "That connection is not available.");
  return data as unknown as ComposioConnection;
}

async function getOrCreateSession(
  session: Session,
  projectId: string,
  toolkit: ComposioToolkit,
): Promise<ComposioSessionLike> {
  const origin = requireAppOrigin();
  const client = await getComposioClient();

  const { data: saved } = await session.supabase
    .from("app_composio_sessions")
    .select("session_id")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .eq("toolkit", toolkit)
    .maybeSingle();

  if (saved?.session_id) {
    try {
      return await client.use(saved.session_id as string);
    } catch {
      // A provider-side session can disappear. Fall through to a fresh one.
    }
  }

  const created = await client.create(composioUserId(session.user.id), {
    toolkits: [toolkit],
    manageConnections: { callbackUrl: `${origin}/api/composio/callback` },
  });

  const id = sessionIdOf(created);
  if (!id) {
    throw new ComposioOperationError("session_failed", "Composio did not return a session reference.");
  }

  await rpc(session, "composio_save_session", {
    p_project_id: projectId,
    p_toolkit: toolkit,
    p_session_id: id,
  });

  return created;
}

/**
 * Starts a hosted authorization. The return destination is stored server-side
 * and restricted to this project's connections page; no query parameter can
 * redirect elsewhere.
 */
export async function beginConnection(
  session: Session,
  projectId: string,
  toolkit: string,
): Promise<{ redirectUrl: string }> {
  if (!isEnabled()) throw new ComposioOperationError("not_configured", COMPOSIO_SETUP_MESSAGE);
  if (!isComposioToolkit(toolkit)) {
    throw new ComposioOperationError("unsupported_toolkit", "That integration is not supported.");
  }
  if (!(await getProject(session, projectId))) {
    throw new ComposioOperationError("not_found", NOT_AVAILABLE);
  }

  const state = randomBytes(32).toString("hex");
  const origin = requireAppOrigin();
  const returnPath = `/build/${projectId}/connections`;

  const started = unwrap(
    await rpc<RpcResult>(session, "composio_begin_auth", {
      p_project_id: projectId,
      p_toolkit: toolkit,
      p_state: state,
      p_return_path: returnPath,
    }),
    "The connection could not be started.",
  );

  const attempt = started.attempt as { id?: string } | undefined;
  if (!attempt?.id) {
    throw new ComposioOperationError("attempt_failed", "The connection attempt was not recorded.");
  }

  const callbackUrl = `${origin}/api/composio/callback?attempt=${encodeURIComponent(attempt.id)}&state=${state}`;

  try {
    const composioSession = await getOrCreateSession(session, projectId, toolkit);
    const request = await composioSession.authorize(toolkit, { callbackUrl });
    const redirectUrl = typeof request.redirectUrl === "string" ? request.redirectUrl : "";
    if (!/^https:\/\//.test(redirectUrl)) {
      throw new ComposioOperationError("authorization_failed", "Composio did not return a secure authorization link.");
    }
    return { redirectUrl };
  } catch (error) {
    if (error instanceof ComposioConfigError) {
      throw new ComposioOperationError("not_configured", error.message);
    }
    if (error instanceof ComposioOperationError) throw error;
    throw new ComposioOperationError(
      "authorization_failed",
      "The authorization link could not be created. Check the Composio project and try again.",
    );
  }
}

export type CallbackResult =
  | { ok: true; projectId: string; status: "connected" | "cancelled" }
  | { ok: false; projectId: string | null; message: string };

function accountUserId(account: ComposioConnectedAccountLike): string {
  if (typeof account.userId === "string") return account.userId;
  if (typeof account.user_id === "string") return account.user_id;
  return "";
}

function accountToolkit(account: ComposioConnectedAccountLike): string {
  if (typeof account.toolkit?.slug === "string") return account.toolkit.slug;
  if (typeof account.toolkitSlug === "string") return account.toolkitSlug;
  if (typeof account.toolkit_slug === "string") return account.toolkit_slug;
  return "";
}

function accountStatus(account: ComposioConnectedAccountLike): string {
  return typeof account.status === "string" ? account.status.toUpperCase() : "";
}

function accountLabel(account: ComposioConnectedAccountLike, toolkit: string, id: string): string {
  const label =
    (typeof account.alias === "string" && account.alias.trim()) ||
    (typeof account.name === "string" && account.name.trim()) ||
    composioToolkit(toolkit)?.label ||
    toolkit;
  return `${label.slice(0, 100)} · …${id.slice(-4)}`;
}

/**
 * Completes authorization only for the signed-in owner. Query parameters are
 * not trusted on their own: the attempt, its stored state and the provider's
 * connected-account owner are all checked.
 */
export async function completeConnection(
  session: Session,
  params: {
    attemptId: string;
    state: string;
    providerStatus: string;
    connectedAccountId: string;
  },
): Promise<CallbackResult> {
  const { data: attempt, error } = await session.supabase
    .from("app_composio_auth_attempts")
    .select("id, project_id, toolkit, status")
    .eq("id", params.attemptId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !attempt) {
    return { ok: false, projectId: null, message: "That connection attempt was not found." };
  }

  const projectId = attempt.project_id as string;
  const toolkit = attempt.toolkit as string;

  if (attempt.status !== "pending") {
    return { ok: false, projectId, message: "That connection attempt was already used or expired." };
  }

  if (params.providerStatus !== "success") {
    const cancelled = params.providerStatus === "cancelled" || params.providerStatus === "denied";
    unwrap(
      await rpc<RpcResult>(session, "composio_finish_auth", {
        p_attempt_id: params.attemptId,
        p_state: params.state,
        p_status: cancelled ? "cancelled" : "failed",
        p_connected_account_id: null,
        p_account_label: cancelled ? "Authorization cancelled." : "Authorization was not completed.",
      }),
      "The connection result could not be recorded.",
    );
    return cancelled
      ? { ok: true, projectId, status: "cancelled" }
      : { ok: false, projectId, message: "The provider did not complete the connection." };
  }

  if (!isValidConnectedAccountId(params.connectedAccountId)) {
    return { ok: false, projectId, message: "The provider returned no usable connected account." };
  }

  if (!isEnabled()) {
    return { ok: false, projectId, message: COMPOSIO_SETUP_MESSAGE };
  }

  let account: ComposioConnectedAccountLike;
  try {
    const client = await getComposioClient();
    account = await client.connectedAccounts.get(params.connectedAccountId);
  } catch {
    return { ok: false, projectId, message: "The connected account could not be verified with Composio." };
  }

  if (accountUserId(account) !== composioUserId(session.user.id)) {
    return { ok: false, projectId, message: "That connected account belongs to a different user." };
  }

  const providerToolkit = accountToolkit(account);
  if (providerToolkit !== "" && providerToolkit !== toolkit) {
    return { ok: false, projectId, message: "The connected account does not match the requested integration." };
  }

  if (accountStatus(account) !== "ACTIVE") {
    return { ok: false, projectId, message: "The provider has not marked the connection active yet. Refresh in a moment." };
  }

  const finished = await rpc<RpcResult>(session, "composio_finish_auth", {
    p_attempt_id: params.attemptId,
    p_state: params.state,
    p_status: "completed",
    p_connected_account_id: params.connectedAccountId,
    p_account_label: accountLabel(account, toolkit, params.connectedAccountId),
  });

  if (!finished.ok) {
    return { ok: false, projectId, message: finished.message ?? "The connection could not be saved." };
  }

  return { ok: true, projectId, status: "connected" };
}

export async function listConnections(session: Session, projectId: string): Promise<ComposioConnection[]> {
  const data = unwrap(
    await rpc<RpcResult>(session, "composio_list_connections", { p_project_id: projectId }),
    "Connections could not be loaded.",
  );
  return (data.connections ?? []) as ComposioConnection[];
}

export async function refreshConnectionStatus(session: Session, connectionId: string): Promise<string> {
  if (!isEnabled()) throw new ComposioOperationError("not_configured", COMPOSIO_SETUP_MESSAGE);
  const connection = await connectionFor(session, connectionId);
  if (connection.status === "removed" || connection.status === "revoked") {
    throw new ComposioOperationError("connection_inactive", "That connection is no longer active.");
  }

  let account: ComposioConnectedAccountLike;
  try {
    const client = await getComposioClient();
    account = await client.connectedAccounts.get(
      (await session.supabase
        .from("app_composio_connections")
        .select("connected_account_id")
        .eq("id", connection.id)
        .eq("user_id", session.user.id)
        .maybeSingle()).data?.connected_account_id as string,
    );
  } catch {
    throw new ComposioOperationError("provider_unavailable", "Composio could not be reached, so the stored status was kept.");
  }

  const status = accountStatus(account) === "ACTIVE" ? "active" : "expired";
  await rpc(session, "composio_update_connection", {
    p_connection_id: connection.id,
    p_status: status,
  });
  return status;
}

export async function disconnectConnection(
  session: Session,
  connectionId: string,
  mode: "revoke" | "remove",
): Promise<string> {
  const connection = await connectionFor(session, connectionId);

  if (mode === "revoke") {
    if (!isEnabled()) throw new ComposioOperationError("not_configured", COMPOSIO_SETUP_MESSAGE);
    const { data: row } = await session.supabase
      .from("app_composio_connections")
      .select("connected_account_id")
      .eq("id", connection.id)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (!row?.connected_account_id) {
      throw new ComposioOperationError("not_found", "That connection is not available.");
    }

    try {
      const client = await getComposioClient();
      await client.connectedAccounts.revoke(row.connected_account_id as string);
    } catch {
      throw new ComposioOperationError(
        "revoke_failed",
        "Composio did not confirm the revocation, so the connection was left in place. You can remove it locally instead.",
      );
    }
  }

  const result = unwrap(
    await rpc<RpcResult>(session, "composio_disconnect", {
      p_connection_id: connection.id,
      p_mode: mode,
    }),
    "The connection could not be disconnected.",
  );

  return (result.status as string) ?? mode;
}

export async function discoverTools(
  session: Session,
  connectionId: string,
): Promise<{ discovered: number; accepted: number }> {
  if (!isEnabled()) throw new ComposioOperationError("not_configured", COMPOSIO_SETUP_MESSAGE);
  const connection = await connectionFor(session, connectionId);
  if (connection.status !== "active") {
    throw new ComposioOperationError("connection_inactive", "Reconnect that account before discovering tools.");
  }

  let raw: unknown;
  try {
    const client = await getComposioClient();
    raw = await client.tools.getRawComposioTools({
      toolkits: [connection.toolkit],
      limit: COMPOSIO_LIMITS.maxDiscoveredTools,
    });
  } catch {
    throw new ComposioOperationError("provider_unavailable", "Composio could not list tools for that account. Try again.");
  }

  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { items?: unknown[] })?.items)
      ? (raw as { items: unknown[] }).items
      : [];

  const seen = new Set<string>();
  const tools: { slug: string; name: string; description: string }[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const slug = typeof record.slug === "string" ? record.slug : "";
    const name = typeof record.name === "string" ? record.name : "";
    const description = typeof record.description === "string" ? record.description : "";
    if (!isValidToolSlug(connection.toolkit, slug) || name.trim() === "" || seen.has(slug)) continue;
    seen.add(slug);
    tools.push({ slug, name: name.slice(0, 160), description: description.slice(0, 800) });
    if (tools.length >= COMPOSIO_LIMITS.maxDiscoveredTools) break;
  }

  if (tools.length === 0) {
    throw new ComposioOperationError(
      "no_tools",
      "Composio returned no tools for that account. Check the account's permissions and try again.",
    );
  }

  const result = unwrap(
    await rpc<RpcResult>(session, "composio_replace_tools", {
      p_connection_id: connection.id,
      p_tools: tools,
    }),
    "The discovered tools could not be saved.",
  );

  return { discovered: list.length, accepted: Number(result.count ?? tools.length) };
}

export async function saveGrant(
  session: Session,
  input: {
    projectId: string;
    connectionId: string;
    toolSlug: string;
    role: string;
    enabled: boolean;
  },
): Promise<void> {
  unwrap(
    await rpc<RpcResult>(session, "composio_save_grant", {
      p_project_id: input.projectId,
      p_connection_id: input.connectionId,
      p_tool_slug: input.toolSlug,
      p_role: input.role,
      p_enabled: input.enabled,
    }),
    "The tool grant could not be saved.",
  );
}

export type ProposeInput = {
  projectId: string;
  connectionId: string;
  toolSlug: string;
  role: string;
  taskId: string;
  arguments: Record<string, unknown>;
  idempotencyKey: string;
};

/**
 * Creates a proposal only for an enabled grant and a real task owned by this
 * user. The preview shows the complete argument object that will be approved.
 */
export async function proposeAction(
  session: Session,
  input: ProposeInput,
): Promise<{ actionId: string; status: ComposioActionStatus; replayed: boolean }> {
  const connection = await connectionFor(session, input.connectionId);
  if (connection.status !== "active") {
    throw new ComposioOperationError("connection_inactive", "That connection is not active.");
  }

  const { data: tool } = await session.supabase
    .from("app_composio_tools")
    .select("tool_slug, name")
    .eq("connection_id", connection.id)
    .eq("user_id", session.user.id)
    .eq("tool_slug", input.toolSlug)
    .maybeSingle();

  if (!tool) {
    throw new ComposioOperationError("unknown_tool", "Discover tools first, then choose one of them.");
  }

  const { data: task } = await session.supabase
    .from("app_team_tasks")
    .select("id, role, objective, position")
    .eq("id", input.taskId)
    .eq("project_id", input.projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!task) {
    throw new ComposioOperationError("task_not_found", "Choose a current agent task for this role.");
  }
  if (task.role !== input.role) {
    throw new ComposioOperationError("task_not_found", "That task belongs to a different agent role.");
  }

  const pretty = JSON.stringify(input.arguments, null, 2);
  const preview = [
    `${tool.name} (${connection.toolkit}) on ${connection.account_label}`,
    `Agent role: ${input.role}`,
    `Task ${Number(task.position) + 1}: ${String(task.objective).slice(0, 200)}`,
    `Arguments: ${pretty}`,
  ]
    .join("\n")
    .slice(0, 4_000);

  const result = unwrap(
    await rpc<RpcResult>(session, "composio_propose_action", {
      p_project_id: input.projectId,
      p_connection_id: connection.id,
      p_tool_slug: input.toolSlug,
      p_role: input.role,
      p_task_id: input.taskId,
      p_arguments: input.arguments,
      p_preview: preview,
      p_idempotency_key: input.idempotencyKey,
    }),
    "The action proposal could not be created.",
  );

  return {
    actionId: String(result.action_id),
    status: (result.status as ComposioActionStatus) ?? "proposed",
    replayed: Boolean(result.replayed),
  };
}

async function actionFor(session: Session, actionId: string): Promise<ComposioAction> {
  const { data, error } = await session.supabase
    .from("app_composio_actions")
    .select("*")
    .eq("id", actionId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error || !data) throw new ComposioOperationError("not_found", "That action is not available.");
  return data as ComposioAction;
}

export async function approveAction(session: Session, actionId: string): Promise<void> {
  const action = await actionFor(session, actionId);
  if (action.status !== "proposed") {
    throw new ComposioOperationError("invalid_state", "That proposal is not waiting for approval.");
  }
  unwrap(
    await rpc<RpcResult>(session, "composio_approve_action", { p_action_id: action.id }),
    "The approval could not be recorded.",
  );
}

export async function cancelAction(session: Session, actionId: string): Promise<void> {
  const action = await actionFor(session, actionId);
  if (!canCancelAction(action.status)) {
    throw new ComposioOperationError("invalid_state", "Only a proposal that has not started can be cancelled.");
  }
  unwrap(
    await rpc<RpcResult>(session, "composio_cancel_action", { p_action_id: action.id }),
    "The action could not be cancelled.",
  );
}

export type ExecutionOutcome = {
  status: "succeeded" | "failed" | "uncertain";
  message: string;
};

/**
 * Executes one approved action. The provider call happens only after an atomic
 * claim, so two clicks cannot send twice. A timeout or network failure is
 * recorded as uncertain and is never retried by this function.
 */
export async function executeApprovedAction(
  session: Session,
  actionId: string,
): Promise<ExecutionOutcome> {
  if (!isEnabled()) throw new ComposioOperationError("not_configured", COMPOSIO_SETUP_MESSAGE);
  const action = await actionFor(session, actionId);

  if (action.status === "succeeded") {
    return { status: "succeeded", message: "That action already completed. Nothing was sent again." };
  }
  if (action.status === "executing") {
    throw new ComposioOperationError("already_executing", "That action is already running.");
  }
  if (
    !approvalCoversAction({
      status: action.status,
      argumentsHash: action.arguments_hash,
      approvalHash: action.approval_hash,
      approvedAt: action.approved_at,
    })
  ) {
    throw new ComposioOperationError(
      "approval_required",
      "That action is not approved for exactly its stored arguments. Approve it again.",
    );
  }

  const connection = await connectionFor(session, action.connection_id);
  if (connection.status !== "active") {
    throw new ComposioOperationError("connection_inactive", "That connection is no longer active.");
  }

  // Build the session before claiming so a missing key does not consume a claim.
  const composioSession = await getOrCreateSession(session, connection.project_id, connection.toolkit);

  const claimed = unwrap(
    await rpc<RpcResult>(session, "composio_claim_action", { p_action_id: action.id }),
    "The action could not be started.",
  );

  const claimedAction = claimed.action as {
    tool_slug: string;
    arguments: Record<string, unknown>;
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPOSIO_LIMITS.executionTimeoutMs);

  try {
    const result = await composioSession.execute(
      claimedAction.tool_slug,
      claimedAction.arguments,
      undefined,
      { signal: controller.signal },
    );
    clearTimeout(timer);

    if (result.resultType !== "completed") {
      const category = providerErrorCategory(result.error);
      const message = safeProviderMessage(result.error);
      await rpc(session, "composio_complete_action", {
        p_action_id: action.id,
        p_status: "failed",
        p_result: null,
        p_provider_ref: result.logId ?? null,
        p_error_code: category,
        p_error_message: message ?? "The provider did not complete the action.",
      });
      return {
        status: "failed",
        message:
          category === "needs_input"
            ? "Composio needs more input before this tool can run. Nothing was retried; create a new proposal with the required fields."
            : `Composio did not complete the action (${category}). Nothing was retried.`,
      };
    }

    const redacted = redactProviderResult(result.data ?? null);
    await rpc(session, "composio_complete_action", {
      p_action_id: action.id,
      p_status: "succeeded",
      p_result: redacted.value,
      p_provider_ref: result.logId ?? null,
      p_error_code: null,
      p_error_message: null,
    });

    return {
      status: "succeeded",
      message: redacted.truncated
        ? "The action completed. The stored result was shortened and sensitive fields were removed."
        : "The action completed. The stored result excludes provider credentials.",
    };
  } catch (error) {
    clearTimeout(timer);
    const { status, code } = completionForThrownError(error);
    const message = safeProviderMessage(error instanceof Error ? error.message : String(error));

    try {
      await rpc(session, "composio_complete_action", {
        p_action_id: action.id,
        p_status: status,
        p_result: null,
        p_provider_ref: null,
        p_error_code: code,
        p_error_message: message ?? "The provider call did not return a usable result.",
      });
    } catch {
      // Leave the row executing rather than pretending it finished.
      return {
        status: "uncertain",
        message:
          "The provider call did not finish cleanly and the outcome could not be recorded. Do not retry; check the provider before creating a new proposal.",
      };
    }

    if (status === "uncertain") {
      return {
        status,
        message:
          "The provider may have received this call (timeout or network failure). It is marked uncertain and will not be retried automatically. Check the provider first.",
      };
    }

    return { status, message: `The tool call failed (${code}). Nothing was retried.` };
  }
}

/**
 * Resolves an in-flight row that never reported a result. Only the owner can do
 * this, only after a minute, and it records uncertainty rather than success.
 */
export async function markExecutionUncertain(session: Session, actionId: string): Promise<void> {
  const action = await actionFor(session, actionId);
  if (action.status !== "executing") {
    throw new ComposioOperationError("invalid_state", "That action is not in flight.");
  }
  if (action.started_at && Date.now() - Date.parse(action.started_at) < 60_000) {
    throw new ComposioOperationError("too_early", "Wait a minute before marking an in-flight action uncertain.");
  }

  unwrap(
    await rpc<RpcResult>(session, "composio_complete_action", {
      p_action_id: action.id,
      p_status: "uncertain",
      p_result: null,
      p_provider_ref: null,
      p_error_code: "abandoned",
      p_error_message: "The execution stopped reporting. The outcome is unknown; no retry was attempted.",
    }),
    "The action could not be updated.",
  );
}

export type { ComposioAction, ComposioConnection, ComposioGrant, ComposioTool };
