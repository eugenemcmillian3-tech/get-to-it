import { describe, expect, it } from "vitest";
import type { AppSpec } from "@/lib/app-builder";
import {
  EXPERIMENT_LIMITS,
  buildExperimentPlan,
  buildProjectModel,
  buildScenarioAnalysis,
  diffProjectModels,
  formatProjectModelChangelog,
  executeExperiment,
  validateExperimentInput,
  validateScenarioInput,
  type ProjectModelInput,
} from "@/lib/project-model";
import { buildModelSource, modelStaleness } from "@/lib/project-model-source";

const spec: AppSpec = {
  stack: "nextjs-typescript-tailwind",
  purpose: "Keep small projects organised.",
  features: ["Create and review projects", "Show a project status"],
  exclusions: ["No billing automation."],
  pages: [
    { path: "/", title: "Home", purpose: "Start a project." },
    { path: "/projects", title: "Projects", purpose: "Review the project list." },
  ],
  navigation: [
    { label: "Home", href: "/" },
    { label: "Projects", href: "/projects" },
  ],
  entities: [{ name: "project", fields: ["title", "status"] }],
  server_operations: [{ entity: "project", operations: ["list", "create"] }],
  authorization_rules: ["Only the owner can create a project."],
  integrations: [{ name: "Billing", env_var: "INTEGRATION_BILLING_API_KEY", mocked: true }],
  env_vars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "INTEGRATION_BILLING_API_KEY"],
  acceptance_checks: ["A project can be created."],
  supabase: true,
  design_preferences: "Plain and calm.",
  definition_of_done: "A project can be created and reviewed.",
};

const files = [
  {
    path: "app/page.tsx",
    content: 'import { listProjects } from "@/lib/projects";\n\nexport default async function Page() {\n  const projects = await listProjects();\n  await fetch("/api/projects");\n  return <main>{projects.length}</main>;\n}\n',
  },
  {
    path: "app/projects/page.tsx",
    content: 'import { listProjects } from "@/lib/projects";\nexport default async function Page() { return <main>{listProjects.length}</main>; }\n',
  },
  {
    path: "app/api/projects/route.ts",
    content: 'import { z } from "zod";\nimport { createClient } from "@/lib/supabase/server";\nimport { listProjects } from "@/lib/projects";\nconst schema = z.object({ title: z.string(), status: z.string() });\nexport async function GET() { return Response.json(await listProjects()); }\nexport async function POST(request: Request) {\n  const supabase = await createClient();\n  const { data: { user } } = await supabase.auth.getUser();\n  if (!user) return Response.json({ error: "Sign in." }, { status: 401 });\n  try { schema.parse(await request.json()); } catch { return Response.json({ error: "Bad input" }, { status: 400 }); }\n  return Response.json({ user_id: user.id });\n}\n',
  },
  {
    path: "lib/projects.ts",
    content: 'export async function listProjects() {\n  return [{ title: "One", status: "active" }];\n}\n',
  },
  {
    path: "lib/supabase/server.ts",
    content: 'export async function createClient() { return { auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }; }\n',
  },
  {
    path: "tests/projects.test.ts",
    content: 'import { describe, it } from "vitest";\ndescribe("projects", () => { it("works", () => {}); });\n',
  },
];

const input: ProjectModelInput = {
  project: {
    id: "project-1",
    name: "Projects",
    purpose: "Keep small projects organised.",
    target_users: "Small teams",
    current_version: 3,
    auth_requirements: "supabase",
  },
  spec: { version: 2, approved_at: "2026-11-01T00:00:00.000Z", spec },
  files,
  integrations: [
    {
      id: "integration-1",
      name: "Billing",
      kind: "openapi_http",
      status: "connected",
      allowed_operations: ["listInvoices"],
      last_test_status: "passed",
      updated_at: "2026-11-02T00:00:00.000Z",
    },
  ],
  deployments: [
    {
      id: "deployment-1",
      target: "production",
      status: "succeeded",
      snapshot_version: 2,
      source_commit: "abc123",
      deployment_url: "https://example.test",
      created_at: "2026-11-03T00:00:00.000Z",
    },
  ],
};

