import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  ClaimType,
  CorrectionKind,
  CorrectionStatus,
  EntryStatus,
  EvidenceStance,
  ImpactKind,
  KnowledgeEntryLike,
  KnowledgeEvidenceLike,
  KnowledgeImpactLike,
  KnowledgeSourceLike,
  SourceKind,
  TransferStatus,
  VerificationStatus,
} from "@/lib/knowledge";
import { sourceHealth } from "@/lib/knowledge";
import type { Workspace, WorkspaceRole } from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load the knowledge layer just now. Refresh the page to try again.";

export type KnowledgeEntryRow = {
  id: string;
  workspace_id: string;
  created_by: string;
  owner_id: string;
  kind: "claim" | "procedure";
  claim_type: ClaimType;
  title: string;
  statement: string;
  domain: string;
  applies_when: string;
  limitations: string;
  authorized_scope: string;
  provenance: string;
  verification_status: VerificationStatus;
  verification_note: string;
  verified_by: string | null;
  verified_at: string | null;
  review_at: string | null;
  last_reviewed_at: string | null;
  version: number;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  transferred_from_id: string | null;
  status: EntryStatus;
  retention_note: string;
  delete_after: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeSourceRow = Omit<KnowledgeSourceLike, "id" | "created_at"> & {
  id: string;
  entry_id: string;
  workspace_id: string;
  created_at: string;
};

export type KnowledgeEvidenceRow = KnowledgeEvidenceLike & {
  entry_id: string;
  workspace_id: string;
};

export type KnowledgeImpactRow = KnowledgeImpactLike & {
  entry_id: string;
  workspace_id: string;
};

export type KnowledgeCorrectionRow = {
  id: string;
  entry_id: string;
  workspace_id: string;
  requested_by: string;
  kind: CorrectionKind;
  detail: string;
  proposed_statement: string;
  status: CorrectionStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  created_at: string;
  updated_at: string;
};

export type KnowledgeTransferRow = {
  id: string;
  entry_id: string;
  workspace_id: string;
  source_workspace_id: string;
  target_workspace_id: string;
  requested_by: string;
  similarities: string;
  differences: string;
  evidence_summary: string;
  assumptions_to_test: string;
  status: TransferStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  created_entry_id: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeEventRow = {
  id: string;
  entry_id: string | null;
  workspace_id: string;
  actor_id: string | null;
  kind: string;
  detail: string;
  created_at: string;
};

export type KnowledgeCandidate = {
  id: string;
  kind: SourceKind;
  label: string;
  detail: string;
};

export type KnowledgeWorkspaceOption = { id: string; name: string };

const ENTRY_COLUMNS =
  "id, workspace_id, created_by, owner_id, kind, claim_type, title, statement, domain, applies_when, limitations, authorized_scope, provenance, verification_status, verification_note, verified_by, verified_at, review_at, last_reviewed_at, version, supersedes_id, superseded_by_id, transferred_from_id, status, retention_note, delete_after, created_at, updated_at";

const SOURCE_COLUMNS =
  "id, entry_id, workspace_id, source_kind, source_id, label, linked_by, created_at";

const EVIDENCE_COLUMNS =
  "id, entry_id, workspace_id, stance, evidence_kind, detail, source_kind, source_id, observed_at, added_by, created_at";

const IMPACT_COLUMNS =
  "id, entry_id, workspace_id, target_kind, target_id, target_label, note, invalidated_at, invalidated_reason, created_at";

const TRANSFER_COLUMNS =
  "id, entry_id, workspace_id, source_workspace_id, target_workspace_id, requested_by, similarities, differences, evidence_summary, assumptions_to_test, status, decided_by, decided_at, decision_note, created_entry_id, created_at, updated_at";

export type KnowledgeList = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  entries: KnowledgeEntryRow[];
  counts: Record<string, { supporting: number; contradicting: number; sources: number }>;
  domains: string[];
  incoming: KnowledgeTransferRow[];
  outgoing: KnowledgeTransferRow[];
  dueForPurge: number;
};

export type KnowledgeDetail = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  entry: KnowledgeEntryRow;
  sources: KnowledgeSourceRow[];
  missingSources: KnowledgeSourceRow[];
  evidence: KnowledgeEvidenceRow[];
  impacts: KnowledgeImpactRow[];
  corrections: KnowledgeCorrectionRow[];
  transfers: KnowledgeTransferRow[];
  events: KnowledgeEventRow[];
  versions: KnowledgeEntryRow[];
  candidates: KnowledgeCandidate[];
  otherWorkspaces: KnowledgeWorkspaceOption[];
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
    console.error("knowledge workspace read failed:", error.message);
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
    console.error("knowledge membership read failed:", memberError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!member) return null;

  return {
    workspace: workspace as Workspace,
    myRole: (member as { role: WorkspaceRole }).role,
  };
}

