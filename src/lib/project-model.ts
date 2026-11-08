import { PROJECT_LIMITS, type AppSpec } from "@/lib/app-builder";

/**
 * Phase 33 — project model and change scenarios.
 *
 * This module is deliberately pure. It reads a specification, stored files,
 * integration metadata and deployment records, then states only what those
 * records show. Dependency edges are static imports or literal `/api` fetch
 * calls. They are not runtime traces, and no scenario makes a performance or
 * cost forecast.
 */

export const MODEL_BASIS_NOTE =
  "This is a static model built from the stored specification, files, integration metadata and deployment records. It does not prove runtime behavior.";

export const SCENARIO_BASIS_NOTE =
  "Narrative scenario from static source evidence. No request, load test or production observation was made.";

export const MODEL_LIMITS = {
  maxEvidencePerItem: 8,
  maxAffected: 20,
  maxJourneys: 20,
  maxDependencies: 240,
  maxScopePaths: 12,
} as const;

export const EXPERIMENT_LIMITS = {
  maxPerScenario: 4,
  minRequests: 1,
  maxRequests: 20,
  minDurationMs: 1_000,
  maxDurationMs: 30_000,
} as const;

export type EvidenceSource = "spec" | "code" | "integration" | "deployment" | "project" | "scenario";

export type ModelEvidence = {
  source: EvidenceSource;
  detail: string;
  path?: string;
  line?: number;
};

export type ModelNodeKind =
  | "page"
  | "route"
  | "service"
  | "package"
  | "entity"
  | "field"
  | "integration"
  | "environment";

export type ModelNode = {
  id: string;
  kind: ModelNodeKind;
  label: string;
  summary: string;
  evidence: ModelEvidence[];
  metadata?: Record<string, string | number | boolean | null>;
};

export type ModelJourney = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  evidence: ModelEvidence[];
};

export type ModelDependencyKind =
  | "imports"
  | "calls_api"
  | "uses_integration"
  | "reads_field";

export type ModelDependency = {
  id: string;
  from: string;
  to: string;
  kind: ModelDependencyKind;
  evidence: ModelEvidence[];
};

export type ProjectModel = {
  version: 1;
  basis: "static_source";
  pages: ModelNode[];
  journeys: ModelJourney[];
  services: ModelNode[];
  dependencies: ModelDependency[];
  entities: ModelNode[];
  integrations: ModelNode[];
  environments: ModelNode[];
  constraints: string[];
  assumptions: string[];
  missing_information: string[];
};

export type ModelProject = {
  id: string;
  name: string;
  purpose: string;
  target_users: string;
  current_version: number;
  auth_requirements: "supabase" | "none";
};

export type ModelSpec = {
  version: number;
  approved_at: string | null;
  spec: AppSpec;
};

export type ModelFile = { path: string; content: string };

export type ModelIntegration = {
  id: string;
  name: string;
  kind: string;
  status: string;
  allowed_operations: string[];
  last_test_status: string;
  updated_at: string;
};

export type ModelDeployment = {
  id: string;
  target: "preview" | "production";
  status: string;
  snapshot_version: number;
  source_commit: string | null;
  deployment_url: string | null;
  created_at: string;
};

export type ProjectModelInput = {
  project: ModelProject;
  spec: ModelSpec | null;
  files: ModelFile[];
  integrations: ModelIntegration[];
  deployments: ModelDeployment[];
};

function clip(value: string, max = 240): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function titleFromPath(path: string): string {
  const segment = path.split("/").filter(Boolean).pop() ?? "Page";
  if (segment === "page.tsx") return "Home";
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function lineEvidence(
  source: EvidenceSource,
  path: string,
  content: string,
  token: string | RegExp,
  detail: string,
): ModelEvidence | null {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const matched = typeof token === "string" ? line.includes(token) : token.test(line);
    if (matched) {
      return {
        source,
        path,
        line: index + 1,
        detail: clip(`${detail}: ${line.trim()}`, 220),
      };
    }
  }
  return null;
}

