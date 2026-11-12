/**
 * Whether a promoted change is still live. Derived only from evidence the
 * deployment and release tables actually hold — deployment status, a resolved
 * rollback incident on that deployment, and any later deployment to the same
 * target — so nothing here is guessed.
 */

export type PromotionLiveState =
  | "rolled_back"
  | "superseded"
  | "live"
  | "failed"
  | "not_deployed"
  | "unknown";

export type PromotionDeploymentEvidence = {
  id: string;
  target: string;
  status: string;
  created_at: string;
};

export type PromotionRollbackEvidence = {
  title: string;
  recovery_kind: "code_rollback" | "config_rollback";
  resolved_at: string | null;
};

export type PromotionLaterDeployment = {
  id: string;
  target: string;
  created_at: string;
};

export type PromotionState = {
  state: PromotionLiveState;
  label: string;
  detail: string;
};

const SHIPPED = new Set(["succeeded"]);
const FAILED = new Set(["failed", "partial_failure"]);

function when(value: string | null): string {
  if (!value) return "at an unrecorded time";
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

export function promotionState(input: {
  deployment: PromotionDeploymentEvidence | null;
  rollback?: PromotionRollbackEvidence | null;
  laterDeployment?: PromotionLaterDeployment | null;
}): PromotionState {
  const { deployment, rollback, laterDeployment } = input;

  if (rollback) {
    const kind = rollback.recovery_kind === "code_rollback" ? "code rollback" : "config rollback";
    return {
      state: "rolled_back",
      label: "Rolled back",
      detail: `${kind} recorded ${when(rollback.resolved_at)}: ${rollback.title}`,
    };
  }

  if (!deployment) {
    return {
      state: "unknown",
      label: "No deployment evidence",
      detail: "the deployment record is gone, so liveness cannot be confirmed",
    };
  }

  if (FAILED.has(deployment.status)) {
    return {
      state: "failed",
      label: "Deployment failed",
      detail: `the ${deployment.target} deployment ended ${deployment.status.replaceAll("_", " ")}`,
    };
  }

  // A change that never shipped cannot have been superseded by a later ship.
  if (!SHIPPED.has(deployment.status)) {
    return {
      state: "not_deployed",
      label: "Not deployed yet",
      detail: `the ${deployment.target} deployment is ${deployment.status.replaceAll(
        "_",
        " ",
      )}; the change has not shipped`,
    };
  }

  if (laterDeployment) {
    return {
      state: "superseded",
      label: "Superseded",
      detail: `a later ${laterDeployment.target} deployment succeeded ${when(
        laterDeployment.created_at,
      )}, so this change is no longer the newest one shipped`,
    };
  }

  if (SHIPPED.has(deployment.status)) {
    return {
      state: "live",
      label: "Live",
      detail: `the ${deployment.target} deployment succeeded and no rollback is recorded`,
    };
  }

  return {
    state: "live",
    label: "Live",
    detail: `the ${deployment.target} deployment succeeded and no rollback is recorded`,
  };
}

export type IncidentAge = { hours: number; label: string; stale: boolean };

/**
 * How long an incident has been open, in whole hours. An incident open for a
 * day or more is stale: it means nobody has closed it in a working day.
 */
export function incidentAge(openedAt: string, now: Date = new Date()): IncidentAge {
  const started = new Date(openedAt).getTime();
  const hours = Number.isFinite(started)
    ? Math.max(0, Math.floor((now.getTime() - started) / 3_600_000))
    : 0;
  if (hours < 1) return { hours, label: "under an hour", stale: false };
  if (hours < 24) return { hours, label: `${hours} h`, stale: false };
  const days = Math.floor(hours / 24);
  return { hours, label: days === 1 ? "1 day" : `${days} days`, stale: true };
}
