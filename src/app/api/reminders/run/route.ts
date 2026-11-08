import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cronRequestAuthorized } from "@/lib/cron-auth";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Scheduled reminder pass.
 *
 * Protected by a bearer secret (`CRON_SECRET`), which the host supplies — on
 * Vercel this is what a cron invocation sends automatically once the variable is
 * set. It runs the same idempotent database pass as the inbox, for every person,
 * so delivery does not depend on a browser tab being open.
 *
 * If no secret is configured the endpoint refuses to run rather than pretending
 * to have delivered anything.
 */
async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET is not set, so the scheduled reminder pass is disabled.",
      },
      { status: 503 },
    );
  }

  if (!cronRequestAuthorized(request, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const settings = getSupabaseSettings();
  if (!settings) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured on this deployment." },
      { status: 503 },
    );
  }

  const supabase = createClient(settings.url, settings.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("run_reminder_pass", {
    p_user: null,
  });

  if (error) {
    console.error("scheduled reminder pass failed:", error.message);
    return NextResponse.json(
      { ok: false, error: "The reminder pass failed. See server logs." },
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