function dedupeEvidence(items: (ModelEvidence | null)[]): ModelEvidence[] {
  const seen = new Set<string>();
  const out: ModelEvidence[] = [];
  for (const item of items) {
    if (!item) continue;
    const key = `${item.source}|${item.path ?? ""}|${item.line ?? ""}|${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= MODEL_LIMITS.maxEvidencePerItem) break;
  }
  return out;
}

function safeLine(path: string, content: string, token: string, detail: string): ModelEvidence {
  return (
    lineEvidence("code", path, content, token, detail) ?? {
      source: "code",
      path,
      detail: clip(detail),
    }
  );
}

export function pagePathFromFile(path: string): string | null {
  if (!/^app\/(?:.+\/)?page\.tsx$/.test(path)) return null;
  const middle = path.slice(4, -"/page.tsx".length);
  return middle === "" ? "/" : `/${middle}`;
}

export function routePathFromFile(path: string): string | null {
  const match = /^app\/(api\/.+\/)route\.ts$/.exec(path);
  if (!match) return null;
  return `/${match[1].replace(/\/$/, "")}`;
}

function importTargets(content: string): string[] {
  const found = new Set<string>();
  const patterns = [/from\s+["']([^"']+)["']/g, /require\(\s*["']([^"']+)["']\s*\)/g];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] ?? specifier;
}

function localModulePath(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  const withoutAlias = specifier.slice(2);
  if (withoutAlias.startsWith("lib/")) return `${withoutAlias}.ts`;
  if (withoutAlias.startsWith("components/")) return `${withoutAlias}.tsx`;
  if (withoutAlias.startsWith("app/")) return `${withoutAlias}.tsx`;
  return null;
}

export function buildProjectModel(input: ProjectModelInput): ProjectModel {
  const nodes: ModelNode[] = [];
  const nodeById = new Map<string, ModelNode>();
  const journeys: ModelJourney[] = [];
  const dependencies: ModelDependency[] = [];
  const dependencyIds = new Set<string>();
  const fileNode = new Map<string, string>();
  const assumptions: string[] = [];
  const missing: string[] = [];

  function addNode(node: ModelNode): ModelNode {
    const existing = nodeById.get(node.id);
    if (existing) {
      existing.evidence = dedupeEvidence([...existing.evidence, ...node.evidence]);
      return existing;
    }
    const next: ModelNode = { ...node, evidence: dedupeEvidence(node.evidence) };
    nodes.push(next);
    nodeById.set(next.id, next);
    return next;
  }

  function addDependency(
    from: string,
    to: string,
    kind: ModelDependencyKind,
    evidence: ModelEvidence,
  ): void {
    if (from === to || dependencies.length >= MODEL_LIMITS.maxDependencies) return;
    const id = `${kind}:${from}->${to}`;
    if (dependencyIds.has(id)) return;
    dependencyIds.add(id);
    dependencies.push({ id, from, to, kind, evidence: [evidence] });
  }

  const spec = input.spec?.spec ?? null;
  const specEvidence: ModelEvidence[] = input.spec
    ? [
        {
          source: "spec",
          detail: `Specification version ${input.spec.version}${input.spec.approved_at ? " (approved)" : " (draft)"}.`,
        },
      ]
    : [{ source: "project", detail: "No stored specification was available." }];

  // Pages come from the specification first, then any generated page file that
  // the specification does not mention.
  const declaredPages = spec?.pages ?? [];
  for (const page of declaredPages) {
    const generatedPath = page.path === "/" ? "app/page.tsx" : `app${page.path}/page.tsx`;
    const file = input.files.find((candidate) => candidate.path === generatedPath);
    const pageNode = addNode({
      id: `page:${page.path}`,
      kind: "page",
      label: clip(page.title, 80),
      summary: clip(page.purpose, 240),
      evidence: dedupeEvidence([
        ...specEvidence,
        file ? safeLine(file.path, file.content, "export default", "Page implementation") : null,
      ]),
      metadata: { path: page.path, generated: Boolean(file) },
    });
    if (file) fileNode.set(file.path, pageNode.id);
  }

  for (const file of input.files) {
    const path = pagePathFromFile(file.path);
    if (!path) continue;
    if (nodes.some((node) => node.id === `page:${path}`)) {
      fileNode.set(file.path, `page:${path}`);
      continue;
    }
    const pageNode = addNode({
      id: `page:${path}`,
      kind: "page",
      label: titleFromPath(file.path),
      summary: `Page file ${file.path}. It is not listed in the stored specification.`,
      evidence: [safeLine(file.path, file.content, "export default", "Generated page")],
      metadata: { path, generated: true, undeclared: true },
    });
    fileNode.set(file.path, pageNode.id);
  }

  // Journeys are declared features. The specification does not define a page
  // sequence per feature, so no order is invented here.
  const features = (spec?.features ?? []).slice(0, MODEL_LIMITS.maxJourneys);
  for (let index = 0; index < features.length; index += 1) {
    const feature = features[index]!;
    journeys.push({
      id: `journey:${index + 1}`,
      title: clip(feature, 120),
      summary: "Declared workflow. Page order is not specified, so no sequence is inferred.",
      steps: [],
      evidence: specEvidence,
    });
  }
  if (journeys.length === 0) {
    assumptions.push("No workflows are declared, so no user journey sequence is modelled.");
  }

  // Routes and service files.
  for (const file of input.files) {
    const routePath = routePathFromFile(file.path);
    if (routePath) {
      const methods = [...file.content.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/g)]
        .map((match) => match[1])
        .filter((value): value is string => Boolean(value));
      const node = addNode({
        id: `route:${routePath}`,
        kind: "route",
        label: routePath,
        summary: `Route handler in ${file.path}.`,
        evidence: dedupeEvidence([
          safeLine(file.path, file.content, "export async function", "Route handler"),
          ...methods.map((method) =>
            lineEvidence("code", file.path, file.content, method, `Exported ${method} handler`),
          ),
        ]),
        metadata: {
          path: file.path,
          methods: methods.length > 0 ? methods.join(", ") : "not found",
          implemented: true,
        },
      });
      fileNode.set(file.path, node.id);
      continue;
    }

    if (/^(lib|components)\/.+\.(ts|tsx)$/.test(file.path)) {
      const node = addNode({
        id: `file:${file.path}`,
        kind: "service",
        label: file.path,
        summary: `Stored ${file.path.startsWith("lib/") ? "library" : "component"} source.`,
        evidence: [safeLine(file.path, file.content, "export", "Exported source")],
        metadata: { path: file.path },
      });
      fileNode.set(file.path, node.id);
    }
  }

  // Static imports, literal API calls and package dependencies.
  for (const file of input.files) {
    const from = fileNode.get(file.path);
    if (!from) continue;

    for (const specifier of importTargets(file.content)) {
      if (specifier.startsWith(".")) continue;
      if (specifier.startsWith("@/")) {
        const targetPath = localModulePath(specifier);
        if (!targetPath) continue;
        const target = fileNode.get(targetPath);
        if (!target) continue;
        addDependency(
          from,
          target,
          "imports",
          safeLine(file.path, file.content, specifier, `Imports ${specifier}`),
        );
        continue;
      }
      const packageNode = addNode({
        id: `package:${packageName(specifier)}`,
        kind: "package",
        label: packageName(specifier),
        summary: "External package imported by stored source.",
        evidence: [safeLine(file.path, file.content, specifier, `Imports package ${specifier}`)],
      });
      addDependency(
        from,
        packageNode.id,
        "imports",
        safeLine(file.path, file.content, specifier, `Imports ${specifier}`),
      );
    }

    for (const match of file.content.matchAll(/["'`](\/api\/[A-Za-z0-9_./-]*)["'`]/g)) {
      const endpoint = (match[1] ?? "").replace(/\/$/, "");
      if (!endpoint) continue;
      const routeNode =
        nodeById.get(`route:${endpoint}`) ??
        addNode({
          id: `route:${endpoint}`,
          kind: "route",
          label: endpoint,
          summary: "Referenced by source. No matching route handler was found in the stored files.",
          evidence: [safeLine(file.path, file.content, endpoint, "Literal API call")],
          metadata: { implemented: false, path: null },
        });
      addDependency(
        from,
        routeNode.id,
        "calls_api",
        safeLine(file.path, file.content, endpoint, `Calls ${endpoint}`),
      );
    }
  }

  // Data entities and field references.
  for (const entity of spec?.entities ?? []) {
    const fields = entity.fields.length > 0 ? entity.fields : [];
    const entityNode = addNode({
      id: `entity:${entity.name}`,
      kind: "entity",
      label: entity.name,
      summary: `${fields.length} declared field(s).`,
      evidence: specEvidence,
      metadata: { fields: fields.join(", "), field_count: fields.length },
    });
    for (const field of fields) {
      const fieldNode = addNode({
        id: `field:${entity.name}.${field}`,
        kind: "field",
        label: `${entity.name}.${field}`,
        summary: "Declared data field.",
        evidence: specEvidence,
        metadata: { entity: entity.name, field },
      });
      const token = new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      for (const file of input.files) {
        const from = fileNode.get(file.path);
        if (!from) continue;
        const evidence = lineEvidence("code", file.path, file.content, token, "Field token");
        if (evidence) addDependency(from, fieldNode.id, "reads_field", evidence);
      }
      if (!dependencies.some((edge) => edge.to === fieldNode.id)) {
        missing.push(`No stored source references ${entity.name}.${field}; readers are unknown.`);
      }
    }
    if (!dependencies.some((edge) => edge.to === entityNode.id)) {
      missing.push(`No stored source imports or references entity ${entity.name} directly.`);
    }
  }

  const integrationNames = new Map<string, ModelNode>();
  for (const declared of spec?.integrations ?? []) {
    integrationNames.set(declared.name.toLowerCase(), {
      id: `integration:${declared.name}`,
      kind: "integration",
      label: declared.name,
      summary: "Declared external integration. It may be mocked; no successful external call is proven.",
      evidence: specEvidence,
      metadata: { env_var: declared.env_var, mocked: declared.mocked, status: "declared" },
    });
  }
  for (const integration of input.integrations) {
    const existing = integrationNames.get(integration.name.toLowerCase());
    const node = addNode({
      id: existing?.id ?? `integration:${integration.name}`,
      kind: "integration",
      label: integration.name,
      summary: `${integration.kind} integration recorded as ${integration.status}.`,
      evidence: dedupeEvidence([
        ...(existing?.evidence ?? []),
        {
          source: "integration",
          detail: `Status ${integration.status}; last test ${integration.last_test_status}; ${integration.allowed_operations.length} allowed operation(s).`,
        },
      ]),
      metadata: {
        kind: integration.kind,
        status: integration.status,
        last_test_status: integration.last_test_status,
        allowed_operations: integration.allowed_operations.length,
        updated_at: integration.updated_at,
      },
    });
    integrationNames.set(integration.name.toLowerCase(), node);
  }
  for (const integration of integrationNames.values()) addNode(integration);

  for (const integration of integrationNames.values()) {
    const envVar = typeof integration.metadata?.env_var === "string" ? integration.metadata.env_var : "";
    for (const file of input.files) {
      const from = fileNode.get(file.path);
      if (!from) continue;
      const token = envVar || integration.label;
      const evidence = lineEvidence("code", file.path, file.content, token, "Integration reference");
      if (evidence) addDependency(from, integration.id, "uses_integration", evidence);
    }
  }

  // Environments are declared from deployment records, never inferred as live.
  const targets: ("preview" | "production")[] = ["preview", "production"];
  for (const target of targets) {
    const matching = input.deployments.filter((deployment) => deployment.target === target);
    const latest = matching[0] ?? null;
    addNode({
      id: `environment:${target}`,
      kind: "environment",
      label: target === "preview" ? "Preview environment" : "Production environment",
      summary: latest
        ? `Latest recorded deployment is ${latest.status} at snapshot version ${latest.snapshot_version}.`
        : "No deployment record exists. The environment is declared, not observed.",
      evidence: latest
        ? [
            {
              source: "deployment",
              detail: `Deployment ${latest.id.slice(0, 8)} is ${latest.status}; source commit ${latest.source_commit ?? "not recorded"}; URL ${latest.deployment_url ?? "not recorded"}.`,
            },
          ]
        : [{ source: "deployment", detail: "No deployment record for this environment." }],
      metadata: {
        status: latest?.status ?? "not_deployed",
        snapshot_version: latest?.snapshot_version ?? null,
        deployment_url: latest?.deployment_url ?? null,
      },
    });
  }

  const latestDeployment = input.deployments[0] ?? null;
  const constraints = [
    `Supported stack: ${spec?.stack ?? "not recorded"}.`,
    `Stored project limits: ${PROJECT_LIMITS.maxFiles} files, ${PROJECT_LIMITS.maxPages} pages and ${PROJECT_LIMITS.maxEntities} entities.`,
    input.project.auth_requirements === "supabase"
      ? "Supabase authentication is declared; authorization still needs a route-by-route check."
      : "No accounts are declared; write routes are not protected by an authenticated user.",
    "No measured CPU, memory, latency, request throughput or cost data is included in this model.",
  ];
  if (latestDeployment && latestDeployment.snapshot_version !== input.project.current_version) {
    constraints.push(
      `The latest ${latestDeployment.target} deployment is snapshot version ${latestDeployment.snapshot_version}, not the current version ${input.project.current_version}.`,
    );
  }

  assumptions.push(
    "Dependency edges come from static imports, literal `/api` strings and field-name tokens; unused or conditional imports may still appear.",
    "Deployment rows show recorded state, not proof that an environment is healthy or reachable.",
  );
  if (input.spec && !input.spec.approved_at) {
    assumptions.push(
      `The model uses draft specification version ${input.spec.version} because no approved version was available.`,
    );
    missing.push("No approved specification exists for this project.");
  }
  if (!input.spec) missing.push("No specification exists; pages and entities may be incomplete.");
  if (input.files.length === 0) missing.push("No generated project files exist; services and imports cannot be inspected.");
  if (input.deployments.length === 0) missing.push("No deployment record exists; environment status is unknown.");
  if (input.integrations.length === 0 && (spec?.integrations.length ?? 0) > 0) {
    missing.push("Declared integrations have no Integration Studio connection record.");
  }
  if (
    input.integrations.length > 0 &&
    input.integrations.some((integration) => integration.last_test_status !== "passed")
  ) {
    missing.push("One or more integration records have no passing test.");
  }
  if (!input.files.some((file) => /(^|\/)(test|tests|__tests__)\//.test(file.path) || /\.test\.[tj]sx?$/.test(file.path))) {
    missing.push("No stored automated test files were found.");
  }
  missing.push("No runtime request traces, error samples or production telemetry were supplied.");

  return {
    version: 1,
    basis: "static_source",
    pages: nodes.filter((node) => node.kind === "page"),
    journeys,
    services: nodes.filter((node) => node.kind === "route" || node.kind === "service"),
    dependencies,
    entities: nodes.filter((node) => node.kind === "entity" || node.kind === "field"),
    integrations: nodes.filter((node) => node.kind === "integration"),
    environments: nodes.filter((node) => node.kind === "environment"),
    constraints,
    assumptions,
    missing_information: [...new Set(missing)],
  };
}

