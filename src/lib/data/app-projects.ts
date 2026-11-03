import type { Session } from "@/lib/auth";
import type {
  AppFile,
  AppProject,
  AppSpecRecord,
  AppVersion,
} from "@/lib/types";
import { DataError } from "@/lib/data/goals";

/**
 * Build-an-App reads.
 *
 * Every query is scoped to the signed-in account here and by row level
 * security. Files are read from app_files, never from tasks or task results.
 */

const LOAD_ERROR =
  "We couldn't load your app projects just now. Refresh the page to try again.";

export async function listAppProjects(session: Session): Promise<AppProject[]> {
  const { data, error } = await session.supabase
    .from("app_projects")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("listAppProjects failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data ?? []) as AppProject[];
}

export type AppProjectDetail = {
  project: AppProject;
  specs: AppSpecRecord[];
  files: AppFile[];
  versions: AppVersion[];
};

export async function getAppProjectDetail(
  session: Session,
  projectId: string,
): Promise<AppProjectDetail | null> {
  const { data: project, error } = await session.supabase
    .from("app_projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getAppProjectDetail project failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!project) return null;

  const [specs, files, versions] = await Promise.all([
    session.supabase
      .from("app_specs")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("version", { ascending: false }),
    session.supabase
      .from("app_files")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("path", { ascending: true }),
    session.supabase
      .from("app_versions")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("version", { ascending: false })
      .limit(20),
  ]);

  for (const result of [specs, files, versions]) {
    if (result.error) {
      console.error("getAppProjectDetail child failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    project: project as AppProject,
    specs: (specs.data ?? []) as AppSpecRecord[],
    files: (files.data ?? []) as AppFile[],
    versions: (versions.data ?? []) as AppVersion[],
  };
}

export async function getAppDownloadFiles(
  session: Session,
  projectId: string,
): Promise<{ project: AppProject; files: { path: string; content: string }[] } | null> {
  const detail = await getAppProjectDetail(session, projectId);
  if (!detail) return null;

  return {
    project: detail.project,
    files: detail.files.map((file) => ({ path: file.path, content: file.content })),
  };
}
