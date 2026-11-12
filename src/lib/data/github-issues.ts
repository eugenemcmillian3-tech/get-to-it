import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type { GithubRecordKind, GithubStatus } from "@/lib/connectors/github-issues";
import type { Workspace, WorkspaceRole } from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load the connector page just now. Refresh the page to try again.";

export type GithubConnectionOption = {
  id: string;
  project_id: string;
  account_label: string;
  status: string;
  created_at: string;
};

export type GithubIssueRequest = {
  id: string;
  workspace_id: string;
  user_id: string;
  connection_id: string;
  record_kind: GithubRecordKind;
  record_id: string;
  repository: string;
  title: string;
  body: string;
  fingerprint: string;
  status: GithubStatus;
  approval_fingerprint: string | null;
  approved_at: string | null;
  issue_url: string | null;
  issue_number: number | null;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
};

export type GithubIssueEvent = {
  id: string;
  request_id: string;
  kind: string;
  detail: string;
  created_at: string;
};

export type GithubIssueList = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  connections: GithubConnectionOption[];
  requests: GithubIssueRequest[];
  events: GithubIssueEvent[];
  records: { kind: GithubRecordKind; id: string; label: string }[];
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
    console.error("connector workspace read failed:", error.message);
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
    console.error("connector membership read failed:", memberError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!member) return null;

  return {
    workspace: workspace as Workspace,
    myRole: (member as { role: WorkspaceRole }).role,
  };
}

export async function listGithubIssues(
  session: Session,
  workspaceId: string,
): Promise<GithubIssueList | null> {
  const scope = await membership(session, workspaceId);
  if (!scope) return null;

  const [connections, requests, records] = await Promise.all([
    session.supabase
      .from("app_composio_connections")
      .select("id, project_id, account_label, status, created_at")
      .eq("user_id", session.user.id)
      .eq("toolkit", "github")
      .order("created_at", { ascending: false }),
    session.supabase
      .from("github_issue_requests")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    recordsFor(session, workspaceId),
  ]);

  if (connections.error || requests.error) {
    console.error(
      "connector read failed:",
      connections.error?.message ?? requests.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  const requests_ = (requests.data ?? []) as GithubIssueRequest[];
  let events: GithubIssueEvent[] = [];

  if (requests_.length > 0) {
    const { data, error } = await session.supabase
      .from("github_issue_events")
      .select("id, request_id, kind, detail, created_at")
      .in("request_id", requests_.map((request) => request.id))
      .order("created_at");
    if (error) {
      console.error("connector events read failed:", error.message);
      throw new DataError(LOAD_ERROR);
    }
    events = (data ?? []) as GithubIssueEvent[];
  }

  return {
    ...scope,
    connections: (connections.data ?? []) as GithubConnectionOption[],
    requests: requests_,
    events,
    records,
  };
}

async function recordsFor(
  session: Session,
  workspaceId: string,
): Promise<{ kind: GithubRecordKind; id: string; label: string }[]> {
  const [missions, experiments, reviews, research] = await Promise.all([
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
    session.supabase
      .from("research_missions")
      .select("id, question")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const out: { kind: GithubRecordKind; id: string; label: string }[] = [];
  for (const row of (missions.data ?? []) as { id: string; title: string }[]) {
    out.push({ kind: "mission", id: row.id, label: row.title });
  }
  for (const row of (experiments.data ?? []) as { id: string; question: string }[]) {
    out.push({ kind: "experiment", id: row.id, label: row.question });
  }
  for (const row of (reviews.data ?? []) as { id: string; decision: string }[]) {
    out.push({ kind: "outcome_review", id: row.id, label: `Outcome review: ${row.decision}` });
  }
  for (const row of (research.data ?? []) as { id: string; question: string }[]) {
    out.push({ kind: "research_mission", id: row.id, label: row.question });
  }
  return out;
}
