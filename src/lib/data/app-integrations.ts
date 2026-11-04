import type { Session } from "@/lib/auth";
import type { AppIntegration } from "@/lib/types";
import { DataError } from "@/lib/data/goals";

/**
 * Integration Studio reads. Sealed credential columns are never selected.
 * The data layer and RLS both scope rows to the signed-in owner.
 */

const LOAD_ERROR =
  "We couldn't load the integration settings just now. Refresh the page to try again.";

const SAFE_COLUMNS =
  "id, project_id, user_id, kind, name, status, config, allowed_operations, mapping, last_tested_at, last_test_status, last_test_note, connected_at, disconnected_at, created_at, updated_at";

export async function listAppIntegrations(
  session: Session,
  projectId: string,
): Promise<AppIntegration[]> {
  const { data, error } = await session.supabase
    .from("app_integrations")
    .select(SAFE_COLUMNS)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("listAppIntegrations failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data ?? []) as AppIntegration[];
}
