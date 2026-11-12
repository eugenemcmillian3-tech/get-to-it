"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { getSession, type Session } from "@/lib/auth";
import {
  SLACK_LIMITS,
  SLACK_LIST_TOOL,
  SLACK_SEND_TOOL,
  buildSlackMessageDraft,
  channelLabelFromListResult,
  channelProblem,
  draftProblems,
  isSlackRecordKind,
  messageFingerprint,
  messageFromProviderResult,
  normalizedChannel,
  sendBlocker,
} from "@/lib/connectors/slack-messages";
import { composioUserId } from "@/lib/composio/contracts";
import { getComposioClient, isComposioConfigured, sessionIdOf } from "@/lib/composio/sdk";
import { isUuid, readText } from "@/lib/validation";

/**
 * Slack milestone summaries: one record, one channel, one message.
 *
 * The transport is the existing Composio path and the state machine is in
 * Postgres. This layer resolves the channel through the user's own connection
 * (so a mistyped id is refused), derives the text from the record, and posts it
 * once after approval. It cannot change a topic, archive a channel, invite
 * people, upload files, pin, react, call or delete.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That workspace isn't available to you.";

function fail(message: string): BuildState {
  return { status: "error", message: message.slice(0, 1_000), nonce: Date.now() };
}

function done(message: string, link?: string): BuildState {
  return { status: "success", message: message.slice(0, 1_000), link, nonce: Date.now() };
}

function refresh(workspaceId: string): void {
  revalidatePath(`/workspace/${workspaceId}/connectors/slack`);
  revalidatePath(`/workspace/${workspaceId}/connectors`);
}

async function membershipRole(session: Session, workspaceId: string): Promise<string | null> {
  const { data } = await session.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .maybeSingle();
  return (data as { role: string } | null)?.role ?? null;
}

type RecordRow = {
  title: string;
  summary?: string;
  question?: string;
  hypothesis?: string;
  nextStep?: string;
};

async function loadRecord(
  session: Session,
  workspaceId: string,
  kind: string,
  recordId: string,
): Promise<RecordRow | null> {
  if (!isSlackRecordKind(kind)) return null;

  if (kind === "mission") {
    const { data } = await session.supabase
      .from("missions")
      .select("title, problem")
      .eq("id", recordId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const row = data as { title: string; problem?: string } | null;
    return row ? { title: row.title, summary: row.problem } : null;
  }

  if (kind === "experiment") {
    const { data } = await session.supabase
      .from("experiments")
      .select("question, hypothesis")
      .eq("id", recordId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const row = data as { question: string; hypothesis?: string } | null;
    return row
      ? { title: row.question, question: row.question, hypothesis: row.hypothesis }
      : null;
  }

  const { data } = await session.supabase
    .from("outcome_reviews")
    .select("decision, notes")
    .eq("id", recordId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const row = data as { decision?: string; notes?: string } | null;
  return row
    ? { title: `Outcome review: ${row.decision ?? "recorded"}`, summary: row.notes }
    : null;
}

/** Runs one read-only tool through the user's own connection. */
async function executeTool(
  session: Session,
  projectId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_LIMITS.executionTimeoutMs);

  try {
    const client = await getComposioClient();
    const sessionRef = await client.create(composioUserId(session.user.id), {
      toolkits: ["slack"],
    });
    const sessionId = sessionIdOf(sessionRef);
    if (!sessionId) return { ok: false, data: null };

    await session.supabase.rpc("composio_save_session", {
      p_project_id: projectId,
      p_toolkit: "slack",
      p_session_id: sessionId,
    });

    const outcome = await sessionRef.execute(tool, args, undefined, {
      signal: controller.signal,
    });
    return { ok: outcome.resultType === "completed", data: outcome.data ?? null };
  } catch (error) {
    console.error("slack tool call failed:", error instanceof Error ? error.message : error);
    return { ok: false, data: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function draftSlackMessageAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const connectionId = readText(formData, "connection_id");
  const recordKind = readText(formData, "record_kind");
  const recordId = readText(formData, "record_id");
  const channel = readText(formData, "channel");

  if (!isUuid(workspaceId)) return fail(NOT_AVAILABLE);
  if (!(await membershipRole(session, workspaceId))) return fail(NOT_AVAILABLE);
  if (!isUuid(connectionId) || !isUuid(recordId) || !isSlackRecordKind(recordKind)) {
    return fail("Choose a record and one of your Slack connections.");
  }

  const channelProblem_ = channelProblem(channel);
  if (channelProblem_) return fail(channelProblem_);

  const { data: connection } = await session.supabase
    .from("app_composio_connections")
    .select("id, project_id, user_id, toolkit, status")
    .eq("id", connectionId)
    .eq("user_id", session.user.id)
    .eq("toolkit", "slack")
    .maybeSingle();

  const connectionRow = connection as
    | { id: string; project_id: string; status: string }
    | null;
  if (!connectionRow) {
    return fail("That Slack connection isn't yours. Connect one first; nothing was created.");
  }
  if (connectionRow.status !== "active") {
    return fail("That Slack connection is no longer active. Nothing was created.");
  }
  if (!isComposioConfigured()) {
    return fail("Slack sending is not configured in this environment. Nothing was created.");
  }

  const record = await loadRecord(session, workspaceId, recordKind, recordId);
  if (!record) return fail("That record isn't in this workspace.");

  const target = normalizedChannel(channel);
  const listed = await executeTool(
    session,
    connectionRow.project_id,
    SLACK_LIST_TOOL,
    { limit: SLACK_LIMITS.channelListLimit, exclude_archived: true },
  );
  const channelLabel = listed.ok ? channelLabelFromListResult(listed.data, target) : null;
  if (!channelLabel) {
    return fail(
      "That channel is not visible to this Slack connection, so nothing was created. Check the id, or ask an admin to add the app to the channel.",
    );
  }

  const derived = buildSlackMessageDraft({
    kind: recordKind,
    title: record.title,
    summary: record.summary,
    question: record.question,
    hypothesis: record.hypothesis,
    nextStep: record.nextStep,
  });

  const draft = { channel: target, text: derived.text };
  const problems = draftProblems(draft);
  if (problems.length > 0) return fail(problems[0]);

  const { data: created, error } = await session.supabase
    .from("slack_message_requests")
    .insert({
      workspace_id: workspaceId,
      user_id: session.user.id,
      connection_id: connectionRow.id,
      project_id: connectionRow.project_id,
      record_kind: recordKind,
      record_id: recordId,
      channel: draft.channel,
      channel_label: channelLabel,
      text: draft.text,
      fingerprint: messageFingerprint(draft),
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("draftSlackMessageAction failed:", error?.message);
    return fail(
      error?.code === "23505"
        ? "This exact message was already drafted from that record. Open the existing request instead of creating a duplicate."
        : "We couldn't save that draft. Nothing was posted.",
    );
  }

  refresh(workspaceId);
  return done(
    `Draft saved for #${channelLabel}. Read the exact channel and text, then approve it.`,
  );
}

export async function approveSlackMessageAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const requestId = readText(formData, "request_id");
  if (!isUuid(workspaceId) || !isUuid(requestId)) return fail(NOT_AVAILABLE);

  const { data, error } = await session.supabase.rpc("slack_message_approve", {
    p_id: requestId,
  });
  if (error) {
    console.error("approveSlackMessageAction failed:", error.message);
    return fail("We couldn't approve that request just now. Nothing was posted.");
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) {
    return fail(
      result.code === "not-draft"
        ? "That request has already moved on from draft."
        : "We couldn't approve that request. Nothing was posted.",
    );
  }

  refresh(workspaceId);
  return done("Approved for exactly this channel and text. Posting is a separate step.");
}

export async function sendSlackMessageAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const requestId = readText(formData, "request_id");
  if (!isUuid(workspaceId) || !isUuid(requestId)) return fail(NOT_AVAILABLE);
  if (!(await membershipRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const { data: requestRow } = await session.supabase
    .from("slack_message_requests")
    .select("*")
    .eq("id", requestId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const request = requestRow as
    | {
        id: string;
        connection_id: string;
        project_id: string;
        channel: string;
        channel_label: string;
        text: string;
        status: string;
      }
    | null;
  if (!request) return fail(NOT_AVAILABLE);

  const readGrant = await session.supabase
    .from("app_composio_tool_grants")
    .select("id")
    .eq("connection_id", request.connection_id)
    .eq("tool_slug", SLACK_SEND_TOOL)
    .maybeSingle();

  const { data: connection } = await session.supabase
    .from("app_composio_connections")
    .select("status")
    .eq("id", request.connection_id)
    .maybeSingle();

  const blocker = sendBlocker({
    configured: isComposioConfigured(),
    connectionStatus: (connection as { status: string } | null)?.status ?? "removed",
    toolGranted: Boolean(readGrant.data),
  });
  if (blocker) return fail(blocker.message);

  const { data: claimed, error: claimError } = await session.supabase.rpc(
    "slack_message_claim",
    { p_id: requestId },
  );
  if (claimError) {
    console.error("slack_message_claim failed:", claimError.message);
    return fail("We couldn't start posting that message. Nothing was posted.");
  }

  const claim = (claimed ?? {}) as { ok?: boolean; code?: string };
  if (!claim.ok) {
    const messages: Record<string, string> = {
      "already-sending": "That message is already being posted. Nothing was posted twice.",
      "already-sent": "That message was already posted. Nothing was posted twice.",
      "approval-required": "Approve this exact channel and text before posting it.",
      "connection-inactive": "That Slack connection is no longer active. Nothing was posted.",
    };
    return fail(
      messages[claim.code ?? ""] ?? "That request could not be posted. Nothing was posted.",
    );
  }

  const outcome = await executeTool(session, request.project_id, SLACK_SEND_TOOL, {
    channel: request.channel,
    text: request.text,
  });

  if (!outcome.ok) {
    await session.supabase.rpc("slack_message_complete", {
      p_id: requestId,
      p_succeeded: false,
      p_error_code: "provider_failed",
      p_error_message: "Slack did not confirm the message. Nothing was retried.",
    });
    refresh(workspaceId);
    return fail("Slack did not confirm the message. Nothing was retried.");
  }

  const posted = messageFromProviderResult(outcome.data);
  if (!posted) {
    await session.supabase.rpc("slack_message_complete", {
      p_id: requestId,
      p_succeeded: false,
      p_error_code: "missing_message",
      p_error_message:
        "Slack reported success without a message timestamp, so this is recorded as unposted rather than guessed.",
    });
    refresh(workspaceId);
    return fail(
      "Slack reported success without a message timestamp, so this is recorded as unposted. Check the channel before trying again.",
    );
  }

  await session.supabase.rpc("slack_message_complete", {
    p_id: requestId,
    p_succeeded: true,
    p_message_ts: posted.ts,
    p_permalink: posted.permalink,
  });

  refresh(workspaceId);
  return done(
    `Posted to #${request.channel_label || request.channel}.`,
    posted.permalink ?? undefined,
  );
}

export async function cancelSlackMessageAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const requestId = readText(formData, "request_id");
  if (!isUuid(workspaceId) || !isUuid(requestId)) return fail(NOT_AVAILABLE);

  const { data, error } = await session.supabase.rpc("slack_message_cancel", {
    p_id: requestId,
  });
  if (error) {
    console.error("cancelSlackMessageAction failed:", error.message);
    return fail("We couldn't cancel that request just now.");
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) {
    return fail(
      result.code === "not-cancellable"
        ? "That request is already posting or posted, so it cannot be cancelled here."
        : "We couldn't cancel that request.",
    );
  }

  refresh(workspaceId);
  return done("Request cancelled. Nothing was posted.");
}
