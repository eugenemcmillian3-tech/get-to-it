"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { getSession, type Session } from "@/lib/auth";
import {
  GITHUB_CREATE_ISSUE_TOOL,
  buildIssueDraft,
  draftProblems,
  issueFingerprint,
  issueFromProviderResult,
  isGithubRecordKind,
  repositoryProblem,
  sendBlocker,
} from "@/lib/connectors/github-issues";
import { composioUserId } from "@/lib/composio/contracts";
import {
  getComposioClient,
  isComposioConfigured,
  sessionIdOf,
} from "@/lib/composio/sdk";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 9 actions: one connector, one workflow.
 *
 * GitHub issue creation from an approved record. The connection, OAuth flow and
 * transport are the existing Composio path. Nothing here pushes code, merges,
 * deletes, edits workflows, manages secrets or deploys; the action name is not a
 * parameter, so those cannot be requested.
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
  revalidatePath(`/workspace/${workspaceId}/connectors`);
}

async function membershipRole(
  session: Session,
  workspaceId: string,
): Promise<string | null> {
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
  if (!isGithubRecordKind(kind)) return null;

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
    return row ? { title: row.question, question: row.question, hypothesis: row.hypothesis } : null;
  }

  if (kind === "outcome_review") {
    const { data } = await session.supabase
      .from("outcome_reviews")
      .select("decision, notes")
      .eq("id", recordId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const row = data as { decision?: string; notes?: string } | null;
    return row
      ? {
          title: `Outcome review: ${row.decision ?? "recorded"}`,
          summary: row.notes,
        }
      : null;
  }

  const { data } = await session.supabase
    .from("research_missions")
    .select("question, scope")
    .eq("id", recordId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const row = data as { question: string; scope?: string } | null;
  return row ? { title: row.question, question: row.question, summary: row.scope } : null;
}

export async function draftGithubIssueAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const connectionId = readText(formData, "connection_id");
  const recordKind = readText(formData, "record_kind");
  const recordId = readText(formData, "record_id");
  const repository = readText(formData, "repository");

  if (!isUuid(workspaceId)) return fail(NOT_AVAILABLE);
  if (!(await membershipRole(session, workspaceId))) return fail(NOT_AVAILABLE);
  if (!isUuid(connectionId) || !isUuid(recordId) || !isGithubRecordKind(recordKind)) {
    return fail("Choose a record and one of your GitHub connections.");
  }

  const repositoryProblem_ = repositoryProblem(repository);
  if (repositoryProblem_) return fail(repositoryProblem_);

  const { data: connection } = await session.supabase
    .from("app_composio_connections")
    .select("id, project_id, user_id, toolkit, status")
    .eq("id", connectionId)
    .eq("user_id", session.user.id)
    .eq("toolkit", "github")
    .maybeSingle();

  const connectionRow = connection as
    | { id: string; project_id: string; status: string }
    | null;
  if (!connectionRow) {
    return fail("That GitHub connection isn't yours. Connect one first; nothing was created.");
  }
  if (connectionRow.status !== "active") {
    return fail("That GitHub connection is no longer active. Nothing was created.");
  }

  const record = await loadRecord(session, workspaceId, recordKind, recordId);
  if (!record) return fail("That record isn't in this workspace.");

  const derived = buildIssueDraft({
    kind: recordKind,
    title: record.title,
    summary: record.summary,
    question: record.question,
    hypothesis: record.hypothesis,
  });

  const draft = { repository: repository.trim(), title: derived.title, body: derived.body };
  const problems = draftProblems(draft);
  if (problems.length > 0) return fail(problems[0]);

  const { data: created, error } = await session.supabase
    .from("github_issue_requests")
    .insert({
      workspace_id: workspaceId,
      user_id: session.user.id,
      connection_id: connectionRow.id,
      project_id: connectionRow.project_id,
      record_kind: recordKind,
      record_id: recordId,
      repository: draft.repository,
      title: draft.title,
      body: draft.body,
      fingerprint: issueFingerprint(draft),
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("draftGithubIssueAction failed:", error?.message);
    return fail(
      error?.code === "23505"
        ? "This exact issue was already drafted from that record. Open the existing request instead of creating a duplicate."
        : "We couldn't save that draft. Nothing was created.",
    );
  }

  refresh(workspaceId);
  return done("Draft saved. Read the exact repository, title and body, then approve it.");
}

export async function approveGithubIssueAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const requestId = readText(formData, "request_id");
  if (!isUuid(workspaceId) || !isUuid(requestId)) return fail(NOT_AVAILABLE);

  const { data, error } = await session.supabase.rpc("github_issue_approve", {
    p_id: requestId,
  });

  if (error) {
    console.error("approveGithubIssueAction failed:", error.message);
    return fail("We couldn't approve that request just now. Nothing was sent.");
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) {
    return fail(
      result.code === "not-draft"
        ? "That request has already moved on from draft."
        : "We couldn't approve that request. Nothing was sent.",
    );
  }

  refresh(workspaceId);
  return done("Approved for exactly this content. Sending is a separate step.");
}

