import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  type ServerSupabaseClient,
} from "@/lib/supabase/server";

export type Session = {
  supabase: ServerSupabaseClient;
  user: User;
};

/**
 * Returns the signed-in user plus a request-scoped Supabase client, or null.
 * Every read and write is scoped to this user on the server as well as by RLS.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  return { supabase, user };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

/** Best display name available for the header. */
export function displayNameFor(user: User): string {
  const metadataName = user.user_metadata?.display_name;
  if (typeof metadataName === "string" && metadataName.trim() !== "") {
    return metadataName.trim();
  }
  return user.email ?? "there";
}
