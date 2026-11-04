import {
  previewMigrations,
  redactSecrets,
  smokeFailureReason,
  sourceDigest,
  type DeploymentFile,
} from "@/lib/deployments";

/**
 * Phase 29 — release evidence and recovery contract.
 *
 * This module is pure. It never deploys, rolls back or writes data. Its job is
 * to make the evidence reviewable and to keep claims narrower than the evidence:
 * a passing check is one observation, not proof that no defects exist, and a
 * hypothesis is not a root cause until supporting evidence is recorded.
 */

export const RELEASE_CHECK_KINDS = ["health", "route", "error_rate", "smoke"] as const;
export type ReleaseCheckKind = (typeof RELEASE_CHECK_KINDS)[number];

export const RELEASE_CHECK_STATUSES = ["passed", "failed", "skipped", "not_run"] as const;
export type ReleaseCheckStatus = (typeof RELEASE_CHECK_STATUSES)[number];

export const RECOVERY_KINDS = ["patch", "code_rollback", "config_rollback", "database_recovery"] as const;
export type RecoveryKind = (typeof RECOVERY_KINDS)[number];

export const RECOVERY_LABELS: Record<RecoveryKind, string> = {
  patch: "Prepare an application patch",
  code_rollback: "Application code rollback",
  config_rollback: "Configuration rollback",
  database_recovery: "Database recovery",
};

export type ReleaseTestResult = {
  name: string;
  status: string;
  detail: string;
};

export type DependencyChange = {
  name: string;
  from: string | null;
  to: string | null;
};

export type MigrationRequirement = {
  path: string;
  destructive: string[];
  state: string;
  note: string;
};

export type ReleaseReview = {
  what_changed: string[];
  what_checked: string[];
  what_unverified: string[];
  affected_workflows: string[];
  recommended_manual_checks: string[];
  limitations: string[];
};

export type ReleaseEvidence = {
  source_revision: string;
  source_digest: string;
  changed_features: string[];
  test_results: ReleaseTestResult[];
  dependency_changes: DependencyChange[];
  migration_requirements: MigrationRequirement[];
  config_changes: string[];
  known_issues: string[];
  rollback_limitations: string[];
  review: ReleaseReview;
};

export type ReleaseDeploymentEvidence = {
  id: string;
  target: string;
  status: string;
  source_commit: string | null;
  deployment_url: string | null;
  migration_state: string;
  checks: { name: string; status: string; detail?: string }[];
  error: string | null;
  partial_failure: string | null;
};

export type ReleaseErrorEvidence = {
  message: string;
  status: string;
  release_label: string;
  created_at: string;
};

export type ReleaseChangeEvidence = {
  request: string;
  status: string;
  merged_version: number | null;
};

export type ReleaseEvidenceInput = {
  version: number;
  versionSummary: string;
  files: DeploymentFile[];
  previousFiles: DeploymentFile[];
  deployment: ReleaseDeploymentEvidence | null;
  changes: ReleaseChangeEvidence[];
  errors: ReleaseErrorEvidence[];
  envNames: string[];
  previousEnvNames: string[];
};

const ROLLBACK_LIMITATIONS = [
  "Application code rollback does not reverse a database migration, restore deleted rows or undo data written by the new release.",
  "Configuration rollback changes configuration only; it does not undo a code or database change.",
  "Database recovery is a separate operation. Restoring a backup can lose writes made after the recovery point.",
  "Redeploying an earlier source snapshot does not by itself move a host alias, rewrite repository history or revoke credentials.",
  "Automatic rollback is disabled by default; any prepared recovery still needs a human approval.",
];

