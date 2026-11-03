export type SupabaseSettings = {
  url: string;
  anonKey: string;
};

/**
 * Reads the Supabase project settings. Returns null when the project has not
 * been connected yet, so pages can show a setup notice instead of pretending
 * to work.
 */
export function getSupabaseSettings(): SupabaseSettings | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export const SETUP_REQUIRED_MESSAGE =
  "GET TO IT isn't connected to Supabase yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, run the migration in supabase/migrations, then restart the dev server.";