// ---------------------------------------------------------------------------
// Scenario analysis
// ---------------------------------------------------------------------------

export const SCENARIO_KINDS = [
  "api_change",
  "new_user_role",
  "background_job",
  "database_field",
] as const;

export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const SCENARIO_KIND_LABELS: Record<ScenarioKind, string> = {
  api_change: "API change",
  new_user_role: "New user role",
  background_job: "Background job",
  database_field: "Database field",
};

export type ScenarioInput = {
  kind: ScenarioKind;
  question: string;
  target: string;
};

export type AffectedComponent = {
  id: string;
  label: string;
  kind: ModelNodeKind;
  path: string | null;
  relation: "direct" | "transitive";
  why: string;
  evidence: ModelEvidence[];
};

export type ScenarioExperimentSuggestion = {
  kind: ExperimentKind;
  label: string;
  description: string;
  supported: boolean;
};

export type ScenarioAnalysis = {
  version: 1;
  kind: ScenarioKind;
  question: string;
  target: string;
  basis: "static_model";
  summary: string;
  affected: AffectedComponent[];
  evidence: ModelEvidence[];
  assumptions: string[];
  unknowns: string[];
  proposed_tests: string[];
  implementation_order: string[];
  reversible_experiments: string[];
  experiments: ScenarioExperimentSuggestion[];
  measured_results: [];
  basis_note: string;
};

