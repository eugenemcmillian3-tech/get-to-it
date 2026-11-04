import type { Session } from "@/lib/auth";
import type { AppDesignAsset, AppDesignProfile, AppDesignVersion } from "@/lib/types";
import { DataError } from "@/lib/data/goals";

/**
 * Design Workspace reads. Everything is owner-scoped here and by RLS.
 * Uploaded raster references are returned only to their owner for preview.
 */

const LOAD_ERROR =
  "We couldn't load the design workspace just now. Refresh the page to try again.";

export type DesignWorkspaceData = {
  profile: AppDesignProfile | null;
  assets: AppDesignAsset[];
  versions: AppDesignVersion[];
};

export async function getDesignWorkspace(
  session: Session,
  projectId: string,
): Promise<DesignWorkspaceData> {
  const [profile, assets, versions] = await Promise.all([
    session.supabase
      .from("app_design_profiles")
      .select("id, project_id, user_id, brief, config, created_at, updated_at")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .maybeSingle(),
    session.supabase
      .from("app_design_assets")
      .select(
        "id, project_id, user_id, kind, name, mime, bytes, sha256, content_base64, attribution, license_note, permission_confirmed, created_at",
      )
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(12),
    session.supabase
      .from("app_design_versions")
      .select("id, project_id, user_id, version, config, summary, diff, created_at")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("version", { ascending: false })
      .limit(12),
  ]);

  for (const result of [profile, assets, versions]) {
    if (result.error) {
      console.error("getDesignWorkspace failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    profile: (profile.data ?? null) as AppDesignProfile | null,
    assets: (assets.data ?? []) as AppDesignAsset[],
    versions: (versions.data ?? []) as AppDesignVersion[],
  };
}