/** Workspaces the person may propose a transfer into. Names only, no content. */
export async function knowledgeTransferTargets(
  session: Session,
  sourceWorkspaceId: string,
): Promise<KnowledgeWorkspaceOption[]> {
  const { data, error } = await session.supabase
    .from("workspace_members")
    .select("workspace_id, role, status")
    .eq("user_id", session.user.id)
    .eq("status", "active");

  if (error) {
    console.error("knowledge transfer targets failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  const ids = ((data ?? []) as { workspace_id: string }[])
    .map((row) => row.workspace_id)
    .filter((id) => id !== sourceWorkspaceId);
  if (ids.length === 0) return [];

  const { data: workspaces, error: workspaceError } = await session.supabase
    .from("workspaces")
    .select("id, name")
    .in("id", ids);

  if (workspaceError) {
    console.error("knowledge transfer workspace names failed:", workspaceError.message);
    throw new DataError(LOAD_ERROR);
  }

  return ((workspaces ?? []) as { id: string; name: string }[]).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/** Records the person already belongs to, offered as linkable sources. */
export async function knowledgeCandidates(
  session: Session,
  workspaceId: string,
): Promise<KnowledgeCandidate[]> {
  const [experiments, missions, reviews, goals, outcomeReviews, learningRecords] =
    await Promise.all([
      session.supabase
        .from("experiments")
        .select("id, question, status, review_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(25),
      session.supabase
        .from("missions")
        .select("id, title, status")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(25),
      session.supabase
        .from("orchestration_reviews")
        .select("id, orchestration_id, decision, built")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(25),
      session.supabase
        .from("goals")
        .select("id, title, deadline")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(25),
      session.supabase
        .from("outcome_reviews")
        .select("id, title, status, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(25),
      session.supabase
        .from("learning_records")
        .select("id, prompt, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

  const candidates: KnowledgeCandidate[] = [];

  for (const row of (experiments.data ?? []) as {
    id: string;
    question: string;
    status: string;
  }[]) {
    candidates.push({
      id: row.id,
      kind: "experiment",
      label: row.question,
      detail: `Experiment · ${row.status}`,
    });
  }
  for (const row of (missions.data ?? []) as {
    id: string;
    title: string;
    status: string;
  }[]) {
    candidates.push({
      id: row.id,
      kind: "mission",
      label: row.title,
      detail: `Mission · ${row.status}`,
    });
  }
  for (const row of (reviews.data ?? []) as {
    id: string;
    decision: string;
    built: string;
  }[]) {
    candidates.push({
      id: row.id,
      kind: "orchestration_review",
      label: row.built.trim() === "" ? "Orchestration review" : row.built.slice(0, 120),
      detail: `Outcome review · ${row.decision}`,
    });
  }
  for (const row of (goals.data ?? []) as { id: string; title: string }[]) {
    candidates.push({
      id: row.id,
      kind: "goal",
      label: row.title,
      detail: "Your goal",
    });
  }
  for (const row of (outcomeReviews.data ?? []) as {
    id: string;
    title: string;
    status: string;
  }[]) {
    candidates.push({
      id: row.id,
      kind: "outcome_review",
      label: row.title,
      detail: `Your outcome review · ${row.status}`,
    });
  }
  for (const row of (learningRecords.data ?? []) as {
    id: string;
    prompt: string;
  }[]) {
    candidates.push({
      id: row.id,
      kind: "learning_record",
      label: row.prompt.slice(0, 120),
      detail: "Your learning record",
    });
  }

  return candidates;
}

/** Which of the linked records still exist and are readable by this person. */
async function existingSourceIds(
  session: Session,
  sources: KnowledgeSourceRow[],
): Promise<Set<string>> {
  const ids: Record<string, string[]> = {};
  for (const source of sources) {
    if (source.source_id === null) continue;
    (ids[source.source_kind] ??= []).push(source.source_id);
  }

  const tableFor: Partial<Record<SourceKind, string>> = {
    experiment: "experiments",
    experiment_review: "experiment_reviews",
    outcome_review: "outcome_reviews",
    learning_record: "learning_records",
    goal: "goals",
    orchestration_review: "orchestration_reviews",
    mission: "missions",
    project_model: "app_projects",
    transfer: "knowledge_entries",
  };

  const existing = new Set<string>();
  await Promise.all(
    Object.entries(ids).map(async ([kind, list]) => {
      const table = tableFor[kind as SourceKind];
      if (!table) return;
      const { data, error } = await session.supabase.from(table).select("id").in("id", list);
      if (error) {
        console.error(`knowledge source check failed for ${kind}:`, error.message);
        return;
      }
      for (const row of (data ?? []) as { id: string }[]) existing.add(row.id);
    }),
  );
  return existing;
}

export async function listKnowledge(
  session: Session,
  workspaceId: string,
): Promise<KnowledgeList | null> {
  const base = await membership(session, workspaceId);
  if (!base) return null;

  const { data: entries, error } = await session.supabase
    .from("knowledge_entries")
    .select(ENTRY_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("listKnowledge entries failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  const rows = (entries ?? []) as KnowledgeEntryRow[];
  const entryIds = rows.map((row) => row.id);

  const [evidence, sources, transfers] = await Promise.all([
    entryIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : session.supabase
          .from("knowledge_evidence")
          .select("entry_id, stance")
          .in("entry_id", entryIds),
    entryIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : session.supabase
          .from("knowledge_sources")
          .select("entry_id")
          .in("entry_id", entryIds),
    session.supabase
      .from("knowledge_transfers")
      .select(TRANSFER_COLUMNS)
      .or(
        `source_workspace_id.eq.${workspaceId},target_workspace_id.eq.${workspaceId}`,
      )
      .order("created_at", { ascending: false }),
  ]);

  if (evidence.error || sources.error || transfers.error) {
    console.error(
      "listKnowledge related read failed:",
      evidence.error?.message ?? sources.error?.message ?? transfers.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  const counts: KnowledgeList["counts"] = {};
  for (const row of rows) counts[row.id] = { supporting: 0, contradicting: 0, sources: 0 };
  for (const item of (evidence.data ?? []) as { entry_id: string; stance: EvidenceStance }[]) {
    const bucket = counts[item.entry_id];
    if (!bucket) continue;
    if (item.stance === "supports") bucket.supporting += 1;
    else bucket.contradicting += 1;
  }
  for (const item of (sources.data ?? []) as { entry_id: string }[]) {
    const bucket = counts[item.entry_id];
    if (bucket) bucket.sources += 1;
  }

  const allTransfers = (transfers.data ?? []) as KnowledgeTransferRow[];
  const today = new Date().toISOString().slice(0, 10);

  return {
    ...base,
    entries: rows,
    counts,
    domains: Array.from(new Set(rows.map((row) => row.domain))).sort((a, b) =>
      a.localeCompare(b),
    ),
    incoming: allTransfers.filter(
      (row) => row.target_workspace_id === workspaceId && row.status === "proposed",
    ),
    outgoing: allTransfers.filter(
      (row) => row.source_workspace_id === workspaceId && row.status !== "withdrawn",
    ),
    dueForPurge: rows.filter((row) => row.delete_after !== null && row.delete_after <= today)
      .length,
  };
}

export async function getKnowledgeEntry(
  session: Session,
  workspaceId: string,
  entryId: string,
): Promise<KnowledgeDetail | null> {
  const base = await membership(session, workspaceId);
  if (!base) return null;

  const { data: entry, error } = await session.supabase
    .from("knowledge_entries")
    .select(ENTRY_COLUMNS)
    .eq("id", entryId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("getKnowledgeEntry failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!entry) return null;

  const [sources, evidence, impacts, corrections, transfers, events, versions, candidates, targets] =
    await Promise.all([
      session.supabase.from("knowledge_sources").select(SOURCE_COLUMNS).eq("entry_id", entryId),
      session.supabase
        .from("knowledge_evidence")
        .select(EVIDENCE_COLUMNS)
        .eq("entry_id", entryId)
        .order("created_at", { ascending: true }),
      session.supabase
        .from("knowledge_impacts")
        .select(IMPACT_COLUMNS)
        .eq("entry_id", entryId)
        .order("created_at", { ascending: true }),
      session.supabase
        .from("knowledge_corrections")
        .select(
          "id, entry_id, workspace_id, requested_by, kind, detail, proposed_statement, status, decided_by, decided_at, decision_note, created_at, updated_at",
        )
        .eq("entry_id", entryId)
        .order("created_at", { ascending: false }),
      session.supabase
        .from("knowledge_transfers")
        .select(TRANSFER_COLUMNS)
        .eq("entry_id", entryId)
        .order("created_at", { ascending: false }),
      session.supabase
        .from("knowledge_events")
        .select("id, entry_id, workspace_id, actor_id, kind, detail, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(40),
      (entry as KnowledgeEntryRow).supersedes_id || (entry as KnowledgeEntryRow).superseded_by_id
        ? session.supabase
            .from("knowledge_entries")
            .select(ENTRY_COLUMNS)
            .eq("workspace_id", workspaceId)
            .or(
              `id.eq.${(entry as KnowledgeEntryRow).id},id.eq.${
                (entry as KnowledgeEntryRow).supersedes_id ?? "00000000-0000-0000-0000-000000000000"
              },id.eq.${
                (entry as KnowledgeEntryRow).superseded_by_id ??
                "00000000-0000-0000-0000-000000000000"
              }`,
            )
        : Promise.resolve({ data: [], error: null }),
      knowledgeCandidates(session, workspaceId),
      knowledgeTransferTargets(session, workspaceId),
    ]);

  for (const result of [sources, evidence, impacts, corrections, transfers, events, versions]) {
    if (result.error) {
      console.error("getKnowledgeEntry related read failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const sourceRows = (sources.data ?? []) as KnowledgeSourceRow[];
  const existing = await existingSourceIds(session, sourceRows);
  const health = sourceHealth(sourceRows, existing);
  const missingIds = new Set(health.missing.map((row) => row.id));

  return {
    ...base,
    entry: entry as KnowledgeEntryRow,
    sources: sourceRows.filter((row) => !missingIds.has(row.id)),
    missingSources: sourceRows.filter((row) => missingIds.has(row.id)),
    evidence: (evidence.data ?? []) as KnowledgeEvidenceRow[],
    impacts: (impacts.data ?? []) as KnowledgeImpactRow[],
    corrections: (corrections.data ?? []) as KnowledgeCorrectionRow[],
    transfers: (transfers.data ?? []) as KnowledgeTransferRow[],
    events: (events.data ?? []) as KnowledgeEventRow[],
    versions: (versions.data ?? []) as KnowledgeEntryRow[],
    candidates,
    otherWorkspaces: targets,
  };
}

/**
 * Retrieval goes through the security-invoker function, so row-level security
 * still applies and a workspace the caller is not a member of returns nothing.
 */
export async function retrieveKnowledge(
  session: Session,
  workspaceId: string,
  query: string,
  domain: string,
): Promise<KnowledgeEntryLike[]> {
  const { data, error } = await session.supabase.rpc("knowledge_retrieve", {
    p_workspace_id: workspaceId,
    p_query: query,
    p_domain: domain,
  });

  if (error) {
    console.error("retrieveKnowledge failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data ?? []) as KnowledgeEntryLike[];
}

/** Entry titles for a version chain, without loading every field again. */
export async function knowledgeTitles(
  session: Session,
  entryIds: string[],
): Promise<Map<string, string>> {
  if (entryIds.length === 0) return new Map();
  const { data, error } = await session.supabase
    .from("knowledge_entries")
    .select("id, title")
    .in("id", entryIds);
  if (error) {
    console.error("knowledgeTitles failed:", error.message);
    return new Map();
  }
  return new Map(((data ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]));
}

export type KnowledgeSummaryRow = Pick<
  KnowledgeEntryRow,
  "id" | "title" | "status" | "verification_status" | "claim_type"
>;

export function countImpacts(impacts: KnowledgeImpactLike[]): {
  total: number;
  invalidated: number;
} {
  return {
    total: impacts.length,
    invalidated: impacts.filter((impact) => impact.invalidated_at !== null).length,
  };
}

export type KnowledgeImpactKind = ImpactKind;