export function validateScenarioInput(input: ScenarioInput): string | null {
  if (!SCENARIO_KINDS.includes(input.kind)) return "Choose a supported scenario kind.";
  const question = input.question.trim();
  const target = input.target.trim();
  if (question.length < 5 || question.length > 1_000) return "Ask a question between 5 and 1000 characters.";
  if (target.length < 1 || target.length > 160) return "Name a target between 1 and 160 characters.";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.startsWith("//")) {
    return "Only an internal route, role, job or field name is allowed. External URLs are refused.";
  }
  if (input.kind === "api_change" && !target.startsWith("/api/")) {
    return "An API change target must be an internal path beginning with /api/.";
  }
  if (input.kind === "database_field" && !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(target)) {
    return "Use an entity.field target, for example project.status.";
  }
  return null;
}

function nodePath(node: ModelNode): string | null {
  return typeof node.metadata?.path === "string" ? node.metadata.path : null;
}

function reverseAffected(model: ProjectModel, starts: { id: string; why: string }[]): AffectedComponent[] {
  const nodes = new Map<string, ModelNode>();
  for (const node of [
    ...model.pages,
    ...model.services,
    ...model.entities,
    ...model.integrations,
    ...model.environments,
  ]) {
    nodes.set(node.id, node);
  }

  const incoming = new Map<string, ModelDependency[]>();
  for (const edge of model.dependencies) {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge);
    incoming.set(edge.to, list);
  }

  const found = new Map<string, AffectedComponent>();
  const queue = starts.map((start) => ({ ...start, depth: 0 }));

  while (queue.length > 0 && found.size < MODEL_LIMITS.maxAffected) {
    const current = queue.shift()!;
    if (found.has(current.id)) continue;
    const node = nodes.get(current.id);
    if (!node) continue;
    found.set(current.id, {
      id: node.id,
      label: node.label,
      kind: node.kind,
      path: nodePath(node),
      relation: current.depth === 0 ? "direct" : "transitive",
      why: current.why,
      evidence: dedupeEvidence(node.evidence),
    });
    if (current.depth >= 3) continue;
    for (const edge of incoming.get(current.id) ?? []) {
      if (found.has(edge.from)) continue;
      queue.push({
        id: edge.from,
        depth: current.depth + 1,
        why: `Reached through a ${edge.kind.replace("_", " ")} relationship.`,
      });
    }
  }

  return [...found.values()];
}