export async function sendGithubIssueAction(
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
    .from("github_issue_requests")
    .select("*")
    .eq("id", requestId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const request = requestRow as
    | {
        id: string;
        connection_id: string;
        project_id: string;
        repository: string;
        title: string;
        body: string;
        status: string;
      }
    | null;
  if (!request) return fail(NOT_AVAILABLE);

  const readGrant = await session.supabase
    .from("app_composio_tool_grants")
    .select("id")
    .eq("connection_id", request.connection_id)
    .eq("tool_slug", GITHUB_CREATE_ISSUE_TOOL)
    .maybeSingle();

  const { data: connection } = await session.supabase
    .from("app_composio_connections")
    .select("status, connected_account_id")
    .eq("id", request.connection_id)
    .maybeSingle();
  const connectionRow = connection as
    | { status: string; connected_account_id: string }
    | null;

  const blocker = sendBlocker({
    configured: isComposioConfigured(),
    connectionStatus: connectionRow?.status ?? "removed",
    toolGranted: Boolean(readGrant.data),
  });

  if (blocker) {
    return fail(blocker.message);
  }

  const { data: claimed, error: claimError } = await session.supabase.rpc(
    "github_issue_claim",
    { p_id: requestId },
  );
  if (claimError) {
    console.error("github_issue_claim failed:", claimError.message);
    return fail("We couldn't start sending that request. Nothing was sent.");
  }

  const claim = (claimed ?? {}) as {
    ok?: boolean;
    code?: string;
    repository?: string;
    title?: string;
    body?: string;
  };
  if (!claim.ok) {
    const messages: Record<string, string> = {
      "already-sending": "That request is already being sent. Nothing was sent twice.",
      "already-sent": "That issue was already created. Nothing was sent twice.",
      "approval-required": "Approve this exact content before sending it.",
      "connection-inactive": "That GitHub connection is no longer active. Nothing was sent.",
    };
    return fail(messages[claim.code ?? ""] ?? "That request could not be sent. Nothing was sent.");
  }

  const [owner, repo] = request.repository.split("/");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const client = await getComposioClient();
    const sessionRef = await client.create(composioUserId(session.user.id), {
      toolkits: ["github"],
    });
    const sessionId = sessionIdOf(sessionRef);
    if (!sessionId) throw new Error("no session");

    await session.supabase.rpc("composio_save_session", {
      p_project_id: request.project_id,
      p_toolkit: "github",
      p_session_id: sessionId,
    });

    const outcome = await sessionRef.execute(
      GITHUB_CREATE_ISSUE_TOOL,
      { owner, repo, title: request.title, body: request.body },
      undefined,
      { signal: controller.signal },
    );
    clearTimeout(timer);

    if (outcome.resultType !== "completed") {
      await session.supabase.rpc("github_issue_complete", {
        p_id: requestId,
        p_succeeded: false,
        p_error_code: "provider_failed",
        p_error_message: "GitHub did not complete the request. Nothing was retried.",
      });
      refresh(workspaceId);
      return fail("GitHub did not complete the request. Nothing was retried.");
    }

    const issue = issueFromProviderResult(outcome.data ?? null);
    if (!issue) {
      await session.supabase.rpc("github_issue_complete", {
        p_id: requestId,
        p_succeeded: false,
        p_error_code: "missing_issue",
        p_error_message:
          "The provider reported completion without an issue URL, so the request is recorded as unsent rather than guessed.",
      });
      refresh(workspaceId);
      return fail(
        "GitHub reported completion without an issue link, so this is recorded as unsent. Check GitHub before trying again.",
      );
    }

    await session.supabase.rpc("github_issue_complete", {
      p_id: requestId,
      p_succeeded: true,
      p_issue_url: issue.url,
      p_issue_number: issue.number,
      p_provider_ref: outcome.logId ?? null,
    });

    refresh(workspaceId);
    return done(`Issue #${issue.number} created in ${request.repository}.`, issue.url);
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message.slice(0, 300) : "unknown error";
    console.error("sendGithubIssueAction failed:", message);
    await session.supabase.rpc("github_issue_complete", {
      p_id: requestId,
      p_succeeded: false,
      p_error_code: "transport_error",
      p_error_message: "The send failed before GitHub confirmed an issue. Nothing was retried.",
    });
    refresh(workspaceId);
    return fail(
      "The send failed before GitHub confirmed an issue. Nothing was retried; check GitHub before trying again.",
    );
  }
}

export async function cancelGithubIssueAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const requestId = readText(formData, "request_id");
  if (!isUuid(workspaceId) || !isUuid(requestId)) return fail(NOT_AVAILABLE);

  const { data, error } = await session.supabase.rpc("github_issue_cancel", {
    p_id: requestId,
  });
  if (error) {
    console.error("cancelGithubIssueAction failed:", error.message);
    return fail("We couldn't cancel that request just now.");
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) {
    return fail(
      result.code === "not-cancellable"
        ? "That request is already sending or sent, so it cannot be cancelled here."
        : "We couldn't cancel that request.",
    );
  }

  refresh(workspaceId);
  return done("Request cancelled. Nothing was sent.");
}
