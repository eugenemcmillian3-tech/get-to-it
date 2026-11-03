import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// The runner is intentionally plain JavaScript so it can run outside Next.js.
import { startRunner } from "../scripts/preview-runner.mjs";
import { buildProjectFiles, buildSpecDraft, type AppIntakeInput } from "@/lib/app-builder";
import {
  applyRepairPatch,
  createRunnerWorkspace,
  previewToken,
  runRunnerChecks,
  startRunnerPreview,
  stopRunnerWorkspace,
  updateRunnerWorkspace,
  type PreviewConfig,
} from "@/lib/preview-workspace";

const enabled = process.env.PREVIEW_RUNNER_TEST === "1";

function previewRequest(path: string, host: string, cookie?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: 4610,
        path,
        headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on("error", reject);
    request.end();
  });
}

const intake: AppIntakeInput = {
  name: "Repair fixture",
  purpose: "Show that a deliberately broken generated app can be repaired with evidence.",
  target_users: "One tester",
  workflows: "Open the home page\nRead the fixture title\nSave a note",
  required_pages: "/ | Home | The first screen\n/notes | Notes | Read and write notes",
  entities: "note: title, body",
  auth_requirements: "none",
  integrations: "",
  design_preferences: "Plain",
  definition_of_done: "The home page renders and the checks pass.",
};

describe.skipIf(!enabled)("isolated preview runner", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "get-to-it-preview-"));
  let runner: Awaited<ReturnType<typeof startRunner>>;
  let config: PreviewConfig;
  let key = "";
  const projectId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";

  afterAll(async () => {
    if (runner) await runner.close();
    fs.rmSync(root, { recursive: true, force: true });
  }, 60_000);

  it("starts without Docker and keeps project code in its own filesystem", async () => {
    runner = await startRunner({
      controlPort: 4611,
      publicPort: 4610,
      controlHost: "127.0.0.1",
      publicHost: "127.0.0.1",
      root,
      deps: path.resolve("node_modules"),
      token: "control-".repeat(6),
      signingSecret: "signing-".repeat(6),
      hostSuffix: "preview.localhost",
    });
    config = {
      runnerUrl: "http://127.0.0.1:4611",
      runnerToken: "control-".repeat(6),
      signingSecret: "signing-".repeat(6),
      publicOrigin: "http://preview.localhost:4610",
    };
  });

  it("runs the generated app, shows a deliberate failure, and repairs it", async () => {
    const files = buildProjectFiles(buildSpecDraft(intake), { name: intake.name, purpose: intake.purpose });
    const originalPage = files.find((file) => file.path === "app/page.tsx")!;
    const broken = files.map((file) =>
      file.path === "app/page.tsx"
        ? { ...file, content: `${file.content}\nconst deliberateFailure: number = "not a number";\n` }
        : file,
    );

    const created = await createRunnerWorkspace(config, { projectId, userId, files: broken });
    key = created.key;

    const first = await runRunnerChecks(config, key);
    expect(first.status).toBe("failed");
    expect(first.log).toContain("TS2322");
    expect(first.checks.find((check) => check.name === "typecheck")?.status).toBe("failed");

    const repaired = applyRepairPatch(broken, {
      summary: "Remove the deliberately introduced type error",
      files: [{ path: "app/page.tsx", content: originalPage.content }],
    });
    await updateRunnerWorkspace(config, key, { projectId, files: repaired.files });
    const second = await runRunnerChecks(config, key);
    expect(second.status).toBe("passed");
    expect(second.checks.find((check) => check.name === "build")?.status).toBe("passed");
  }, 240_000);

  it("forbids host files, platform credentials and network egress", async () => {
    const response = await fetch(`http://127.0.0.1:4611/v1/workspaces/${key}/probe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.runnerToken}` },
    }).then((result) => result.json());
    expect(response.ok).toBe(true);
    expect(response.probe).toMatchObject({
      cwd: "/workspace",
      hostPasswd: false,
      hostRoot: false,
      workspace: true,
      nodeModules: true,
      platformKey: false,
      network: false,
    });
  });

  it("requires a signed token on a separate preview origin", async () => {
    const preview = await startRunnerPreview(config, key);
    const token = previewToken(config, { key, projectId, userId });
    const host = `${key}.preview.localhost`;

    const denied = await previewRequest("/", host);
    expect(denied.status).toBe(401);

    const wrong = await previewRequest("/", host, `pv_${key.slice(0, 8)}=not-a-token`);
    expect(wrong.status).toBe(401);

    const initial = await previewRequest(`/?token=${encodeURIComponent(token)}`, host);
    expect(initial.status).toBe(302);
    expect(preview.host).toBe(host);

    const allowed = await previewRequest("/", host, `pv_${key.slice(0, 8)}=${encodeURIComponent(token)}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toContain("Open the home page");
  }, 180_000);

  it("stops the workspace and removes its directory", async () => {
    await stopRunnerWorkspace(config, key);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fs.existsSync(path.join(root, key))).toBe(false);
    expect(fs.readdirSync(root)).toHaveLength(0);
  });
});
