import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseSettings } from "@/lib/supabase/config";

export type ServerSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

/**
 * Server-side Supabase client bound to the request cookies.
 * Returns null when the project has not been connected yet.
 */
export async function createSupabaseServerClient() {
  const settings = getSupabaseSettings();
  if (!settings) return null;

  const cookieStore = await cookies();

  return createServerClient(settings.url, settings.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components can't write cookies; middleware refreshes sessions.
        }
      },
    },
  });
}
