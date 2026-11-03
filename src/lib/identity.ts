import { displayNameFor, type Session } from "@/lib/auth";
import { getProfile } from "@/lib/data/goals";

export async function getIdentity(
  session: Session,
): Promise<{ displayName: string; email: string }> {
  const profile = await getProfile(session);
  return {
    displayName: profile?.display_name ?? displayNameFor(session.user),
    email: session.user.email ?? "",
  };
}
