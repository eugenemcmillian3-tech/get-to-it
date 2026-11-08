/**
 * Platform self-healing policy.
 *
 * Only known recoverable failures are repaired automatically: abandoned AI
 * reservations and stale running agent tasks. A missing database or missing
 * configuration is escalated, never "fixed" by pretending the condition is
 * healthy. Deployment and production rollback stay outside this policy.
 */

export type PlatformHealthSnapshot = {
  configuration: "configured" | "missing";
  database: "ok" | "unavailable";
  model_provider: "configured" | "missing";
};

export type PlatformRecoveryPlan =
  | { action: "recover_stale_work"; severity: "ok"; reason: string }
  | { action: "escalate"; severity: "critical"; reason: string };

export function planPlatformRecovery(snapshot: PlatformHealthSnapshot): PlatformRecoveryPlan {
  if (snapshot.configuration === "missing") {
    return {
      action: "escalate",
      severity: "critical",
      reason: "Supabase is not configured; the platform cannot inspect or repair its own state.",
    };
  }
  if (snapshot.database !== "ok") {
    return {
      action: "escalate",
      severity: "critical",
      reason: "The database is unavailable; recovery is unsafe until connectivity returns.",
    };
  }
  return {
    action: "recover_stale_work",
    severity: "ok",
    reason:
      snapshot.model_provider === "missing"
        ? "Database is reachable. Recovering abandoned work; model-backed tasks stay unavailable until OLLAMA_API_KEY is set."
        : "Database is reachable. Checking for abandoned AI reservations and stale agent tasks.",
  };
}

export function selfHealingEnabled(value = process.env.PLATFORM_SELF_HEALING): boolean {
  return value !== "false";
}
