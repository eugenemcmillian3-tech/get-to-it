import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logOperational } from "@/lib/log";
import { revisionLabel } from "@/lib/revision";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health check.
 *
 * It reports only whether the app is configured and whether the database answers
 * a read-only probe. No environment value, key, host, user id or private row is
 * ever included, and the response is never cached.
 *
 * 200 = configured and the database answered. 503 = degraded, with the failing
 * component named. Neither response proves that a deployment is correct; it is a
 * liveness signal, not a security audit.
 */
export async function GET() {
  const settings = getSupabaseSettings();
  let database: "ok" | "unavailable" = "unavailable";

  if (settings) {
    const supabase = createClient(settings.url, settings.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc("health_probe");
    const probe = (data ?? null) as { ok?: boolean } | null;

    if (!error && probe?.ok === true) database = "ok";
  }

  const configuration = settings ? "configured" : "missing";
  const ok = configuration === "configured" && database === "ok";

  logOperational("health_check", {
    outcome: ok ? "ok" : "degraded",
    database,
    configuration,
  });

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      revision: revisionLabel(),
      checks: { database, configuration },
      checked_at: new Date().toISOString(),
    },
    {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
