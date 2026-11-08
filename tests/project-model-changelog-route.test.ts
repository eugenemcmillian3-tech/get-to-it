import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSession, type Session } from "@/lib/auth";
import {
  getProjectModelWorkspace,
  type ProjectModelRecord,
  type ProjectModelWorkspace,
} from "@/lib/data/project-model";
import type { ProjectModel } from "@/lib/project-model";
import type { AppProject } from "@/lib/types";
import { GET } from "@/app/build/[projectId]/model/changelog/route";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/data/project-model", () => ({ getProjectModelWorkspace: vi.fn() }));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function modelWithPage(label: string): ProjectModel {
  return {
    version: 1,
    basis: "static_source",
    pages: [
      {
        id: "page:/",
        kind: "page",
        label,
        summary: "Home page.",
        evidence: [{ source: "code", path: "app/page.tsx", line: 1, detail: "Page source" }],
        metadata: { path: "/", generated: true },
      },
    ],
    journeys: [],
    services: [],
    dependencies: [],
    entities: [],
    integrations: [],
    environments: [
      {
        id: "environment:production",
        kind: "environment",
        label: "production",
        summary: "Recorded deployment.",
        evidence: [{ source: "deployment", detail: "Deployment record" }],
        metadata: { status: "succeeded" },
      },
    ],
    constraints: ["Static source comparison only."],
    assumptions: [],
    missing_information: [],
  };
}

function modelRecord(version: number, pageLabel: string): ProjectModelRecord {
  const sourceDigest = (version === 1 ? "a" : "b").repeat(64);
  const model = modelWithPage(pageLabel);
  return {
    id: `model-${version}`,
    project_id: PROJECT_ID,
    user_id: "user-1",
    version,
    status: version === 2 ? "current" : "superseded",
    spec_version: version,
    app_version: version,
    source_digest: sourceDigest,
    source_revision: {
      spec_version: version,
      app_version: version,
      file_count: 1,
      integration_count: 0,
      deployment_count: 1,
      source_digest: sourceDigest,
      deployment_ids: ["deployment-1"],
      integration_ids: [],
    },
    model,
    assumptions: model.assumptions,
    missing_information: model.missing_information,
    created_at: `2026-11-0${version}T00:00:00.000Z`,
  };
}

const project: AppProject = {
  id: PROJECT_ID,
  user_id: "user-1",
  name: "Projects",
  purpose: "Keep small projects organised.",
  target_users: "Small teams",
  workflows: "Create and review projects.",
  required_pages: "/",
  entities: "project",
  auth_requirements: "supabase",
  integrations: "",
  design_preferences: "Plain.",
  definition_of_done: "A project can be reviewed.",
  stack: "nextjs-typescript-tailwind",
  status: "generated",
  current_version: 2,
  last_generation_status: "succeeded",
  last_generation_note: null,
  last_generated_at: "2026-11-02T00:00:00.000Z",
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-02T00:00:00.000Z",
};

const workspace: ProjectModelWorkspace = {
  project,
  specs: [],
  files: [],
  integrations: [],
  deployments: [],
  models: [modelRecord(2, "Start"), modelRecord(1, "Home")],
  scenarios: [],
  experiments: [],
  tasks: [],
};

// The project row carries the workspace link even though the UI-level
// AppProject type omits it; keeping it here lets the test model the unlink.
type LinkedProject = AppProject & { workspace_id: string | null };

function ownerWorkspace(workspaceLink: string | null): ProjectModelWorkspace {
  const linkedProject: LinkedProject = { ...project, workspace_id: workspaceLink };
  return { ...workspace, project: linkedProject };
}

function callChangelog(search = "", projectId = PROJECT_ID) {
  return GET(
    new Request(
      `http://localhost/build/${projectId}/model/changelog${search}`,
    ),
    { params: Promise.resolve({ projectId }) },
  );
}

