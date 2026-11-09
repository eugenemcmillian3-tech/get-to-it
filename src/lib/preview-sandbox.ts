import crypto from "node:crypto";

/**
 * Phase 22 sandbox backend, served by Render Sandboxes (public beta).
 *
 * The app never executes project code. This module hands the stored files to a
 * Render sandbox — a Firecracker microVM with its own filesystem — runs the same
 * fixed command policy the local runner uses, and reads back the log and exit
 * codes. Nothing here accepts a command from the browser.
 *
 * Render's beta provides no public URLs, so a preview server cannot be reached
 * from a browser. Checks, logs and the repair loop work; the live preview is
 * reported as unavailable instead of pretending.
 *
 * The sandbox is stateless: every check run creates one, uploads the files,
 * runs the policy, and terminates it in a `finally`. That keeps a stored
 * `runner_key` meaningful as an identifier without needing a schema change.
 */

/** The only commands the policy may run. Mirrors the local runner's allowlist. */
export const SANDBOX_COMMANDS = {
  install: "npm install --no-audit --no-fund --no-progress",
  typecheck: "npx --no-install tsc --noEmit",
  lint: "npx --no-install eslint .",
  build: "npx --no-install next build",
  test: "npm test --silent",
} as const;

export const SANDBOX_LIMITS = {
  installTimeoutMs: 300_000,
  checkTimeoutMs: 150_000,
  totalTimeoutMs: 600_000,
  maxLogChars: 200_000,
} as const;

export type SandboxConfig = {
  apiKey: string;
  workspaceId: string;
  snapshotId: string | null;
  plan: string;
};

/**
 * Null unless a key and workspace are configured. Never invents a fallback and
 * never reads the key into a log line.
 */
export function getSandboxConfig(env: Record<string, string | undefined> = process.env): SandboxConfig | null {
  const apiKey = env.RENDER_API_KEY?.trim();
  const workspaceId = env.RENDER_WORKSPACE_ID?.trim();
  if (!apiKey || !workspaceId) return null;
  const snapshotId = env.RENDER_SANDBOX_SNAPSHOT_ID?.trim();
  return {
    apiKey,
    workspaceId,
    snapshotId: snapshotId ? snapshotId : null,
    plan: env.RENDER_SANDBOX_PLAN?.trim() || "1c-2g",
  };
}

/** A 32-hex identifier, the shape the workspace and improvement tables accept. */
export function newSandboxKey(): string {
  return crypto.randomBytes(16).toString("hex");
}

export type SandboxCheckName = "typecheck" | "lint" | "test" | "build";

export type SandboxCheck = {
  name: SandboxCheckName;
  label: string;
  status: "passed" | "failed" | "timed_out" | "skipped";
  code: number | null;
  log: string;
};

export type SandboxCheckResult = {
  status: "passed" | "failed";
  checks: SandboxCheck[];
  durationMs: number;
  log: string;
};

const LABELS: Record<SandboxCheckName, string> = {
  typecheck: "Typecheck",
  lint: "Lint",
  test: "Tests",
  build: "Build",
};

/**
 * Which checks a project actually has configured. A project without a test
 * script reports Tests as skipped rather than inventing a pass or a failure.
 */
export function plannedChecks(packageJson: string | null): SandboxCheckName[] {
  const checks: SandboxCheckName[] = ["typecheck", "lint"];
  let scripts: Record<string, unknown> = {};
  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson) as { scripts?: Record<string, unknown> };
      if (parsed.scripts && typeof parsed.scripts === "object") scripts = parsed.scripts;
    } catch {
      scripts = {};
    }
  }
  if (typeof scripts.test === "string" && scripts.test.trim()) checks.push("test");
  checks.push("build");
  return checks;
}

/** Bounds a log before it is stored, keeping the tail where a failure lives. */
export function trimLog(text: string, max: number = SANDBOX_LIMITS.maxLogChars): string {
  if (text.length <= max) return text;
  const marker = "\n… log truncated …\n";
  return text.slice(0, Math.floor(max / 3)) + marker + text.slice(text.length - (max - Math.floor(max / 3) - marker.length));
}

export type ExecEvent =
  | { type: "output"; stream: "stdout" | "stderr"; data: string }
  | { type: "exit"; exit_code: number };

