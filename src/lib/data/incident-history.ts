import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";

const LOAD_ERROR =
  "We couldn't load the incident history just now. Refresh the page to try again.";

export type IncidentNotification = {
  userId: string;
  recipient: string | null;
  stage: "first" | "reminder" | "escalation" | null;
  day: string | null;
  sentAt: string;
  readAt: string | null;
  summary: string;
};

export type ClosedIncident = {
  id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "resolved" | "dismissed";
  trigger: string;
  openedAt: string;
  closedAt: string;
  recoveryKind: string | null;
  candidateId: string;
  candidateTitle: string;
  deploymentId: string;
  target: string;
  notifications: IncidentNotification[];
};

export type IncidentHistory = {
  workspaceId: string;
  incidents: ClosedIncident[];
};

type HistoryPayload = {
  ok?: boolean;
  code?: string;
  incidents?: {
    id: string;
    title: string;
    severity: ClosedIncident["severity"];
    status: ClosedIncident["status"];
    trigger: string;
    opened_at: string;
    closed_at: string;
    recovery_kind: string | null;
    candidate_id: string;
    candidate_title: string;
    deployment_id: string;
    target: string;
    notifications?: {
      user_id: string;
      stage: "first" | "reminder" | "escalation" | null;
      day: string | null;
      sent_at: string;
      read_at: string | null;
      summary: string;
    }[];
  }[];
};

/**
 * The closed half of the audit: incidents resolved or dismissed on a promoted
 * change's deployment, each with the notifications that were actually delivered
 * for it. Read-only, and only for members of the workspace.
 */
export async function listIncidentHistory(
  session: Session,
  workspaceId: string,
): Promise<IncidentHistory | null> {
  const { data: workspace, error } = await session.supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("incident history workspace read failed:", error.message);
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
    console.error("incident history membership read failed:", memberError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!member) return null;

  const [history, directory] = await Promise.all([
    session.supabase.rpc("workspace_incident_history", { p_workspace_id: workspaceId }),
    session.supabase.rpc("workspace_member_directory", { p_workspace_id: workspaceId }),
  ]);

  if (history.error || directory.error) {
    console.error(
      "incident history detail read failed:",
      history.error?.message ?? directory.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  const payload = (history.data ?? {}) as HistoryPayload;
  if (!payload.ok) {
    if (payload.code === "no-workspace" || payload.code === "unauthenticated") return null;
    throw new DataError(LOAD_ERROR);
  }

  const members =
    ((directory.data ?? {}) as { members?: { user_id: string; display_name: string | null }[] })
      .members ?? [];
  const nameById = new Map(members.map((row) => [row.user_id, row.display_name]));

  return {
    workspaceId,
    incidents: (payload.incidents ?? []).map((incident) => ({
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      trigger: incident.trigger,
      openedAt: incident.opened_at,
      closedAt: incident.closed_at,
      recoveryKind: incident.recovery_kind,
      candidateId: incident.candidate_id,
      candidateTitle: incident.candidate_title,
      deploymentId: incident.deployment_id,
      target: incident.target,
      notifications: (incident.notifications ?? []).map((row) => ({
        userId: row.user_id,
        recipient: nameById.get(row.user_id) ?? null,
        stage: row.stage,
        day: row.day,
        sentAt: row.sent_at,
        readAt: row.read_at,
        summary: row.summary,
      })),
    })),
  };
}
