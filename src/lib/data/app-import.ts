import type { Session } from "@/lib/auth";
import type {
  AppImportBaselineRecord,
  AppImportRecord,
  AppModernizationRecord,
} from "@/lib/app-import";
import { DataError } from "@/lib/data/goals";

/**
 * Phase 31 owner-scoped reads. The map and proposal are working documents;
 * they are returned only to their owner and RLS enforces the same boundary.
 */

const LOAD_ERROR = "We couldn't load the imported app just now. Refresh the page to try again.";

export type AppImportListItem = AppImportRecord & {
  project_name: string;
};

export type AppImportDetail = {
  record: AppImportRecord;
  baseline: AppImportBaselineRecord | null;
  modernizations: AppModernizationRecord[];
};

export type GitHubImportSource = {
  connectionId: string;
  projectName: string;
  repository: string;
  branch: string;
  accountLabel: string;
};

export async function listAppImports(session: Session): Promise<AppImportListItem[]> {
  const { data, error } = await session.supabase
    .from("app_imports")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    console.error("listAppImports failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  const records = (data ?? []) as AppImportRecord[];
  if (records.length === 0) return [];

  const projectIds = [...new Set(records.map((record) => record.project_id))];
  const { data: projects, error: projectError } = await session.supabase
    .from("app_projects")
    .select("id, name")
    .eq("user_id", session.user.id)
    .in("id", projectIds);

  if (projectError) {
    console.error("listAppImports projects failed:", projectError.message);
    throw new DataError(LOAD_ERROR);
  }

  const names = new Map((projects ?? []).map((project) => [project.id as string, project.name as string]));
  return records.map((record) => ({
    ...record,
    project_name: names.get(record.project_id) ?? "Imported project",
  }));
}

export async function getAppImportDetail(
  session: Session,
  projectId: string,
): Promise<AppImportDetail | null> {
  const { data: record, error } = await session.supabase
    .from("app_imports")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getAppImportDetail failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!record) return null;

  const typed = record as AppImportRecord;
  const [baselineResult, modernizationsResult] = await Promise.all([
    session.supabase
      .from("app_import_baselines")
      .select("*")
      .eq("import_id", typed.id)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    session.supabase
      .from("app_modernizations")
      .select("*")
      .eq("import_id", typed.id)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  if (baselineResult.error || modernizationsResult.error) {
    console.error(
      "getAppImportDetail children failed:",
      baselineResult.error?.message ?? modernizationsResult.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  return {
    record: typed,
    baseline: (baselineResult.data as AppImportBaselineRecord | null) ?? null,
    modernizations: (modernizationsResult.data ?? []) as AppModernizationRecord[],
  };
}

export async function listGitHubImportSources(session: Session): Promise<GitHubImportSource[]> {
  const { data, error } = await session.supabase
    .from("app_provider_connections_safe")
    .select("id, project_id, provider, status, account_label, external_ref, metadata")
    .eq("user_id", session.user.id)
    .eq("provider", "github")
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    console.error("listGitHubImportSources failed:", error.message);
    return [];
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];
  const projectIds = [...new Set(rows.map((row) => row.project_id as string))];
  const { data: projects } = await session.supabase
    .from("app_projects")
    .select("id, name")
    .eq("user_id", session.user.id)
    .in("id", projectIds);
  const names = new Map((projects ?? []).map((project) => [project.id as string, project.name as string]));

  return rows.flatMap((row) => {
    if (typeof row.external_ref !== "string") return [];
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const branch =
      typeof metadata.branch === "string"
        ? metadata.branch
        : typeof metadata.default_branch === "string"
          ? metadata.default_branch
          : "main";
    return [
      {
        connectionId: row.id as string,
        projectName: names.get(row.project_id as string) ?? "Existing project",
        repository: row.external_ref,
        branch,
        accountLabel: (row.account_label as string | null) ?? "GitHub",
      },
    ];
  });
}

/** Used by the project page without making the normal project read depend on Phase 31 tables. */
export async function isImportedProject(session: Session, projectId: string): Promise<boolean> {
  const { data, error } = await session.supabase
    .from("app_imports")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}