/** Collects a streamed exec into bounded output plus an exit code. */
export async function collectExec(
  events: AsyncIterable<ExecEvent> | Iterable<ExecEvent>,
  max: number = 60_000,
): Promise<{ output: string; code: number | null }> {
  let output = "";
  let code: number | null = null;
  for await (const event of events as AsyncIterable<ExecEvent>) {
    if (event.type === "output") {
      output += event.data;
      if (output.length > max) output = output.slice(0, max);
    } else {
      code = event.exit_code;
    }
  }
  return { output, code };
}

export function checkFromExit(name: SandboxCheckName, code: number | null, output: string): SandboxCheck {
  return {
    name,
    label: LABELS[name],
    status: code === 0 ? "passed" : "failed",
    code,
    log: trimLog(output || "(no output)"),
  };
}

/** The human label for a check, shared with the UI. */
export function sandboxCheckLabel(name: SandboxCheckName): string {
  return LABELS[name];
}

export class SandboxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxUnavailableError";
  }
}

/**
 * Minimal slice of the Render SDK this module uses. Keeping it structural lets
 * the flow be tested without a network call or an API key.
 */
export type SandboxClient = {
  create(input: { plan: string; snapshotId?: string; timeoutSeconds: number; wait: boolean }): Promise<{ id: string; status: string }>;
  upload(id: string, path: string, data: string): Promise<void>;
  exec(id: string, command: string, options: { signal: AbortSignal }): Promise<AsyncIterable<ExecEvent>>;
  terminate(id: string): Promise<void>;
};

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new SandboxUnavailableError("The sandbox command timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs the fixed command policy against one set of files in a fresh sandbox. */
export async function runSandboxChecks(
  config: SandboxConfig,
  client: SandboxClient,
  files: { path: string; content: string }[],
): Promise<SandboxCheckResult> {
  if (files.length === 0) throw new SandboxUnavailableError("The project has no files to check.");
  const packageJson = files.find((file) => file.path === "package.json")?.content ?? null;
  const names = plannedChecks(packageJson);
  const startedAt = Date.now();
  const checks: SandboxCheck[] = [];
  const logs: string[] = [];

  const sandbox = await client.create({
    plan: config.plan,
    ...(config.snapshotId ? { snapshotId: config.snapshotId } : {}),
    timeoutSeconds: Math.ceil(SANDBOX_LIMITS.totalTimeoutMs / 1000) + 300,
    wait: true,
  });

  try {
    for (const file of files) {
      await client.upload(sandbox.id, `project/${file.path}`, file.content);
    }

    const install = await withTimeout(SANDBOX_LIMITS.installTimeoutMs, async (signal) =>
      await collectExec(await client.exec(sandbox.id, `cd project && ${SANDBOX_COMMANDS.install}`, { signal })),
    );
    if (install.code !== 0) {
      throw new SandboxUnavailableError(
        `The sandbox could not install the pinned dependencies (exit ${install.code}). ${trimLog(install.output, 400)}`,
      );
    }

    for (const name of names) {
      const result = await withTimeout(SANDBOX_LIMITS.checkTimeoutMs, async (signal) =>
        await collectExec(await client.exec(sandbox.id, `cd project && ${SANDBOX_COMMANDS[name]}`, { signal })),
      );
      checks.push(checkFromExit(name, result.code, result.output));
      logs.push(`## ${LABELS[name]}\n${result.output}`);
    }
  } finally {
    await client.terminate(sandbox.id).catch(() => undefined);
  }

  const log = trimLog(logs.join("\n\n"));
  return {
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks,
    durationMs: Date.now() - startedAt,
    log,
  };
}

/** Builds the real Render client lazily so importing this module never throws. */
export async function createRenderSandboxClient(config: SandboxConfig): Promise<SandboxClient> {
  const { Render } = await import("@renderinc/sdk");
  const render = new Render({ token: config.apiKey, ownerId: config.workspaceId });
  const sandboxes = render.sandboxes;
  return {
    create: (input) => sandboxes.create(input as Parameters<typeof sandboxes.create>[0]) as Promise<{ id: string; status: string }>,
    upload: (id, path, data) => sandboxes.upload(id, path, data) as Promise<void>,
    exec: (id, command, options) => sandboxes.exec(id, command, undefined, options.signal) as unknown as Promise<AsyncIterable<ExecEvent>>,
    terminate: (id) => sandboxes.terminate(id) as Promise<void>,
  };
}
