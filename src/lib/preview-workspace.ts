import crypto from "node:crypto";
import { z } from "zod";
import { isSafeProjectPath } from "@/lib/app-builder";

/**
 * Phase 22 preview workspace contract.
 *
 * The app never executes project code. It sends the stored files to a separate
 * runner, which sandboxes every command. This module holds the parts that can be
 * tested without a database or a process: limits, signed preview links, the
 * repair patch format, the diff, and the prompt boundary.
 */

export const PREVIEW_LIMITS = {
  maxRepairIterations: 2,
  maxAiRequests: 2,
  maxRuntimeMs: 10 * 60_000,
  maxLogChars: 200_000,
  maxPatchFiles: 8,
  maxPatchChars: 60_000,
  maxPromptChars: 40_000,
} as const;

export const PREVIEW_CHECK_LABELS = [
  ["typecheck", "Typecheck"],
  ["lint", "Lint"],
  ["test", "Tests"],
  ["build", "Build"],
] as const;

export type PreviewCheckName = (typeof PREVIEW_CHECK_LABELS)[number][0];

export const PREVIEW_CHECK_NAMES = PREVIEW_CHECK_LABELS.map(([name]) => name);

export type PreviewConfig = {
  runnerUrl: string;
  runnerToken: string;
  signingSecret: string;
  publicOrigin: string;
};

/** Null unless every server-only value is configured. Never invents a fallback. */
export function getPreviewConfig(): PreviewConfig | null {
  const runnerUrl = process.env.PREVIEW_RUNNER_URL?.trim();
  const runnerToken = process.env.PREVIEW_RUNNER_TOKEN?.trim();
  const signingSecret = process.env.PREVIEW_SIGNING_SECRET?.trim();
  const publicOrigin = process.env.PREVIEW_PUBLIC_ORIGIN?.trim();

  if (!runnerUrl || !runnerToken || !signingSecret || !publicOrigin) return null;
  if (!/^https?:\/\/[^/\s]+$/.test(runnerUrl)) return null;
  if (!/^https?:\/\/[^/\s]+$/.test(publicOrigin)) return null;
  if (runnerToken.length < 24 || signingSecret.length < 24) return null;

  return { runnerUrl: runnerUrl.replace(/\/$/, ""), runnerToken, signingSecret, publicOrigin };
}

export class PreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewError";
  }
}

async function runnerFetch(
  config: PreviewConfig,
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${config.runnerUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.runnerToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new PreviewError(`The preview runner ${reason}. Nothing in the project was changed.`);
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `The preview runner returned ${response.status}.`;
    throw new PreviewError(message);
  }

  return payload;
}

export type RunnerWorkspace = { key: string; status: string };

export async function createRunnerWorkspace(
  config: PreviewConfig,
  input: {
    projectId: string;
    userId: string;
    files: { path: string; content: string }[];
  },
): Promise<RunnerWorkspace> {
  const payload = (await runnerFetch(config, "/v1/workspaces", {
    method: "POST",
    body: JSON.stringify(input),
  }, 60_000)) as { key?: unknown; status?: unknown };

  if (typeof payload?.key !== "string") throw new PreviewError("The runner did not return a workspace.");
  return { key: payload.key, status: String(payload.status ?? "ready") };
}

export async function updateRunnerWorkspace(
  config: PreviewConfig,
  key: string,
  input: { projectId: string; files: { path: string; content: string }[] },
): Promise<void> {
  await runnerFetch(config, `/v1/workspaces/${key}/files`, {
    method: "PUT",
    body: JSON.stringify(input),
  }, 60_000);
}

export type PreviewCheck = {
  name: string;
  label: string;
  status: "passed" | "failed" | "timed_out" | "skipped";
  code: number | null;
  log: string;
};

export type CheckResult = {
  status: "passed" | "failed";
  checks: PreviewCheck[];
  durationMs: number;
  log: string;
};

