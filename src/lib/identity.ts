import { displayNameFor, type Session } from "@/lib/auth";
import { getProfile } from "@/lib/data/goals";

export async function getIdentity(
  session: Session,
): Promise<{ displayName: string; email: string; isOwner: boolean }> {
  const [profile, owner] = await Promise.all([
    getProfile(session),
    session.supabase.rpc("app_is_owner"),
  ]);
  return {
    displayName: profile?.display_name ?? displayNameFor(session.user),
    email: session.user.email ?? "",
    isOwner: owner.data === true,
  };
}
