import type { Session } from "@/lib/auth";
import type { BuildRoomData } from "@/lib/build-room";
import { DataError } from "@/lib/data/goals";
import type { MyWorkspace } from "@/lib/data/workspaces";

/** Phase 28 reads. The RPC checks role access before returning any project row. */
export async function getBuildRoom(
  session: Session,
  projectId: string,
): Promise<BuildRoomData | null> {
  const { data, error } = await session.supabase.rpc("get_app_build_room", {
    p_project_id: projectId,
  });
  if (error) {
    if (error.message.includes("project access denied") || error.message.includes("project not found")) {
      return null;
    }
    console.error("getBuildRoom failed:", error.message);
    throw new DataError("We couldn't load the Build Room just now. Refresh the page to try again.");
  }
  return (data ?? null) as BuildRoomData | null;
}

export async function listBuildRoomWorkspaces(session: Session): Promise<MyWorkspace[]> {
  const { data, error } = await session.supabase
    .from("workspace_members")
    .select("role, workspace:workspaces (id, name, description, created_at)")
    .eq("user_id", session.user.id)
    .eq("status", "active");
  if (error) {
    console.error("listBuildRoomWorkspaces failed:", error.message);
    throw new DataError("We couldn't load your workspaces just now.");
  }
  return (data ?? [])
    .map((row) => {
      const relation = (row as unknown as {
        workspace?: { id: string; name: string; description: string | null; created_at: string } | { id: string; name: string; description: string | null; created_at: string }[];
      }).workspace;
      const workspace = Array.isArray(relation) ? relation[0] : relation;
      if (!workspace) return null;
      return { ...workspace, role: (row as { role: MyWorkspace["role"] }).role } as MyWorkspace;
    })
    .filter((row): row is MyWorkspace => row !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