function authenticate() {
  const session = {} as Session;
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(getProjectModelWorkspace).mockResolvedValue(workspace);
  return session;
}

describe("project-model changelog route", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    vi.mocked(getProjectModelWorkspace).mockReset();
  });

  it("returns 401 without reading the workspace when signed out", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await GET(
      new Request(
        `http://localhost/build/${PROJECT_ID}/model/changelog?from=1&to=2`,
      ),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Sign in to download this changelog.");
    expect(getProjectModelWorkspace).not.toHaveBeenCalled();
  });

  it("returns 404 for an invalid project ID before authentication", async () => {
    const response = await callChangelog("?from=1&to=2", "not-a-uuid");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(getSession).not.toHaveBeenCalled();
    expect(getProjectModelWorkspace).not.toHaveBeenCalled();
  });

  it("returns 404 when the project workspace is missing", async () => {
    const session = {} as Session;
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(getProjectModelWorkspace).mockResolvedValue(null);

    const response = await callChangelog("?from=1&to=2");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(getProjectModelWorkspace).toHaveBeenCalledWith(session, PROJECT_ID);
  });

  it("rejects missing or malformed version parameters", async () => {
    authenticate();

    for (const search of ["", "?from=1", "?to=2", "?from=abc&to=2"]) {
      const response = await callChangelog(search);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Choose two model versions.");
    }
  });

  it("rejects selecting the same version twice", async () => {
    authenticate();

    const response = await callChangelog("?from=1&to=1");

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Choose two different model versions.");
  });

  it("returns 404 when either selected version is unknown", async () => {
    authenticate();

    for (const search of ["?from=1&to=99", "?from=99&to=2", "?from=99&to=100"]) {
      const response = await callChangelog(search);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("That model version was not found.");
    }
  });

  it("returns a Markdown attachment with normalized version ordering and content", async () => {
    const session = authenticate();

    const response = await callChangelog("?from=2&to=1");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="project-model-v1-to-v2.md"',
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const markdown = await response.text();
    expect(markdown).toContain("# Project model changelog: Projects");
    expect(markdown).toContain("Comparing **model version 1**");
    expect(markdown).toContain("**model version 2**");
    expect(markdown).toContain("## Pages");
    expect(markdown).toContain("### Changed: Start");
    expect(markdown).toContain("Home");
    expect(markdown).toContain("## Deployment environments");
    expect(markdown).toContain("_No changes._");
    expect(getProjectModelWorkspace).toHaveBeenCalledWith(session, PROJECT_ID);
  });

  it("still downloads the same changelog for the owner after the project workspace link is removed", async () => {
    const session = {} as Session;
    vi.mocked(getSession).mockResolvedValue(session);

    vi.mocked(getProjectModelWorkspace).mockResolvedValue(ownerWorkspace("workspace-1"));
    const linked = await callChangelog("?from=1&to=2");
    expect(linked.status).toBe(200);
    const linkedMarkdown = await linked.text();

    // Only the workspace link is cleared; the owner session and the project
    // row stay. The download must not depend on workspace membership.
    vi.mocked(getProjectModelWorkspace).mockResolvedValue(ownerWorkspace(null));
    const unlinked = await callChangelog("?from=1&to=2");

    expect(unlinked.status).toBe(200);
    expect(unlinked.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(unlinked.headers.get("Content-Disposition")).toBe(
      'attachment; filename="project-model-v1-to-v2.md"',
    );
    expect(unlinked.headers.get("Cache-Control")).toBe("private, no-store");
    const unlinkedMarkdown = await unlinked.text();
    expect(unlinkedMarkdown).toBe(linkedMarkdown);
    expect(unlinkedMarkdown).toContain("# Project model changelog: Projects");
    expect(unlinkedMarkdown).toContain("### Changed: Start");
    expect(getProjectModelWorkspace).toHaveBeenLastCalledWith(session, PROJECT_ID);
  });
});
