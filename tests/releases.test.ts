import { describe, expect, it } from "vitest";
import {
  automationProblems,
  buildRecoveryPlan,
  buildReleaseEvidence,
  checkSafety,
  evaluateHttpCheck,
  proposeDiagnosis,
  type ReleaseCheckConfig,
} from "@/lib/releases";

const previousFiles = [
  {
    path: "package.json",
    content: JSON.stringify({ dependencies: { next: "15.0.0", react: "18.0.0" } }),
  },
  { path: "app/page.tsx", content: "export default function Page(){return null}" },
  {
    path: "supabase/migrations/0001_init.sql",
    content: "create table repairs (id uuid primary key);",
  },
];

const files = [
  {
    path: "package.json",
    content: JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0", zod: "4.0.0" } }),
  },
  { path: "app/page.tsx", content: "export default function Page(){return <main>Changed</main>}" },
  { path: "app/repairs/page.tsx", content: "export default function Page(){return <main>Repairs</main>}" },
  {
    path: "supabase/migrations/0002_cleanup.sql",
    content: "drop table old_repairs;",
  },
  { path: ".env.example", content: "NEXT_PUBLIC_SUPABASE_URL=\nSUPABASE_SERVICE_KEY=\n" },
];

const deployment = {
  id: "d1",
  target: "preview",
  status: "succeeded",
  source_commit: "abc1234",
  deployment_url: "https://preview.example.test",
  migration_state: "not_applied_preview",
  checks: [
    { name: "Home page", status: "passed", detail: "HTTP 200 HTML response received." },
    { name: "Repairs", status: "skipped", detail: "No deployment URL." },
  ],
  error: null,
  partial_failure: null,
};

function config(overrides: Partial<ReleaseCheckConfig> = {}): ReleaseCheckConfig {
  return {
    id: "c1",
    name: "Home",
    kind: "health",
    target: "/",
    expected_status: 200,
    max_errors: 0,
    instructions: "",
    synthetic: true,
    destructive: false,
    enabled: true,
    ...overrides,
  };
}

describe("release evidence and review", () => {
  it("assembles source, feature, dependency, migration, configuration and issue evidence", () => {
    const evidence = buildReleaseEvidence({
      version: 2,
      versionSummary: "Added a repairs route.",
      files,
      previousFiles,
      deployment,
      changes: [{ request: "Add repairs route", status: "merged", merged_version: 2 }],
      errors: [
        {
          message: "api_key = should-not-appear",
          status: "new",
          release_label: "v2",
          created_at: "2026-11-01",
        },
      ],
      envNames: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_KEY"],
      previousEnvNames: ["NEXT_PUBLIC_SUPABASE_URL"],
    });

    expect(evidence.source_revision).toBe("abc1234");
    expect(evidence.source_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.changed_features.join(" ")).toContain("Added a repairs route");
    expect(evidence.changed_features.join(" ")).toContain("/repairs");
    expect(evidence.dependency_changes).toEqual(
      expect.arrayContaining([
        { name: "next", from: "15.0.0", to: "16.0.0" },
        { name: "zod", from: null, to: "4.0.0" },
      ]),
    );
    expect(evidence.migration_requirements[0].path).toContain("0002_cleanup.sql");
    expect(evidence.migration_requirements[0].destructive.join(" ")).toMatch(/DROP/);
    expect(evidence.config_changes.join(" ")).toContain("SUPABASE_SERVICE_KEY");
    expect(JSON.stringify(evidence)).not.toContain("should-not-appear");
    expect(evidence.review.what_unverified.join(" ")).toContain("do not establish that no defects exist");
    expect(evidence.rollback_limitations.join(" ")).toMatch(/does not reverse a database migration/i);
  });

  it("never produces a readiness percentage or equates passing tests with safety", () => {
    const evidence = buildReleaseEvidence({
      version: 2,
      versionSummary: "Small change.",
      files,
      previousFiles,
      deployment,
      changes: [],
      errors: [],
      envNames: [],
      previousEnvNames: [],
    });
    const review = JSON.stringify(evidence.review).toLowerCase();
    expect(review).not.toContain("safe to deploy");
    expect(review).not.toContain("readiness score");
    expect(review).not.toContain("%");
    expect(evidence.review.what_unverified.join(" ")).toContain("no defects exist");
    expect(evidence.review.what_checked.join(" ")).toContain("Home page: passed");
    expect(evidence.review.what_unverified.join(" ")).toContain("Repairs was skipped");
  });
});