export function buildScenarioAnalysis(model: ProjectModel, input: ScenarioInput): ScenarioAnalysis {
  const target = input.target.trim();
  const normalized = target.replace(/\/$/, "");
  let starts: { id: string; why: string }[] = [];

  if (input.kind === "api_change") {
    const route = model.services.find(
      (node) => node.kind === "route" && (node.id === `route:${normalized}` || node.label === normalized),
    );
    if (route) {
      starts = [{ id: route.id, why: `The proposed API change targets ${normalized}.` }];
    }
  } else if (input.kind === "new_user_role") {
    const authRelated = model.services.filter((node) => {
      if (node.kind !== "route" && node.kind !== "page") return false;
      return node.evidence.some((item) =>
        /auth|session|role|permission|owner|user/i.test(item.detail),
      );
    });
    const candidates = authRelated.length > 0 ? authRelated : model.services;
    starts = candidates.slice(0, 12).map((node) => ({
      id: node.id,
      why: `A new role can change who reaches ${node.label}.`,
    }));
  } else if (input.kind === "background_job") {
    starts = model.services.slice(0, 12).map((node) => ({
      id: node.id,
      why: `A background job can read or write through ${node.label}.`,
    }));
  } else {
    const field = model.entities.find(
      (node) => node.kind === "field" && (node.label === target || node.id === `field:${target}`),
    );
    const entity = model.entities.find(
      (node) => node.kind === "entity" && node.label === target.split(".")[0],
    );
    if (field) starts.push({ id: field.id, why: `The requested database field is ${target}.` });
    if (entity && entity.id !== field?.id) {
      starts.push({ id: entity.id, why: `The field belongs to entity ${entity.label}.` });
    }
  }

  const affected = reverseAffected(model, starts);
  const evidence = dedupeEvidence(affected.flatMap((item) => item.evidence));
  const unknowns = [
    "Static imports and field-name matches do not prove a path is exercised at runtime.",
    "No production request traces, error samples, resource measurements or customer data were used.",
  ];
  const assumptions = model.assumptions.slice(0, 6);
  const latest = model.environments.find((node) => node.id === "environment:production");
  const deployedVersion = Number(latest?.metadata?.snapshot_version ?? 0);
  if (deployedVersion > 0) {
    unknowns.push(
      "The recorded deployment may not match the current source revision; verify the source commit before relying on this analysis.",
    );
  }
  if (starts.length === 0) {
    unknowns.push(`No matching ${SCENARIO_KIND_LABELS[input.kind].toLowerCase()} target was found in the stored model.`);
  }
  if (affected.length === 0) {
    unknowns.push("No affected component could be connected using static evidence.");
  }

  let proposedTests: string[] = [];
  let order: string[] = [];
  let reversible: string[] = [];
  let summary = "";
  if (input.kind === "api_change") {
    summary = `Trace the proposed change at ${normalized} through static callers, handlers, data fields and recorded environments.`;
    proposedTests = [
      `Contract test ${normalized} with a valid synthetic payload and assert the response shape.`,
      `Test an invalid payload against ${normalized} and assert a visible 4xx response.`,
      "Test an unauthenticated request and the wrong role where authentication is declared.",
      "Run the existing project checks before and after the change.",
    ];
    order = [
      "Add a backward-compatible route or response field first.",
      "Update static callers and server-side validation.",
      "Run contract and authorization tests.",
      "Remove the old behavior only after callers are migrated.",
    ];
    reversible = [
      "Add an optional response field or a second route and remove it if consumers fail.",
      "Keep the old handler until the new contract passes synthetic contract checks.",
    ];
  } else if (input.kind === "new_user_role") {
    summary = `Map the proposed role "${target}" to every route and page whose evidence mentions authentication, ownership or permissions.`;
    proposedTests = [
      "Test the new role against every write route and assert allowed and denied cases.",
      "Test an unrelated account cannot read or mutate another owner's rows.",
      "Test the role cannot perform maintainer or owner actions.",
      "Record the permission matrix as an acceptance check before implementation.",
    ];
    order = [
      "Write the role and permission matrix from current authorization rules.",
      "Enforce the role in server-side route checks, not only in the interface.",
      "Expose the role in the interface after server checks pass.",
      "Add permission and cross-account tests.",
    ];
    reversible = [
      "Add the role behind a disabled flag and remove the mapping if the permission matrix fails.",
      "Ship the server-side role check before exposing any new interface control.",
    ];
  } else if (input.kind === "background_job") {
    summary = `Identify services and data that a proposed "${target}" job could reach. This is a candidate dependency set, not proof of job behavior.`;
    proposedTests = [
      "Run the job twice with the same synthetic idempotency key and assert one effect.",
      "Inject a transient failure and assert bounded retry behavior.",
      "Test a duplicate, malformed and expired work item.",
      "Verify the job cannot call an external service without explicit authorization.",
    ];
    order = [
      "Define the job contract, idempotency key and failure policy.",
      "Add the job behind a disabled flag or manual trigger.",
      "Add bounded retries, logging and a stop condition.",
      "Run synthetic and failure-path tests before enabling it.",
    ];
    reversible = [
      "Run the job only by manual trigger with a synthetic work item, then disable it.",
      "Keep the scheduler off until duplicate and failure-path checks pass.",
    ];
  } else {
    summary = `Trace static readers of ${target} before changing or removing the field.`;
    proposedTests = [
      `Test reads and writes of ${target} before and after the schema change.`,
      "Test null, default and legacy-row behavior.",
      "Test every route that writes the entity with the new field shape.",
      "Run a reversible migration check against an isolated database.",
    ];
    order = [
      "Add the new field or nullable shape without removing the old one.",
      "Update writers, then readers, with both shapes supported.",
      "Backfill and verify in an isolated database.",
      "Remove the old shape only after readers no longer use it.",
    ];
    reversible = [
      "Add the field as nullable or additive and stop writing it if checks fail.",
      "Keep a compatibility read path until a separate removal change is reviewed.",
    ];
  }

  return {
    version: 1,
    kind: input.kind,
    question: input.question.trim(),
    target,
    basis: "static_model",
    summary,
    affected,
    evidence,
    assumptions,
    unknowns: [...new Set(unknowns)],
    proposed_tests: proposedTests,
    implementation_order: order,
    reversible_experiments: reversible,
    experiments: experimentSuggestions(),
    measured_results: [],
    basis_note: SCENARIO_BASIS_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Bounded experiments
// ---------------------------------------------------------------------------

export const EXPERIMENT_KINDS = [
  "contract_check",
  "synthetic_requests",
  "resource_observation",
  "failure_injection",
] as const;

export type ExperimentKind = (typeof EXPERIMENT_KINDS)[number];

export const EXPERIMENT_KIND_LABELS: Record<ExperimentKind, string> = {
  contract_check: "Contract check",
  synthetic_requests: "Synthetic requests",
  resource_observation: "Resource observation",
  failure_injection: "Failure injection",
};

export const EXPERIMENT_KIND_NOTES: Record<ExperimentKind, string> = {
  contract_check: "Inspects route methods, validation and authorization branches in stored source.",
  synthetic_requests: "Requires an isolated HTTP runner. Without one it is recorded as blocked and no request is sent.",
  resource_observation: "Measures only stored source size and line counts. It does not measure CPU, memory or latency.",
  failure_injection: "Inspects static failure branches. It does not disrupt a running service.",
};

function experimentSuggestions(): ScenarioExperimentSuggestion[] {
  const common: ExperimentKind[] = ["contract_check", "synthetic_requests", "resource_observation", "failure_injection"];
  return common.map((experiment) => ({
    kind: experiment,
    label: EXPERIMENT_KIND_LABELS[experiment],
    description:
      experiment === "synthetic_requests"
        ? `Request the internal target with synthetic input only; no external service or production user data.`
        : EXPERIMENT_KIND_NOTES[experiment],
    supported: experiment !== "synthetic_requests",
  }));
}

export type ExperimentPlan = {
  version: 1;
  kind: ExperimentKind;
  target: string;
  requested_requests: number;
  max_duration_ms: number;
  data_handling: "source_code_only";
  external_calls: false;
  checks: string[];
  task_title: string;
  task_description: string;
  scope_paths: string[];
  basis_note: string;
};

export type ExperimentInput = {
  kind: ExperimentKind;
  target: string;
  requested_requests: number;
  max_duration_ms: number;
};

export function validateExperimentInput(input: ExperimentInput): string | null {
  if (!EXPERIMENT_KINDS.includes(input.kind)) return "Choose a supported experiment kind.";
  if (!input.target.trim() || input.target.length > 160) return "Choose a target under 160 characters.";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input.target) || input.target.startsWith("//")) {
    return "External URLs are refused. Experiments only inspect this project.";
  }
  if (!Number.isInteger(input.requested_requests) || input.requested_requests < EXPERIMENT_LIMITS.minRequests || input.requested_requests > EXPERIMENT_LIMITS.maxRequests) {
    return `Requests must be between ${EXPERIMENT_LIMITS.minRequests} and ${EXPERIMENT_LIMITS.maxRequests}.`;
  }
  if (!Number.isInteger(input.max_duration_ms) || input.max_duration_ms < EXPERIMENT_LIMITS.minDurationMs || input.max_duration_ms > EXPERIMENT_LIMITS.maxDurationMs) {
    return `Duration must be between ${EXPERIMENT_LIMITS.minDurationMs} and ${EXPERIMENT_LIMITS.maxDurationMs} ms.`;
  }
  return null;
}

export function buildExperimentPlan(
  model: ProjectModel,
  analysis: ScenarioAnalysis,
  input: ExperimentInput,
): ExperimentPlan {
  const scopePaths = [
    ...new Set(
      analysis.affected
        .map((item) => item.path)
        .filter((value): value is string => Boolean(value)),
    ),
  ].slice(0, MODEL_LIMITS.maxScopePaths);
  const kindLabel = EXPERIMENT_KIND_LABELS[input.kind];
  const taskTitle = clip(`Experiment: ${kindLabel} for ${analysis.target}`, 200);
  const affected = analysis.affected.slice(0, 8).map((item) => item.label).join(", ") || "no connected component";
  const description = clip(
    `Approved experiment from the static project model. Target: ${analysis.target}. Affected evidence: ${affected}. ` +
      `Checks: ${analysis.proposed_tests.join(" ")} Unknowns: ${analysis.unknowns.join(" ")} ` +
      "No performance or cost forecast is made.",
    2_000,
  );

  const checks: Record<ExperimentKind, string[]> = {
    contract_check: [
      "Find the stored route handler for the target.",
      "List exported HTTP methods.",
      "Look for request validation.",
      "Look for authentication and owner scoping where the project declares accounts.",
    ],
    synthetic_requests: [
      "Require an isolated runner before sending any request.",
      "Use synthetic input only.",
      "Never target an external host.",
    ],
    resource_observation: [
      "Count stored source files and characters.",
      "Count source lines.",
      "Do not claim CPU, memory, latency or cost measurements.",
    ],
    failure_injection: [
      "Inspect static error, validation and status-code branches.",
      "Do not disrupt a running service.",
      "Record the absence of runtime failure evidence.",
    ],
  };

  return {
    version: 1,
    kind: input.kind,
    target: input.target.trim(),
    requested_requests: input.requested_requests,
    max_duration_ms: input.max_duration_ms,
    data_handling: "source_code_only",
    external_calls: false,
    checks: checks[input.kind],
    task_title: taskTitle,
    task_description: description,
    scope_paths: scopePaths,
    basis_note: MODEL_BASIS_NOTE,
  };
}

