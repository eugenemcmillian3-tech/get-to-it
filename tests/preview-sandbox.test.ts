import { describe, expect, it, vi } from "vitest";
import {
  SANDBOX_COMMANDS,
  collectExec,
  checkFromExit,
  getSandboxConfig,
  newSandboxKey,
  plannedChecks,
  runSandboxChecks,
  trimLog,
  type ExecEvent,
  type SandboxClient,
} from "../src/lib/preview-sandbox";

const config = {
  apiKey: "rnd_test_key",
  workspaceId: "tea-test",
  snapshotId: null,
  plan: "1c-2g",
};

function fakeClient(overrides: Partial<SandboxClient> = {}): SandboxClient & {
  uploads: { id: string; path: string; data: string }[];
  execs: string[];
  terminated: string[];
} {
  const uploads: { id: string; path: string; data: string }[] = [];
  const execs: string[] = [];
  const terminated: string[] = [];
  const client = {
    uploads,
    execs,
    terminated,
    create: vi.fn(async () => ({ id: "sbx-1", status: "running" })),
    upload: vi.fn(async (id: string, path: string, data: string) => {
      uploads.push({ id, path, data });
    }),
    exec: vi.fn(async (_id: string, command: string) => {
      execs.push(command);
      const events: ExecEvent[] = [{ type: "output", stream: "stdout", data: "ok" }, { type: "exit", exit_code: 0 }];
      return (async function* () {
        for (const event of events) yield event;
      })();
    }),
    terminate: vi.fn(async (id: string) => {
      terminated.push(id);
    }),
    ...overrides,
  };
  return client as unknown as SandboxClient & typeof client;
}

const files = [
  { path: "package.json", content: JSON.stringify({ scripts: { build: "next build" } }) },
  { path: "app/page.tsx", content: "export default function Page() { return null; }\n" },
];

describe("sandbox configuration", () => {
  it("stays off without a key and workspace", () => {
    expect(getSandboxConfig({})).toBeNull();
    expect(getSandboxConfig({ RENDER_API_KEY: "rnd_x" })).toBeNull();
    expect(getSandboxConfig({ RENDER_WORKSPACE_ID: "tea-x" })).toBeNull();
  });

  it("reads the key, workspace and optional snapshot", () => {
    const parsed = getSandboxConfig({ RENDER_API_KEY: " rnd_x ", RENDER_WORKSPACE_ID: "tea-x" });
    expect(parsed).toEqual({ apiKey: "rnd_x", workspaceId: "tea-x", snapshotId: null, plan: "1c-2g" });
    expect(
      getSandboxConfig({
        RENDER_API_KEY: "k",
        RENDER_WORKSPACE_ID: "w",
        RENDER_SANDBOX_SNAPSHOT_ID: "snap-1",
        RENDER_SANDBOX_PLAN: "2c-4g",
      }),
    ).toEqual({ apiKey: "k", workspaceId: "w", snapshotId: "snap-1", plan: "2c-4g" });
  });

  it("generates keys of the shape the tables accept", () => {
    expect(newSandboxKey()).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("check planning", () => {
  it("runs tests only when a test script exists", () => {
    expect(plannedChecks(null)).toEqual(["typecheck", "lint", "build"]);
    expect(plannedChecks(JSON.stringify({ scripts: { test: "vitest run" } }))).toEqual([
      "typecheck",
      "lint",
      "test",
      "build",
    ]);
    expect(plannedChecks("{ not json")).toEqual(["typecheck", "lint", "build"]);
  });

  it("maps exit codes to statuses without inventing a pass", () => {
    expect(checkFromExit("build", 0, "ok").status).toBe("passed");
    expect(checkFromExit("build", 2, "boom").status).toBe("failed");
    expect(checkFromExit("build", null, "no exit event").status).toBe("failed");
  });
});

describe("log handling", () => {
  it("keeps the tail where the failure is", () => {
    const long = "a".repeat(500) + "TAIL";
    const trimmed = trimLog(long, 100);
    expect(trimmed.length).toBeLessThanOrEqual(100);
    expect(trimmed).toContain("TAIL");
    expect(trimmed).toContain("truncated");
  });

  it("collects streamed output and the final exit code", async () => {
    const events: ExecEvent[] = [
      { type: "output", stream: "stdout", data: "hello " },
      { type: "output", stream: "stderr", data: "world" },
      { type: "exit", exit_code: 1 },
    ];
    expect(await collectExec(events)).toEqual({ output: "hello world", code: 1 });
    expect((await collectExec(events, 3)).output).toHaveLength(3);
  });
});

describe("runSandboxChecks", () => {
  it("uploads every file, runs the fixed policy, and terminates", async () => {
    const client = fakeClient();
    const result = await runSandboxChecks(config, client, files);

    expect(client.uploads.map((u) => u.path)).toEqual(["project/package.json", "project/app/page.tsx"]);
    expect(client.execs[0]).toBe(`cd project && ${SANDBOX_COMMANDS.install}`);
    expect(client.execs).toContain(`cd project && ${SANDBOX_COMMANDS.typecheck}`);
    expect(client.execs).toContain(`cd project && ${SANDBOX_COMMANDS.build}`);
    expect(client.execs).not.toContain(`cd project && ${SANDBOX_COMMANDS.test}`);
    expect(client.terminated).toEqual(["sbx-1"]);
    expect(result.status).toBe("passed");
    expect(result.checks.map((check) => check.name)).toEqual(["typecheck", "lint", "build"]);
  });

  it("reports a failing check and still terminates the sandbox", async () => {
    const client = fakeClient({
      exec: vi.fn(async (_id: string, command: string) => {
        const failing = command.includes(SANDBOX_COMMANDS.build);
        const events: ExecEvent[] = [
          { type: "output", stream: "stderr", data: failing ? "Type error in app/page.tsx" : "ok" },
          { type: "exit", exit_code: failing ? 1 : 0 },
        ];
        return (async function* () {
          for (const event of events) yield event;
        })();
      }),
    });

    const result = await runSandboxChecks(config, client, files);
    expect(result.status).toBe("failed");
    expect(result.checks.find((check) => check.name === "build")).toMatchObject({
      status: "failed",
      code: 1,
    });
    expect(result.log).toContain("Type error in app/page.tsx");
    expect(client.terminated).toEqual(["sbx-1"]);
  });

  it("refuses to run when the install fails and never reports a pass", async () => {
    const client = fakeClient({
      exec: vi.fn(async () => {
        const events: ExecEvent[] = [{ type: "exit", exit_code: 127 }];
        return (async function* () {
          for (const event of events) yield event;
        })();
      }),
    });

    await expect(runSandboxChecks(config, client, files)).rejects.toThrow(/could not install/i);
    expect(client.terminated).toEqual(["sbx-1"]);
  });

  it("rejects an empty project instead of creating a sandbox", async () => {
    const client = fakeClient();
    await expect(runSandboxChecks(config, client, [])).rejects.toThrow(/no files/i);
    expect(client.create).not.toHaveBeenCalled();
  });
});