export async function runRunnerChecks(config: PreviewConfig, key: string): Promise<CheckResult> {
  const payload = (await runnerFetch(config, `/v1/workspaces/${key}/checks`, {
    method: "POST",
  }, 240_000)) as Partial<CheckResult>;

  if (!Array.isArray(payload.checks)) throw new PreviewError("The runner returned no check results.");
  return {
    status: payload.status === "passed" ? "passed" : "failed",
    checks: payload.checks as PreviewCheck[],
    durationMs: Number(payload.durationMs ?? 0),
    log: String(payload.log ?? "").slice(0, PREVIEW_LIMITS.maxLogChars),
  };
}

export async function startRunnerPreview(
  config: PreviewConfig,
  key: string,
): Promise<{ host: string; expiresAt: number }> {
  const payload = (await runnerFetch(config, `/v1/workspaces/${key}/preview`, {
    method: "POST",
  }, 180_000)) as { host?: unknown; expiresAt?: unknown };

  if (typeof payload.host !== "string") throw new PreviewError("The runner did not return a preview host.");
  return { host: payload.host, expiresAt: Number(payload.expiresAt ?? Date.now() + 20 * 60_000) };
}

export async function stopRunnerWorkspace(config: PreviewConfig, key: string): Promise<void> {
  await runnerFetch(config, `/v1/workspaces/${key}/stop`, { method: "POST" }, 15_000);
}

export function previewToken(
  config: PreviewConfig,
  input: { key: string; projectId: string; userId: string; ttlMs?: number },
): string {
  const payload = {
    k: input.key,
    p: input.projectId,
    u: input.userId,
    exp: Date.now() + (input.ttlMs ?? 20 * 60_000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", config.signingSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

/** The preview lives on its own host, never on the authenticated app origin. */
export function previewUrl(
  config: PreviewConfig,
  input: { key: string; projectId: string; userId: string },
): string {
  const url = new URL(config.publicOrigin);
  url.host = `${input.key}.${url.host}`;
  url.searchParams.set("token", previewToken(config, input));
  return url.toString();
}

const REPAIR_ROOTS = ["app/", "components/", "lib/"];
const FORBIDDEN_REPAIR =
  /(^|\/)(tests?|__tests__|package(-lock)?\.json|tsconfig[^/]*|eslint\.config[^/]*|next\.config[^/]*|postcss\.config[^/]*|supabase|\.github|\.env)/i;

export function isRepairPath(path: string): boolean {
  if (!isSafeProjectPath(path)) return false;
  if (FORBIDDEN_REPAIR.test(path)) return false;
  return REPAIR_ROOTS.some((root) => path.startsWith(root));
}

export const repairPatchSchema = z
  .object({
    summary: z.string().trim().min(5).max(300),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(160),
            content: z.string().max(PREVIEW_LIMITS.maxPatchChars),
          })
          .strict(),
      )
      .min(1)
      .max(PREVIEW_LIMITS.maxPatchFiles),
  })
  .strict();

export type RepairPatch = z.infer<typeof repairPatchSchema>;

/** Parses one JSON object, tolerating a single Markdown fence. Never trusts it. */
export function parseRepairPatch(text: string): RepairPatch {
  let value = text.trim();
  if (value.startsWith("```")) {
    value = value.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  }
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new PreviewError("The model did not return a JSON patch.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(value.slice(start, end + 1));
  } catch {
    throw new PreviewError("The model returned JSON that could not be read.");
  }

  const result = repairPatchSchema.safeParse(parsed);
  if (!result.success) throw new PreviewError("The model returned a patch outside the allowed shape.");
  return result.data;
}

export function assertRepairPatch(
  files: { path: string; content: string }[],
  patch: RepairPatch,
): void {
  const existing = new Set(files.map((file) => file.path));
  const seen = new Set<string>();
  let total = 0;

  for (const file of patch.files) {
    if (!isRepairPath(file.path)) {
      throw new PreviewError(`The patch tried to change ${file.path.slice(0, 80)}, which is outside the allowed source paths.`);
    }
    if (!existing.has(file.path)) {
      throw new PreviewError("The patch tried to create a file. Repairs may only replace existing source files.");
    }
    if (seen.has(file.path)) throw new PreviewError("The patch changed the same file twice.");
    seen.add(file.path);
    total += file.content.length;
  }
  if (total > PREVIEW_LIMITS.maxPromptChars * 2) {
    throw new PreviewError("The patch is too large to apply safely.");
  }
}