export type ExperimentObservation = {
  name: string;
  status: "passed" | "failed" | "warning" | "info" | "blocked";
  detail: string;
  path?: string;
  line?: number;
};

export type ExperimentOutcome = {
  status: "passed" | "failed" | "blocked";
  observations: ExperimentObservation[];
  note: string;
};

function findRoute(files: ModelFile[], target: string): ModelFile | null {
  const normalized = target.replace(/\/$/, "");
  return files.find((file) => routePathFromFile(file.path) === normalized) ?? null;
}

export function executeExperiment(
  plan: ExperimentPlan,
  files: ModelFile[],
  context: { authRequired: boolean },
): ExperimentOutcome {
  const route = findRoute(files, plan.target);

  if (plan.kind === "synthetic_requests") {
    return {
      status: "blocked",
      observations: [
        {
          name: "isolated runner",
          status: "blocked",
          detail: "No isolated HTTP runner is configured. No request was sent and no external service was contacted.",
        },
      ],
      note: "Blocked before execution. Synthetic requests require an isolated runner; Phase 33 does not send one.",
    };
  }

  if (plan.kind === "resource_observation") {
    const chars = files.reduce((total, file) => total + file.content.length, 0);
    const lines = files.reduce((total, file) => total + file.content.split(/\r?\n/).length, 0);
    return {
      status: "passed",
      observations: [
        { name: "stored files", status: "info", detail: `${files.length} stored file(s).` },
        { name: "source characters", status: "info", detail: `${chars} character(s), not a runtime memory measurement.` },
        { name: "source lines", status: "info", detail: `${lines} line(s), not a throughput or latency measurement.` },
      ],
      note: "Measured stored source size only. No CPU, memory, latency or cost was measured.",
    };
  }

  if (!route) {
    return {
      status: "failed",
      observations: [
        {
          name: "route",
          status: "failed",
          detail: `No stored route handler matches ${plan.target}. No runtime request was made.`,
        },
      ],
      note: "Static evidence was insufficient. No service was contacted.",
    };
  }

  const methods = [...route.content.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  const validation = /z\.object|safeParse|\.parse\(/i.test(route.content);
  const auth = /getUser|auth\.uid|requireSession|currentUser/i.test(route.content);
  const owner = /user_id/.test(route.content);
  const failureBranch = /status:\s*(400|401|403|404|409|422|500)|catch\s*\(/i.test(route.content);
  const evidenceLine = (token: string) => {
    const evidence = lineEvidence("code", route.path, route.content, token, "Static evidence");
    return evidence?.line;
  };

  const observations: ExperimentObservation[] = [
    {
      name: "route handler",
      status: "passed",
      detail: `Found ${route.path}.`,
      path: route.path,
    },
    {
      name: "methods",
      status: methods.length > 0 ? "passed" : "failed",
      detail: methods.length > 0 ? methods.join(", ") : "No exported HTTP method was found.",
      path: route.path,
      line: evidenceLine("export async function"),
    },
  ];

  if (plan.kind === "contract_check") {
    observations.push(
      {
        name: "validation",
        status: validation ? "passed" : "warning",
        detail: validation ? "A validation branch is present." : "No validation branch was found.",
        path: route.path,
      },
      {
        name: "auth",
        status: context.authRequired ? (auth ? "passed" : "failed") : "info",
        detail: context.authRequired
          ? auth
            ? "An authentication check is present."
            : "Accounts are declared but no authentication check was found."
          : "This project declares no accounts.",
        path: route.path,
      },
      {
        name: "owner scoping",
        status: context.authRequired ? (owner ? "passed" : "warning") : "info",
        detail: owner ? "A user_id reference is present." : "No user_id reference was found.",
        path: route.path,
      },
    );
    const failed = observations.some((item) => item.status === "failed");
    return {
      status: failed ? "failed" : "passed",
      observations,
      note: "Static contract inspection only. No request was sent and runtime behavior is not proven.",
    };
  }

  observations.push({
    name: "failure branches",
    status: failureBranch ? "passed" : "warning",
    detail: failureBranch
      ? "A visible error status or catch branch is present."
      : "No explicit error status or catch branch was found.",
    path: route.path,
    line: evidenceLine("catch"),
  });
  return {
    status: failureBranch ? "passed" : "failed",
    observations,
    note: "Static failure-path inspection only. No running service was failed or disrupted.",
  };
}

// ---------------------------------------------------------------------------
// Model version diff
// ---------------------------------------------------------------------------

export type ModelDiffStatus = "added" | "removed" | "changed";

export type ModelFieldChange = {
  field: string;
  before: string;
  after: string;
};

export type ModelNodeDiff = {
  key: string;
  kind: ModelNodeKind | "journey";
  label: string;
  status: ModelDiffStatus;
  changes: ModelFieldChange[];
  before_evidence: ModelEvidence[];
  after_evidence: ModelEvidence[];
};

export type ModelDependencyDiff = {
  key: string;
  label: string;
  status: ModelDiffStatus;
  changes: ModelFieldChange[];
  before_evidence: ModelEvidence[];
  after_evidence: ModelEvidence[];
};

export type ModelStringDiff = {
  key: string;
  value: string;
  status: "added" | "removed";
};

export type ProjectModelDiff = {
  from_version: number;
  to_version: number;
  pages: ModelNodeDiff[];
  journeys: ModelNodeDiff[];
  services: ModelNodeDiff[];
  dependencies: ModelDependencyDiff[];
  entities: ModelNodeDiff[];
  integrations: ModelNodeDiff[];
  environments: ModelNodeDiff[];
  constraints: ModelStringDiff[];
  assumptions: ModelStringDiff[];
  missing_information: ModelStringDiff[];
  counts: {
    added: number;
    removed: number;
    changed: number;
    total: number;
  };
};

function evidenceValue(items: ModelEvidence[]): string {
  return items
    .map((item) => `${item.source}|${item.path ?? ""}|${item.line ?? ""}|${item.detail}`)
    .sort()
    .join("\n");
}

type DiffableNode = {
  id: string;
  kind: ModelNodeKind;
  label: string;
  summary: string;
  evidence: ModelEvidence[];
  metadata?: Record<string, string | number | boolean | null>;
};

function metadataValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function nodeChanges(
  before: DiffableNode | undefined,
  after: DiffableNode | undefined,
): ModelFieldChange[] {
  if (!before || !after) return [];
  const changes: ModelFieldChange[] = [];
  const add = (field: string, previous: string, next: string) => {
    if (previous !== next) changes.push({ field, before: previous, after: next });
  };

  add("label", before.label, after.label);
  add("summary", before.summary, after.summary);
  const metadataKeys = new Set([
    ...Object.keys(before.metadata ?? {}),
    ...Object.keys(after.metadata ?? {}),
  ]);
  for (const key of [...metadataKeys].sort()) {
    add(
      `metadata.${key}`,
      metadataValue(before.metadata?.[key]),
      metadataValue(after.metadata?.[key]),
    );
  }
  add("evidence", evidenceValue(before.evidence), evidenceValue(after.evidence));
  return changes;
}

function diffNodes(
  before: DiffableNode[],
  after: DiffableNode[],
): ModelNodeDiff[] {
  const beforeById = new Map(before.map((node) => [node.id, node]));
  const afterById = new Map(after.map((node) => [node.id, node]));
  const keys = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
  const changes: ModelNodeDiff[] = [];

  for (const key of keys) {
    const previous = beforeById.get(key);
    const next = afterById.get(key);
    if (!previous && next) {
      changes.push({
        key,
        kind: next.kind,
        label: next.label,
        status: "added",
        changes: [],
        before_evidence: [],
        after_evidence: next.evidence,
      });
    } else if (previous && !next) {
      changes.push({
        key,
        kind: previous.kind,
        label: previous.label,
        status: "removed",
        changes: [],
        before_evidence: previous.evidence,
        after_evidence: [],
      });
    } else if (previous && next) {
      const fields = nodeChanges(previous, next);
      if (fields.length > 0) {
        changes.push({
          key,
          kind: next.kind,
          label: next.label,
          status: "changed",
          changes: fields,
          before_evidence: previous.evidence,
          after_evidence: next.evidence,
        });
      }
    }
  }
  return changes;
}

function diffJourneys(before: ModelJourney[], after: ModelJourney[]): ModelNodeDiff[] {
  const beforeById = new Map(before.map((journey) => [journey.id, journey]));
  const afterById = new Map(after.map((journey) => [journey.id, journey]));
  const keys = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
  const changes: ModelNodeDiff[] = [];

  for (const key of keys) {
    const previous = beforeById.get(key);
    const next = afterById.get(key);
    if (!previous && next) {
      changes.push({
        key,
        kind: "journey",
        label: next.title,
        status: "added",
        changes: [],
        before_evidence: [],
        after_evidence: next.evidence,
      });
      continue;
    }
    if (previous && !next) {
      changes.push({
        key,
        kind: "journey",
        label: previous.title,
        status: "removed",
        changes: [],
        before_evidence: previous.evidence,
        after_evidence: [],
      });
      continue;
    }
    if (!previous || !next) continue;
    const fields: ModelFieldChange[] = [];
    if (previous.title !== next.title) {
      fields.push({ field: "title", before: previous.title, after: next.title });
    }
    if (previous.summary !== next.summary) {
      fields.push({ field: "summary", before: previous.summary, after: next.summary });
    }
    if (previous.steps.join("\n") !== next.steps.join("\n")) {
      fields.push({ field: "steps", before: previous.steps.join("\n"), after: next.steps.join("\n") });
    }
    if (evidenceValue(previous.evidence) !== evidenceValue(next.evidence)) {
      fields.push({ field: "evidence", before: evidenceValue(previous.evidence), after: evidenceValue(next.evidence) });
    }
    if (fields.length > 0) {
      changes.push({
        key,
        kind: "journey",
        label: next.title,
        status: "changed",
        changes: fields,
        before_evidence: previous.evidence,
        after_evidence: next.evidence,
      });
    }
  }
  return changes;
}

function diffDependencies(
  before: ModelDependency[],
  after: ModelDependency[],
): ModelDependencyDiff[] {
  const beforeById = new Map(before.map((edge) => [edge.id, edge]));
  const afterById = new Map(after.map((edge) => [edge.id, edge]));
  const keys = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
  const changes: ModelDependencyDiff[] = [];

  for (const key of keys) {
    const previous = beforeById.get(key);
    const next = afterById.get(key);
    if (!previous && next) {
      changes.push({
        key,
        label: `${next.from} → ${next.to} (${next.kind})`,
        status: "added",
        changes: [],
        before_evidence: [],
        after_evidence: next.evidence,
      });
    } else if (previous && !next) {
      changes.push({
        key,
        label: `${previous.from} → ${previous.to} (${previous.kind})`,
        status: "removed",
        changes: [],
        before_evidence: previous.evidence,
        after_evidence: [],
      });
    } else if (previous && next) {
      const fields: ModelFieldChange[] = [];
      if (previous.from !== next.from) fields.push({ field: "from", before: previous.from, after: next.from });
      if (previous.to !== next.to) fields.push({ field: "to", before: previous.to, after: next.to });
      if (previous.kind !== next.kind) fields.push({ field: "kind", before: previous.kind, after: next.kind });
      if (evidenceValue(previous.evidence) !== evidenceValue(next.evidence)) {
        fields.push({ field: "evidence", before: evidenceValue(previous.evidence), after: evidenceValue(next.evidence) });
      }
      if (fields.length > 0) {
        changes.push({
          key,
          label: `${next.from} → ${next.to} (${next.kind})`,
          status: "changed",
          changes: fields,
          before_evidence: previous.evidence,
          after_evidence: next.evidence,
        });
      }
    }
  }
  return changes;
}

function diffStrings(before: string[], after: string[]): ModelStringDiff[] {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const changes: ModelStringDiff[] = [];
  for (const value of [...beforeSet].sort()) {
    if (!afterSet.has(value)) changes.push({ key: `removed:${value}`, value, status: "removed" });
  }
  for (const value of [...afterSet].sort()) {
    if (!beforeSet.has(value)) changes.push({ key: `added:${value}`, value, status: "added" });
  }
  return changes;
}

/**
 * Compares two immutable model snapshots. Only changed records are returned.
 * A changed field carries the exact before and after values, including source
 * evidence, so the page never has to guess why a version differs.
 */
export function diffProjectModels(from: ProjectModel, to: ProjectModel): ProjectModelDiff {
  const pages = diffNodes(from.pages, to.pages);
  const journeys = diffJourneys(from.journeys, to.journeys);
  const services = diffNodes(from.services, to.services);
  const dependencies = diffDependencies(from.dependencies, to.dependencies);
  const entities = diffNodes(from.entities, to.entities);
  const integrations = diffNodes(from.integrations, to.integrations);
  const environments = diffNodes(from.environments, to.environments);
  const constraints = diffStrings(from.constraints, to.constraints);
  const assumptions = diffStrings(from.assumptions, to.assumptions);
  const missingInformation = diffStrings(from.missing_information, to.missing_information);

  const nodeDiffs = [pages, journeys, services, dependencies, entities, integrations, environments];
  const stringDiffs = [constraints, assumptions, missingInformation];
  const counts = {
    added: 0,
    removed: 0,
    changed: 0,
    total: 0,
  };
  for (const diff of nodeDiffs.flat()) {
    counts[diff.status] += 1;
    counts.total += 1;
  }
  for (const diff of stringDiffs.flat()) {
    counts[diff.status] += 1;
    counts.total += 1;
  }

  return {
    from_version: from.version,
    to_version: to.version,
    pages,
    journeys,
    services,
    dependencies,
    entities,
    integrations,
    environments,
    constraints,
    assumptions,
    missing_information: missingInformation,
    counts,
  };
}

export type ModelChangelogVersion = {
  version: number;
  spec_version: number;
  app_version: number;
  source_digest: string;
  created_at: string;
};

export type ModelChangelogInput = {
  project_name: string;
  from: ModelChangelogVersion;
  to: ModelChangelogVersion;
  diff: ProjectModelDiff;
};

function markdownText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\`*_{}\[\]<>#|])/g, "\\$1");
}

function inlineCode(value: string): string {
  const text = value.replace(/\s+/g, " ").trim() || "—";
  const longest = (text.match(/`+/g) ?? []).reduce((max, match) => Math.max(max, match.length), 0);
  const fence = "`".repeat(longest + 1);
  return `${fence}${text}${fence}`;
}