describe("versioned project model", () => {
  it("models pages, journeys, services, entities, integrations and environments", () => {
    const model = buildProjectModel(input);

    expect(model.pages.map((page) => page.label)).toEqual(["Home", "Projects"]);
    expect(model.journeys).toHaveLength(2);
    expect(model.services.some((service) => service.label === "/api/projects")).toBe(true);
    expect(model.dependencies.some((edge) => edge.kind === "calls_api")).toBe(true);
    expect(model.entities.some((entity) => entity.label === "project.status")).toBe(true);
    expect(model.integrations[0]?.metadata?.status).toBe("connected");
    expect(model.environments.find((environment) => environment.id === "environment:production")?.metadata?.status).toBe(
      "succeeded",
    );
    expect(model.constraints.join(" ")).toMatch(/No measured CPU, memory, latency/i);
    expect(model.missing_information.join(" ")).toMatch(/runtime request traces/i);
    expect(model.basis).toBe("static_source");
  });

  it("records a source revision and detects a changed project or spec", () => {
    const source = buildModelSource(input);
    expect(source.source_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(modelStaleness({ ...source }, source).stale).toBe(false);
    expect(
      modelStaleness(
        {
          spec_version: 1,
          app_version: 2,
          source_digest: source.source_digest,
        },
        source,
      ).reasons,
    ).toEqual([
      "The specification changed from version 1 to 2.",
      "The project changed from version 2 to 3.",
    ]);
    expect(
      modelStaleness(
        { spec_version: 2, app_version: 3, source_digest: "0".repeat(64) },
        source,
      ).stale,
    ).toBe(true);
  });

  it("marks a draft specification as an explicit limitation", () => {
    const model = buildProjectModel({
      ...input,
      spec: { version: 3, approved_at: null, spec },
    });
    expect(model.assumptions.join(" ")).toMatch(/draft specification version 3/i);
    expect(model.missing_information).toContain("No approved specification exists for this project.");
  });

  it("diffs stored versions by page, dependency, integration, deployment and assumption", () => {
    const before = buildProjectModel(input);
    const changedSpec: AppSpec = {
      ...spec,
      pages: [
        { path: "/", title: "Start", purpose: "Start a project." },
        ...spec.pages.slice(1),
        { path: "/settings", title: "Settings", purpose: "Configure the project." },
      ],
    };
    const changedFiles = files.map((file) =>
      file.path === "app/page.tsx"
        ? {
            ...file,
            content: 'import { listProjects } from "@/lib/projects";\n\nexport default async function Page() {\n  const projects = await listProjects();\n  return <main>{projects.length}</main>;\n}\n',
          }
        : file,
    );
    const after = buildProjectModel({
      ...input,
      spec: { version: 3, approved_at: null, spec: changedSpec },
      files: changedFiles,
      integrations: [
        {
          ...input.integrations[0]!,
          status: "disconnected",
          last_test_status: "failed",
        },
      ],
      deployments: [
        {
          ...input.deployments[0]!,
          status: "failed",
          snapshot_version: 4,
        },
      ],
    });

    const diff = diffProjectModels(before, after);
    const home = diff.pages.find((page) => page.key === "page:/");
    const settings = diff.pages.find((page) => page.key === "page:/settings");
    const removedApiCall = diff.dependencies.find(
      (edge) => edge.status === "removed" && edge.label.includes("/api/projects"),
    );
    const integration = diff.integrations.find((item) => item.key === "integration:Billing");
    const environment = diff.environments.find((item) => item.key === "environment:production");

    expect(home?.status).toBe("changed");
    expect(home?.changes).toContainEqual({ field: "label", before: "Home", after: "Start" });
    expect(settings?.status).toBe("added");
    expect(removedApiCall?.status).toBe("removed");
    expect(integration?.status).toBe("changed");
    expect(integration?.changes).toContainEqual({
      field: "metadata.status",
      before: "connected",
      after: "disconnected",
    });
    expect(environment?.status).toBe("changed");
    expect(environment?.changes).toContainEqual({
      field: "metadata.snapshot_version",
      before: "2",
      after: "4",
    });
    expect(diff.assumptions.some((item) => item.status === "added" && /draft specification/i.test(item.value))).toBe(true);
    expect(diff.counts.total).toBeGreaterThan(0);
    expect(diff.counts.added + diff.counts.removed + diff.counts.changed).toBe(diff.counts.total);

    const changelog = formatProjectModelChangelog({
      project_name: "Projects",
      from: {
        version: 1,
        spec_version: 2,
        app_version: 3,
        source_digest: "a".repeat(64),
        created_at: "2026-11-03T00:00:00.000Z",
      },
      to: {
        version: 2,
        spec_version: 3,
        app_version: 4,
        source_digest: "b".repeat(64),
        created_at: "2026-11-04T00:00:00.000Z",
      },
      diff,
    });
    expect(changelog).toContain("# Project model changelog: Projects");
    expect(changelog).toContain("## Pages");
    expect(changelog).toContain("### Changed: Start");
    expect(changelog).toContain("#### metadata.status");
    expect(changelog).toContain("connected");
    expect(changelog).toContain("disconnected");
    expect(changelog).toContain("## Deployment environments");
    expect(changelog).toContain("## Assumptions");
    expect(changelog).toContain("draft specification");
    expect(changelog).toContain("## Missing information");
    expect(changelog).toContain("No changes.");
    expect(changelog.endsWith("\n")).toBe(true);
  });

  it("reports no changes for identical snapshots", () => {
    const model = buildProjectModel(input);
    expect(diffProjectModels(model, model).counts).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
      total: 0,
    });
  });
});

