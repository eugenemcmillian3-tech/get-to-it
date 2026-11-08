import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasOllamaKey } from "@/lib/ai/ollama";
import { cronRequestAuthorized } from "@/lib/cron-auth";
import { logOperational, logOperationalError } from "@/lib/log";
import { planPlatformRecovery, selfHealingEnabled } from "@/lib/platform-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Platform self-healing pass.
 *
 * Call it from a scheduled job with `Authorization: Bearer $CRON_SECRET`.
 * It recovers only known recoverable failures:
 *   - abandoned in-flight AI credit reservations
 *   - agent tasks left running by a worker that disappeared
 *
 * A missing database or configuration is escalated in the response, never
 * papered over. This route does not deploy, roll back or call a model.
 */

async function run(request: Request) {
  if (!selfHealingEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Platform self-healing is disabled." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set, so platform recovery is disabled." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  if (!cronRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    logOperational("platform_recovery", { outcome: "degraded", configuration: "missing" });
    return NextResponse.json(
      {
        ok: false,
        error:
          "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for platform recovery.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: probe, error: probeError } = await supabase.rpc("health_probe");
  const databaseOk = !probeError && (probe as { ok?: boolean } | null)?.ok === true;

  const plan = planPlatformRecovery({
    configuration: "configured",
    database: databaseOk ? "ok" : "unavailable",
    model_provider: hasOllamaKey() ? "configured" : "missing",
  });

  if (plan.action === "escalate") {
    logOperational("platform_recovery", { outcome: "escalated", database: "unavailable" });
    return NextResponse.json(
      { ok: false, action: plan.action, severity: plan.severity, reason: plan.reason },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const { data: aiRecovery, error: aiError } = await supabase.rpc("recover_stale_ai_requests");
  if (aiError) {
    logOperationalError("platform_recovery_ai", aiError.code ?? "rpc_failed");
    return NextResponse.json(
      {
        ok: false,
        action: "escalate",
        severity: "critical",
        reason: "The AI reservation recovery function failed. Deploy migration 0044 first.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const { data: taskRecovery, error: taskError } = await supabase.rpc("recover_stale_team_tasks");
  if (taskError) {
    logOperationalError("platform_recovery_tasks", taskError.code ?? "rpc_failed");
    return NextResponse.json(
      {
        ok: false,
        action: "escalate",
        severity: "critical",
        reason: "The agent-task recovery function failed. Deploy migration 0044 first.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  logOperational("platform_recovery", {
    outcome: "ok",
    database: "ok",
    model_provider: hasOllamaKey() ? "configured" : "missing",
  });

  return NextResponse.json(
    {
      ok: true,
      action: plan.action,
      reason: plan.reason,
      recovery: { ai: aiRecovery, tasks: taskRecovery },
      checked_at: new Date().toISOString(),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