function fencedCode(value: string): string {
  const text = value || "—";
  const longest = (text.match(/`+/g) ?? []).reduce((max, match) => Math.max(max, match.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function evidenceBlock(title: string, items: ModelEvidence[]): string[] {
  if (items.length === 0) return [];
  const lines = [`#### ${title}`, ""];
  for (const item of items) {
    const location = item.path
      ? ` — ${inlineCode(`${item.path}${item.line ? `:${item.line}` : ""}`)}`
      : "";
    lines.push(`- ${markdownText(item.source)}${location}: ${markdownText(item.detail)}`, "");
  }
  return lines;
}

function changelogNodeSection(
  title: string,
  items: Array<ModelNodeDiff | ModelDependencyDiff>,
  versions: { from: number; to: number },
): string[] {
  const lines = [`## ${title}`, "", `**${items.length} change(s).**`, ""];
  if (items.length === 0) return [...lines, "_No changes._", ""];

  for (const item of items) {
    lines.push(`### ${item.status[0]!.toUpperCase()}${item.status.slice(1)}: ${markdownText(item.label)}`, "");
    lines.push(`- Key: ${inlineCode(item.key)}`);
    if ("kind" in item) lines.push(`- Kind: ${inlineCode(item.kind)}`);
    lines.push("");

    if (item.changes.length === 0) {
      lines.push(
        item.status === "added"
          ? `_Added in version ${versions.to}._`
          : `_Removed in version ${versions.from}._`,
        "",
      );
    } else {
      for (const change of item.changes) {
        lines.push(
          `#### ${markdownText(change.field)}`,
          "",
          "Before:",
          "",
          fencedCode(change.before),
          "",
          "After:",
          "",
          fencedCode(change.after),
          "",
        );
      }
    }

    lines.push(...evidenceBlock(`Before evidence (version ${versions.from})`, item.before_evidence));
    lines.push(...evidenceBlock(`After evidence (version ${versions.to})`, item.after_evidence));
  }
  return lines;
}

function changelogStringSection(title: string, items: ModelStringDiff[]): string[] {
  const lines = [`## ${title}`, "", `**${items.length} change(s).**`, ""];
  if (items.length === 0) return [...lines, "_No changes._", ""];
  for (const item of items) {
    lines.push(
      `### ${item.status[0]!.toUpperCase()}${item.status.slice(1)}`,
      "",
      fencedCode(item.value),
      "",
    );
  }
  return lines;
}

/**
 * Renders a selected model comparison as a self-contained Markdown changelog.
 * Values are fenced rather than flattened so the export preserves the exact
 * before/after source text and cannot break the surrounding document.
 */
export function formatProjectModelChangelog(input: ModelChangelogInput): string {
  const { project_name, from, to, diff } = input;
  const lines: string[] = [
    `# Project model changelog: ${markdownText(project_name)}`,
    "",
    `Comparing **model version ${from.version}** (specification ${from.spec_version || "none"}, project ${from.app_version}) with **model version ${to.version}** (specification ${to.spec_version || "none"}, project ${to.app_version}).`,
    "",
    `- From source revision: ${inlineCode(from.source_digest)}`,
    `- To source revision: ${inlineCode(to.source_digest)}`,
    `- From snapshot created: ${inlineCode(from.created_at)}`,
    `- To snapshot created: ${inlineCode(to.created_at)}`,
    "",
    "> Generated from the stored project-model snapshots. This is a static source comparison, not runtime proof. No performance or cost forecast is made.",
    "",
    "## Summary",
    "",
    "| Change | Count |",
    "| --- | ---: |",
    `| Added | ${diff.counts.added} |`,
    `| Removed | ${diff.counts.removed} |`,
    `| Changed | ${diff.counts.changed} |`,
    `| **Total** | **${diff.counts.total}** |`,
    "",
  ];

  lines.push(...changelogNodeSection("Pages", diff.pages, { from: from.version, to: to.version }));
  lines.push(...changelogNodeSection("Dependencies", diff.dependencies, { from: from.version, to: to.version }));
  lines.push(...changelogNodeSection("Integrations", diff.integrations, { from: from.version, to: to.version }));
  lines.push(
    ...changelogNodeSection("Deployment environments", diff.environments, {
      from: from.version,
      to: to.version,
    }),
  );
  lines.push(...changelogStringSection("Assumptions", diff.assumptions));
  lines.push(...changelogNodeSection("User journeys", diff.journeys, { from: from.version, to: to.version }));
  lines.push(...changelogNodeSection("Services and routes", diff.services, { from: from.version, to: to.version }));
  lines.push(...changelogNodeSection("Data entities", diff.entities, { from: from.version, to: to.version }));
  lines.push(...changelogStringSection("Constraints", diff.constraints));
  lines.push(...changelogStringSection("Missing information", diff.missing_information));

  return `${lines.join("\n").trimEnd()}\n`;
}