describe("post-deployment check safety", () => {
  it("skips destructive checks on production and leaves functional tests manual", () => {
    expect(checkSafety(config({ destructive: true }), "production")).toEqual({
      runnable: false,
      reason: "Destructive checks are not run against production by default.",
    });
    expect(checkSafety(config({ destructive: true }), "preview").runnable).toBe(true);
    expect(checkSafety(config({ kind: "smoke", instructions: "Log in and create a repair" }), "preview")).toEqual({
      runnable: false,
      reason: "Functional smoke tests are recorded manually from a synthetic account.",
    });
    expect(checkSafety(config({ target: "" }), "preview").runnable).toBe(false);
  });

  it("does not treat an error page or a non-HTML body as healthy", () => {
    expect(evaluateHttpCheck("health", 500, "text/html", "Internal Server Error").status).toBe("failed");
    expect(evaluateHttpCheck("health", 200, "application/json", "{\"ok\":true}").status).toBe("failed");
    expect(evaluateHttpCheck("health", 200, "text/html", "x".repeat(200)).status).toBe("passed");
    expect(evaluateHttpCheck("route", 404, "text/html", "not found").status).toBe("failed");
  });
});

describe("controlled recovery and automation", () => {
  it("keeps code rollback, configuration rollback and database recovery distinct", () => {
    const code = buildRecoveryPlan("code_rollback", {
      releaseVersion: 2,
      sourceRevision: "abc1234",
      migrationState: "applied",
    });
    const config = buildRecoveryPlan("config_rollback", {
      releaseVersion: 2,
      sourceRevision: "abc1234",
      migrationState: "applied",
    });
    const database = buildRecoveryPlan("database_recovery", {
      releaseVersion: 2,
      sourceRevision: "abc1234",
      migrationState: "applied",
    });

    expect(code.kind).toBe("code_rollback");
    expect(code.limitations.join(" ")).toContain("does not reverse a destructive migration");
    expect(code.does_not_reverse_database).toBe(true);
    expect(config.kind).toBe("config_rollback");
    expect(config.limitations.join(" ")).toContain("does not undo application code or database changes");
    expect(database.kind).toBe("database_recovery");
    expect(database.limitations.join(" ")).toContain("can lose writes");
    expect(database.does_not_reverse_database).toBe(false);
    expect(code.steps.join(" ")).toContain("new deployment plan");
    expect(code.steps.join(" ")).not.toContain("rollback executed");
  });

  it("requires conditions and limitations before enabling automatic rollback", () => {
    expect(
      automationProblems({
        auto_rollback_enabled: true,
        conditions: [],
        limitations: "",
      }),
    ).toHaveLength(2);
    expect(
      automationProblems({
        auto_rollback_enabled: true,
        conditions: ["A health check fails twice"],
        limitations: "Cannot reverse a destructive migration.",
      }),
    ).toEqual([]);
    expect(
      automationProblems({
        auto_rollback_enabled: false,
        conditions: [],
        limitations: "",
      }),
    ).toEqual([]);
  });

  it("records a hypothesis without claiming a root cause", () => {
    const diagnosis = proposeDiagnosis(
      "The new route may be reading a missing environment value.",
      "The failed check returned HTTP 500 after the config name changed.",
    );
    expect(diagnosis.root_cause).toBeNull();
    expect(diagnosis.root_cause_confirmed).toBe(false);
    expect(diagnosis.caveat).toContain("remains unconfirmed");
    expect(() => proposeDiagnosis("Invalid", "tiny")).toThrow(/evidence/i);
  });
});