const SECRET_PATTERN = /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?[^\s"']{8,}/i;

/** Evidence keeps no credential-shaped text, even if a source wrote one. */
export function redactReleaseText(value: string): string {
  const cleaned = SECRET_PATTERN.test(value)
    ? "A credential-like value was removed from this evidence."
    : value;
  return redactSecrets(cleaned).slice(0, 1_000);
}

function packageDependencies(files: DeploymentFile[]): Record<string, string> {
  const file = files.find((item) => item.path === "package.json");
  if (!file) return {};
  try {
    const parsed = JSON.parse(file.content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

export function dependencyChanges(
  previousFiles: DeploymentFile[],
  files: DeploymentFile[],
): DependencyChange[] {
  const before = packageDependencies(previousFiles);
  const after = packageDependencies(files);
  if (Object.keys(after).length === 0) return [];
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return names
    .filter((name) => before[name] !== after[name])
    .map((name) => ({ name, from: before[name] ?? null, to: after[name] ?? null }));
}

export function routePaths(files: DeploymentFile[]): string[] {
  return files
    .filter((file) => /^app\/.+\/page\.tsx$/.test(file.path) || file.path === "app/page.tsx")
    .map((file) =>
      file.path === "app/page.tsx"
        ? "/"
        : `/${file.path.replace(/^app\//, "").replace(/\/page\.tsx$/, "")}`,
    )
    .sort();
}

function changedLines(previousFiles: DeploymentFile[], files: DeploymentFile[]): string[] {
  const before = new Map(previousFiles.map((file) => [file.path, file.content]));
  const after = new Map(files.map((file) => [file.path, file.content]));
  const lines: string[] = [];
  for (const [path, content] of after) {
    if (!before.has(path)) lines.push(`Added ${path}.`);
    else if (before.get(path) !== content) lines.push(`Changed ${path}.`);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) lines.push(`Removed ${path}.`);
  }
  return lines.sort();
}

export function buildReleaseEvidence(input: ReleaseEvidenceInput): ReleaseEvidence {
  const migrations = previewMigrations(input.files).map((migration) => ({
    path: migration.path,
    destructive: migration.destructive,
    state: input.deployment?.migration_state ?? "not_recorded",
    note:
      migration.destructive.length > 0
        ? "Destructive pattern detected. A code rollback cannot reverse it."
        : "Forward migration. Verify whether it was applied before claiming a rollback is complete.",
  }));
  const routes = routePaths(input.files);
  const fileChanges = changedLines(input.previousFiles, input.files);
  const changes = input.changes
    .filter((change) => change.status === "merged")
    .map((change) => `Merged change: ${redactReleaseText(change.request).slice(0, 180)}`)
    .slice(0, 8);

  const addedEnv = input.envNames.filter((name) => !input.previousEnvNames.includes(name));
  const removedEnv = input.previousEnvNames.filter((name) => !input.envNames.includes(name));
  const configChanges = [
    ...addedEnv.map((name) => `Added configuration name ${name}.`),
    ...removedEnv.map((name) => `Removed configuration name ${name}.`),
    ...(input.envNames.length > 0
      ? [`${input.envNames.length} configuration name(s) are required by this version; no values are recorded here.`]
      : ["No configuration names were detected."]),
  ];

  const changedFeatures = [
    input.versionSummary,
    ...changes,
    ...routes.map((route) => `Route ${route}.`),
    ...fileChanges.slice(0, 10),
  ]
    .map((item) => redactReleaseText(item))
    .filter((item, index, all) => item.length > 0 && all.indexOf(item) === index)
    .slice(0, 20);

  const testResults: ReleaseTestResult[] = (input.deployment?.checks ?? []).map((check) => ({
    name: redactReleaseText(check.name),
    status: check.status,
    detail: redactReleaseText(check.detail ?? "No detail recorded."),
  }));

  const knownIssues = [
    ...input.errors.map(
      (error) =>
        `${error.status === "dismissed" ? "Dismissed" : "Open"} error (${error.release_label || "unlabelled release"}): ${redactReleaseText(error.message)}`,
    ),
    ...(input.deployment?.error ? [`Deployment error: ${redactReleaseText(input.deployment.error)}`] : []),
    ...(input.deployment?.partial_failure
      ? [`Partial deployment: ${redactReleaseText(input.deployment.partial_failure)}`]
      : []),
  ].slice(0, 12);

  const whatChecked = testResults.length
    ? testResults.map((result) => `${result.name}: ${result.status}. ${result.detail}`)
    : ["No post-deployment check result is recorded."];
  const unverified = [
    ...(input.deployment ? [] : ["No deployment is linked to this release."]),
    ...(testResults.length === 0 ? ["No configured post-deployment checks have run."] : []),
    ...testResults
      .filter((result) => result.status === "skipped")
      .map((result) => `${result.name} was skipped.`),
    ...(testResults.some((result) => result.status === "failed")
      ? ["At least one configured check failed; the release is not fully verified."]
      : []),
    ...(migrations.some((migration) => migration.destructive.length > 0)
      ? ["A destructive migration is present. Its data impact is not reversible by a code rollback."]
      : []),
    ...(input.previousFiles.length === 0
      ? ["There is no earlier source version to compare dependencies and configuration against."]
      : []),
    "Passing tests and checks do not establish that no defects exist.",
    "Third-party services, signed-in workflows and data migration effects remain unverified unless a configured check names them.",
  ];

  const review: ReleaseReview = {
    what_changed: changedFeatures.slice(0, 12),
    what_checked: whatChecked,
    what_unverified: unverified,
    affected_workflows: routes.length > 0 ? routes : ["No application routes were detected in this snapshot."],
    recommended_manual_checks: [
      "Open the changed routes and complete the primary user workflow.",
      "Verify sign-in and sign-out if the application uses accounts.",
      "Check a create, edit and delete path with a synthetic account and isolated test data.",
      "Confirm the migration state independently before treating a deployment as complete.",
      "Watch error events after the release; absence of recorded errors is not proof of health.",
    ],
    limitations: ROLLBACK_LIMITATIONS,
  };

  return {
    source_revision: input.deployment?.source_commit ?? "unknown",
    source_digest: sourceDigest(input.files),
    changed_features: changedFeatures,
    test_results: testResults,
    dependency_changes: dependencyChanges(input.previousFiles, input.files),
    migration_requirements: migrations,
    config_changes: configChanges,
    known_issues: knownIssues.length > 0 ? knownIssues : ["No known issues are recorded for this release."],
    rollback_limitations: ROLLBACK_LIMITATIONS,
    review,
  };
}

export type ReleaseCheckConfig = {
  id: string;
  name: string;
  kind: ReleaseCheckKind;
  target: string;
  expected_status: number;
  max_errors: number;
  instructions: string;
  synthetic: boolean;
  destructive: boolean;
  enabled: boolean;
};

export type CheckSafety = { runnable: boolean; reason: string };

/** A destructive check is never run against production by this phase. */
export function checkSafety(config: ReleaseCheckConfig, target: "preview" | "production"): CheckSafety {
  if (!config.enabled) return { runnable: false, reason: "The check is disabled." };
  if (config.destructive && target === "production") {
    return { runnable: false, reason: "Destructive checks are not run against production by default." };
  }
  if (config.kind === "smoke") {
    return { runnable: false, reason: "Functional smoke tests are recorded manually from a synthetic account." };
  }
  if (["health", "route"].includes(config.kind) && config.target.trim() === "") {
    return { runnable: false, reason: "Choose a relative route for this check." };
  }
  return { runnable: true, reason: "" };
}

export function evaluateHttpCheck(
  kind: "health" | "route",
  status: number,
  contentType: string | null,
  body: string,
): { status: ReleaseCheckStatus; detail: string } {
  if (kind === "health") {
    const reason = smokeFailureReason(status, contentType, body);
    return {
      status: reason ? "failed" : "passed",
      detail: reason ?? `HTTP ${status} HTML response received.`,
    };
  }
  return {
    status: status >= 200 && status < 400 ? "passed" : "failed",
    detail: `HTTP ${status}; content type ${contentType ?? "unknown"}.`,
  };
}

export type RecoveryPlan = {
  kind: RecoveryKind;
  label: string;
  steps: string[];
  limitations: string[];
  does_not_reverse_database: boolean;
};

/** Prepare instructions; never execute them. */
export function buildRecoveryPlan(
  kind: RecoveryKind,
  context: { releaseVersion: number; sourceRevision: string; migrationState: string },
): RecoveryPlan {
  const common = [
    "This is a prepared recommendation. A human must approve it before any separate execution.",
    ROLLBACK_LIMITATIONS[0],
    ROLLBACK_LIMITATIONS[2],
  ];

  if (kind === "patch") {
    return {
      kind,
      label: RECOVERY_LABELS[kind],
      steps: [
        "Open a bounded maintenance change against the failing release; do not edit production in place.",
        "Add a regression test for the observed failure and run the project checks.",
        "Produce an isolated preview and request review of the exact diff.",
        "Deploy through a new, separately approved deployment once checks pass.",
      ],
      limitations: [
        ...common,
        "A patch is not deployed by this plan; deployment remains a separate approval.",
        "The diagnosis may be incomplete, so the patch may not address the true cause.",
      ],
      does_not_reverse_database: true,
    };
  }

  if (kind === "code_rollback") {
    return {
      kind,
      label: RECOVERY_LABELS[kind],
      steps: [
        `Identify the last known good source snapshot before version ${context.releaseVersion}.`,
        "Create a new deployment plan from that snapshot; do not rewrite repository history.",
        "Run the same configured checks against the rolled-back deployment.",
        "Record whether the database migration remains applied; if it does, verify the old code still works with it.",
      ],
      limitations: [
        ...common,
        "Application code rollback does not reverse a destructive migration.",
        `Recorded migration state: ${context.migrationState}. A code rollback is not a database recovery.`,
      ],
      does_not_reverse_database: true,
    };
  }

  if (kind === "config_rollback") {
    return {
      kind,
      label: RECOVERY_LABELS[kind],
      steps: [
        "Compare the current configuration names and non-secret settings with the previous version.",
        "Restore only the changed configuration values in the target environment.",
        "Restart or redeploy only if the host requires it; do not change source code.",
        "Re-run the configured checks and record what remains different.",
      ],
      limitations: [
        ...common,
        "Configuration rollback does not undo application code or database changes.",
        "Secret values are not shown by this evidence record; rotate them at the provider if exposure is suspected.",
      ],
      does_not_reverse_database: false,
    };
  }

  return {
    kind: "database_recovery",
    label: RECOVERY_LABELS.database_recovery,
    steps: [
      "Stop writes or place the application in a controlled maintenance state.",
      "Choose a recovery point and restore into an isolated database first.",
      "Verify the restored schema and representative data before changing the production target.",
      "Record the expected data loss window, then request separate approval for the production recovery.",
    ],
    limitations: [
      ...common,
      "Database recovery can lose writes made after the recovery point.",
      "Restoring a database is not an application code rollback and does not move a host alias.",
    ],
    does_not_reverse_database: false,
  };
}

export type AutomationSetting = {
  auto_rollback_enabled: boolean;
  conditions: string[];
  limitations: string;
};

export function automationProblems(setting: AutomationSetting): string[] {
  const problems: string[] = [];
  if (
    setting.auto_rollback_enabled &&
    setting.conditions.map((condition) => condition.trim()).filter(Boolean).length === 0
  ) {
    problems.push("Automatic rollback needs at least one explicit condition.");
  }
  if (setting.auto_rollback_enabled && setting.limitations.trim().length < 10) {
    problems.push("Automatic rollback needs known limitations.");
  }
  return problems;
}

export type IncidentDiagnosis = {
  hypothesis: string;
  supportingEvidence: string;
  root_cause: null;
  root_cause_confirmed: false;
  caveat: string;
};

/**
 * The UI only proposes a diagnosis. It deliberately has no path that records a
 * confirmed root cause from a hypothesis alone.
 */
export function proposeDiagnosis(hypothesis: string, supportingEvidence: string): IncidentDiagnosis {
  if (hypothesis.trim().length < 5) throw new Error("Describe a hypothesis first.");
  if (supportingEvidence.trim().length < 5) throw new Error("Record the evidence that supports the hypothesis.");
  return {
    hypothesis: redactReleaseText(hypothesis),
    supportingEvidence: redactReleaseText(supportingEvidence),
    root_cause: null,
    root_cause_confirmed: false,
    caveat: "Hypothesis only. The root cause remains unconfirmed until stronger evidence is recorded.",
  };
}
