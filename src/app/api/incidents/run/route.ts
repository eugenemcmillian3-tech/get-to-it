import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cronRequestAuthorized } from "@/lib/cron-auth";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Scheduled stale-incident pass.
 *
 * Promoted deployments whose incidents have been open for a day are worth a
 * notification. Like the reminder pass this runs on a schedule, protected by
 * `CRON_SECRET`, and calls one idempotent database function.
 *
 * It uses the service role on purpose: the pass writes notifications for other
 * members, which no member session is allowed to do. Without the secret or the
 * service key it refuses to run rather than pretending to have notified anyone.
 */
async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_SECRET is not set, so the stale incident pass is disabled.",
      },
      { status: 503 },
    );
  }

  if (!cronRequestAuthorized(request, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const settings = getSupabaseSettings();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!settings || !serviceKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "SUPABASE_SERVICE_ROLE_KEY is not set, so the stale incident pass cannot notify.",
      },
      { status: 503 },
    );
  }

  const supabase = createClient(settings.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("run_incident_notification_pass", {
    p_now: new Date().toISOString(),
    p_workspace_id: null,
  });

  if (error) {
    console.error("scheduled stale incident pass failed:", error.message);
    return NextResponse.json(
      { ok: false, error: "The stale incident pass failed. See server logs." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, result: data });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