describe("change scenarios", () => {
  const model = buildProjectModel(input);
  const api = buildScenarioAnalysis(model, {
    kind: "api_change",
    question: "What is affected if the projects API changes?",
    target: "/api/projects",
  });

  it("traces an API change to static callers with evidence", () => {
    expect(api.affected.map((item) => item.label)).toContain("Home");
    expect(api.affected.some((item) => item.label === "/api/projects")).toBe(true);
    expect(api.evidence.some((item) => item.path === "app/page.tsx")).toBe(true);
    expect(api.basis).toBe("static_model");
    expect(api.measured_results).toEqual([]);
    expect(api.proposed_tests.join(" ")).toMatch(/synthetic payload/i);
    expect(api.unknowns.join(" ")).toMatch(/do not prove|not prove/i);
    expect(JSON.stringify(api)).not.toMatch(/\b\d+(\.\d+)?\s?(ms|seconds|dollars|percent)\b/i);
  });

  it("returns no affected component when the target is absent instead of inventing one", () => {
    const missing = buildScenarioAnalysis(model, {
      kind: "api_change",
      question: "What changes for an endpoint that does not exist?",
      target: "/api/unknown",
    });
    expect(missing.affected).toEqual([]);
    expect(missing.unknowns.join(" ")).toMatch(/no matching/i);
  });

  it("covers roles, background jobs and database fields", () => {
    const role = buildScenarioAnalysis(model, {
      kind: "new_user_role",
      question: "What does a reviewer role require?",
      target: "reviewer",
    });
    const job = buildScenarioAnalysis(model, {
      kind: "background_job",
      question: "What changes for a reminder job?",
      target: "project reminders",
    });
    const field = buildScenarioAnalysis(model, {
      kind: "database_field",
      question: "What depends on project status?",
      target: "project.status",
    });

    expect(role.affected.length).toBeGreaterThan(0);
    expect(role.proposed_tests.join(" ")).toMatch(/permission matrix/i);
    expect(job.proposed_tests.join(" ")).toMatch(/idempotency/i);
    expect(field.affected.map((item) => item.label)).toContain("project.status");
    expect(field.proposed_tests.join(" ")).toMatch(/legacy-row/i);
  });

  it("refuses external targets and malformed fields", () => {
    expect(
      validateScenarioInput({
        kind: "api_change",
        question: "Change an external API?",
        target: "https://example.com/api",
      }),
    ).toMatch(/external URLs/i);
    expect(
      validateScenarioInput({
        kind: "database_field",
        question: "Change a field?",
        target: "project",
      }),
    ).toMatch(/entity.field/i);
  });
});

describe("bounded experiments", () => {
  const model = buildProjectModel(input);
  const analysis = buildScenarioAnalysis(model, {
    kind: "api_change",
    question: "What is affected if the projects API changes?",
    target: "/api/projects",
  });
  const baseInput = {
    kind: "contract_check" as const,
    target: "/api/projects",
    requested_requests: 1,
    max_duration_ms: 15_000,
  };

  it("enforces request, duration and internal-target limits", () => {
    expect(validateExperimentInput({ ...baseInput, requested_requests: 0 })).toMatch(/Requests/);
    expect(
      validateExperimentInput({ ...baseInput, requested_requests: EXPERIMENT_LIMITS.maxRequests + 1 }),
    ).toMatch(/Requests/);
    expect(validateExperimentInput({ ...baseInput, max_duration_ms: 999 })).toMatch(/Duration/);
    expect(validateExperimentInput({ ...baseInput, target: "https://example.com" })).toMatch(
      /External URLs/,
    );
  });

  it("creates a source-only contract plan and task proposal", () => {
    const plan = buildExperimentPlan(model, analysis, baseInput);
    expect(plan.data_handling).toBe("source_code_only");
    expect(plan.external_calls).toBe(false);
    expect(plan.task_title).toMatch(/^Experiment:/);
    expect(plan.scope_paths.length).toBeGreaterThan(0);
    expect(plan.scope_paths.length).toBeLessThanOrEqual(12);
    expect(plan.task_description).toMatch(/No performance or cost forecast/);

    const outcome = executeExperiment(plan, files, { authRequired: true });
    expect(outcome.status).toBe("passed");
    expect(outcome.observations.some((item) => item.name === "auth" && item.status === "passed")).toBe(true);
    expect(outcome.note).toMatch(/Static contract inspection only/);
  });

  it("blocks synthetic requests without an isolated runner and never contacts a service", () => {
    const plan = buildExperimentPlan(model, analysis, {
      ...baseInput,
      kind: "synthetic_requests",
      requested_requests: 20,
    });
    const outcome = executeExperiment(plan, files, { authRequired: true });
    expect(outcome.status).toBe("blocked");
    expect(outcome.note).toMatch(/Blocked before execution/);
    expect(outcome.observations[0]?.detail).toMatch(/No request was sent/);
  });

  it("measures source size for resource observation without claiming runtime metrics", () => {
    const plan = buildExperimentPlan(model, analysis, {
      ...baseInput,
      kind: "resource_observation",
    });
    const outcome = executeExperiment(plan, files, { authRequired: true });
    expect(outcome.status).toBe("passed");
    expect(outcome.observations.map((item) => item.name)).toEqual([
      "stored files",
      "source characters",
      "source lines",
    ]);
    expect(outcome.note).toMatch(/No CPU, memory, latency or cost/);
  });
});
