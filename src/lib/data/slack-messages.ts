import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type { SlackRecordKind, SlackStatus } from "@/lib/connectors/slack-messages";
import type { Workspace, WorkspaceRole } from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load the Slack connector just now. Refresh the page to try again.";

export type SlackConnectionOption = {
  id: string;
  project_id: string;
  account_label: string;
  status: string;
  created_at: string;
};

export type SlackMessageRequest = {
  id: string;
  workspace_id: string;
  user_id: string;
  connection_id: string;
  record_kind: SlackRecordKind;
  record_id: string;
  channel: string;
  channel_label: string;
  text: string;
  fingerprint: string;
  status: SlackStatus;
  approval_fingerprint: string | null;
  approved_at: string | null;
  message_ts: string | null;
  permalink: string | null;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
};

export type SlackMessageEvent = {
  id: string;
  request_id: string;
  kind: string;
  detail: string;
  created_at: string;
};

export type SlackMessageList = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  connections: SlackConnectionOption[];
  requests: SlackMessageRequest[];
  events: SlackMessageEvent[];
  records: { kind: SlackRecordKind; id: string; label: string }[];
};

async function membership(
  session: Session,
  workspaceId: string,
): Promise<{ workspace: Workspace; myRole: WorkspaceRole } | null> {
  const { data: workspace, error } = await session.supabase
    .from("workspaces")
    .select("id, name, description, created_by, created_at, updated_at")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("slack workspace read failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!workspace) return null;

  const { data: member, error: memberError } = await session.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (memberError) {
    console.error("slack membership read failed:", memberError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!member) return null;

  return {
    workspace: workspace as Workspace,
    myRole: (member as { role: WorkspaceRole }).role,
  };
}

export async function listSlackMessages(
  session: Session,
  workspaceId: string,
): Promise<SlackMessageList | null> {
  const scope = await membership(session, workspaceId);
  if (!scope) return null;

  const [connections, requests, records] = await Promise.all([
    session.supabase
      .from("app_composio_connections")
      .select("id, project_id, account_label, status, created_at")
      .eq("user_id", session.user.id)
      .eq("toolkit", "slack")
      .order("created_at", { ascending: false }),
    session.supabase
      .from("slack_message_requests")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    recordsFor(session, workspaceId),
  ]);

  if (connections.error || requests.error) {
    console.error(
      "slack connector read failed:",
      connections.error?.message ?? requests.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  const requestRows = (requests.data ?? []) as SlackMessageRequest[];
  let events: SlackMessageEvent[] = [];

  if (requestRows.length > 0) {
    const { data, error } = await session.supabase
      .from("slack_message_events")
      .select("id, request_id, kind, detail, created_at")
      .in("request_id", requestRows.map((request) => request.id))
      .order("created_at");
    if (error) {
      console.error("slack events read failed:", error.message);
      throw new DataError(LOAD_ERROR);
    }
    events = (data ?? []) as SlackMessageEvent[];
  }

  return {
    ...scope,
    connections: (connections.data ?? []) as SlackConnectionOption[],
    requests: requestRows,
    events,
    records,
  };
}

async function recordsFor(
  session: Session,
  workspaceId: string,
): Promise<{ kind: SlackRecordKind; id: string; label: string }[]> {
  const [missions, experiments, reviews] = await Promise.all([
    session.supabase
      .from("missions")
      .select("id, title")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20),
    session.supabase
      .from("experiments")
      .select("id, question")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20),
    session.supabase
      .from("outcome_reviews")
      .select("id, decision")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const out: { kind: SlackRecordKind; id: string; label: string }[] = [];
  for (const row of (missions.data ?? []) as { id: string; title: string }[]) {
    out.push({ kind: "mission", id: row.id, label: row.title });
  }
  for (const row of (experiments.data ?? []) as { id: string; question: string }[]) {
    out.push({ kind: "experiment", id: row.id, label: row.question });
  }
  for (const row of (reviews.data ?? []) as { id: string; decision: string }[]) {
    out.push({ kind: "outcome_review", id: row.id, label: `Outcome review: ${row.decision}` });
  }
  return out;
}