export function applyRepairPatch(
  files: { path: string; content: string }[],
  patch: RepairPatch,
): { files: { path: string; content: string }[]; changed: string[] } {
  assertRepairPatch(files, patch);
  const replacements = new Map(patch.files.map((file) => [file.path, file.content]));
  const changed = files.filter((file) => replacements.has(file.path)).map((file) => file.path);
  return {
    files: files.map((file) =>
      replacements.has(file.path) ? { path: file.path, content: replacements.get(file.path)! } : file,
    ),
    changed,
  };
}

/** A small, bounded line diff for inspection; it never rewrites the files. */
export function diffFiles(
  before: { path: string; content: string }[],
  after: { path: string; content: string }[],
): { changed: string[]; diff: string } {
  const old = new Map(before.map((file) => [file.path, file.content]));
  const changed: string[] = [];
  const chunks: string[] = [];

  for (const file of after) {
    const previous = old.get(file.path);
    if (previous === undefined || previous === file.content) continue;
    changed.push(file.path);

    const a = previous.split("\n");
    const b = file.content.split("\n");
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < a.length - prefix &&
      suffix < b.length - prefix &&
      a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    const removed = a.slice(prefix, a.length - suffix);
    const added = b.slice(prefix, b.length - suffix);
    chunks.push(
      `--- a/${file.path}\n+++ b/${file.path}\n` +
        removed.map((line) => `-${line}`).join("\n") +
        (removed.length && added.length ? "\n" : "") +
        added.map((line) => `+${line}`).join("\n"),
    );
    if (chunks.join("\n").length > PREVIEW_LIMITS.maxLogChars) break;
  }

  return { changed, diff: chunks.join("\n\n").slice(0, PREVIEW_LIMITS.maxLogChars) };
}

export function firstFailure(checks: PreviewCheck[]): PreviewCheck | null {
  return checks.find((check) => check.status === "failed" || check.status === "timed_out") ?? null;
}

export function checkSummary(checks: PreviewCheck[]): string {
  return checks
    .map((check) => `${check.label}: ${check.status === "passed" ? "passed" : check.status === "skipped" ? "not configured" : check.status}`)
    .join(" · ");
}

export type RepairMessage = { role: "system" | "user"; content: string };

/**
 * The model sees only the failing check, bounded logs, and source files. Tests,
 * configs, package files and secrets are excluded by path and by content.
 */
export function buildRepairMessages(
  files: { path: string; content: string }[],
  failure: PreviewCheck,
  previousAttempts: number,
): RepairMessage[] {
  const source = files
    .filter((file) => isRepairPath(file.path))
    .filter((file) => !/\.env/i.test(file.path))
    .map((file) => `--- ${file.path}\n${file.content}`)
    .join("\n\n")
    .slice(0, PREVIEW_LIMITS.maxPromptChars);

  return [
    {
      role: "system",
      content:
        "You repair a small Next.js, TypeScript and Tailwind project. Return ONE JSON object with " +
        'shape {"summary": string, "files": [{"path": string, "content": string}]}. ' +
        "Only replace existing source files under app/, components/ or lib/. Never create files. " +
        "Never change tests, package.json, lockfiles, tsconfig, ESLint, Next or PostCSS configuration. " +
        "Never delete a test, weaken an assertion, disable a rule, add an ignore comment, or hide an error. " +
        "Fix the cause. Do not add dependencies, credentials, secrets or network calls. " +
        "Return full file contents, not fragments or Markdown fences. If you cannot fix it, return no files.",
    },
    {
      role: "user",
      content:
        `Iteration ${previousAttempts + 1} of ${PREVIEW_LIMITS.maxRepairIterations}. ` +
        `The failing check is ${failure.label} (${failure.status}).\n\n` +
        `Log (truncated):\n${failure.log.slice(0, 12_000)}\n\n` +
        `Editable source files:\n${source}`,
    },
  ];
}
