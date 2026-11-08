import { z } from "zod";
import {
  roleDefinition,
  taskCanWritePath,
  type TeamBranchFile,
  type TeamCheck,
  type TeamIntegrationStatus,
  type TeamRole,
  type TeamTaskRecord,
} from "@/lib/agent-team";
import { chatWithOllama } from "@/lib/ai/ollama";
import { isSafeProjectPath, type AppSpec } from "@/lib/app-builder";

/**
 * A model-backed agent worker.
 *
 * This module only proposes a branch. It has no shell, filesystem, deployment,
 * billing or credential tool. The action reserves credits before calling it,
 * validates the reply here, and still requires the owner's review and explicit
 * integration before any file reaches the project.
 */

const MAX_FILES = 8;
const MAX_FILE_BYTES = 60_000;
const MAX_CONTEXT_BYTES = 32_000;
const MAX_CONTEXT_FILES = 20;

const fileSchema = z
  .object({
    path: z.string().trim().min(1).max(160),
    content: z.string().max(MAX_FILE_BYTES),
  })
  .strict();

export const agentReplySchema = z
  .object({
    summary: z.string().trim().min(5).max(500),
    findings: z.array(z.string().trim().min(1).max(500)).max(12).optional().default([]),
    evidence: z.array(z.string().trim().min(1).max(500)).max(12).optional().default([]),
    files: z.array(fileSchema).max(MAX_FILES).optional().default([]),
  })
  .strict();

export type AgentReply = z.infer<typeof agentReplySchema>;

export type AgentWorkerContext = {
  spec: AppSpec;
  projectName: string;
  integrationStatus: TeamIntegrationStatus;
  integrationChecks: TeamCheck[];
  currentFiles: { path: string; content: string }[];
};

export class AgentReplyError extends Error {
  /** Model calls spent before this reply was rejected. */
  attempts: number;

  constructor(message: string, attempts = 1) {
    super(message);
    this.name = "AgentReplyError";
    this.attempts = attempts;
  }
}

const ROLE_INSTRUCTIONS: Record<TeamRole, string> = {
  coordinator:
    "You coordinate a queue derived from an approved specification. Never add features, pages, entities or scope. You cannot write files. Return a short queue or closeout note.",
  frontend:
    "You own UI files under app/ and components/. Do not edit APIs, data migrations, tests or configuration. Return complete files, not diffs.",
  backend:
    "You own application logic under app/api/ and lib/. Do not edit UI, data migrations, tests or configuration. Return complete files, not diffs.",
  data:
    "You own forward-only SQL migrations under supabase/. Never access a production database, service-role key or seeded account. If no schema change is required, return no files and say so.",
  qa:
    "You review the integrated project and report acceptance evidence. You cannot write or change code to make a check pass. Report skipped and failed checks honestly.",
  security:
    "You perform a short issue-finding review of the integrated files. You cannot write code. Never reproduce a secret value. Label this as a pattern review, not a complete audit.",
};

const SECRET_ASSIGNMENT =
  /(?:api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["'][^"'\n]{8,}["']/i;
const SECRET_TOKEN =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/;

/** Strips a markdown fence without accepting arbitrary prose before the JSON. */
export function parseAgentReply(content: string): AgentReply {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    throw new AgentReplyError("The model did not return valid JSON.");
  }

  const result = agentReplySchema.safeParse(parsed);
  if (!result.success) {
    throw new AgentReplyError("The model returned an unusable task result.");
  }
  return result.data;
}

function cleanText(value: string, max = 500): string {
  return value
    .replace(SECRET_TOKEN, "[redacted]")
    .replace(SECRET_ASSIGNMENT, "[redacted assignment]")
    .slice(0, max);
}

/**
 * Validates role permissions, declared file claims and safe paths. A claimed
 * path is required, so an agent cannot silently expand its ownership.
 */
export function validateAgentReply(
  task: TeamTaskRecord,
  reply: AgentReply,
  context: Pick<AgentWorkerContext, "currentFiles">,
): { branch_files: TeamBranchFile[]; output: { summary: string; findings: string[]; evidence: string[] } } {
  const definition = roleDefinition(task.role);
  const files = reply.files ?? [];
  const claims = new Set(task.file_claims);
  const current = new Map(context.currentFiles.map((file) => [file.path, file.content]));

  if (!definition.canWrite && files.length > 0) {
    throw new AgentReplyError(`${definition.label} cannot write files.`);
  }

  if (definition.canWrite && task.file_claims.length > 0 && files.length === 0) {
    throw new AgentReplyError("The model returned no file for its declared claim.");
  }

  if (files.length === 0 && task.role !== "data" && task.role !== "coordinator" && task.role !== "qa" && task.role !== "security") {
    throw new AgentReplyError("The model returned no change.");
  }

  const seen = new Set<string>();
  const branchFiles: TeamBranchFile[] = [];

  for (const file of files) {
    if (!claims.has(file.path)) {
      throw new AgentReplyError(`${file.path} is not in this task's declared file claim.`);
    }
    if (!isSafeProjectPath(file.path) || !taskCanWritePath(task, file.path)) {
      throw new AgentReplyError(`${file.path} is outside this role's ownership.`);
    }
    if (seen.has(file.path)) {
      throw new AgentReplyError(`${file.path} was returned more than once.`);
    }
    if (SECRET_TOKEN.test(file.content) || SECRET_ASSIGNMENT.test(file.content)) {
      throw new AgentReplyError(`${file.path} appears to contain a credential.`);
    }
    seen.add(file.path);
    branchFiles.push({
      path: file.path,
      content: file.content,
      base_content: current.get(file.path) ?? null,
    });
  }

  return {
    branch_files: branchFiles,
    output: {
      summary: cleanText(reply.summary),
      findings: (reply.findings ?? []).map((item) => cleanText(item, 500)),
      evidence: (reply.evidence ?? []).map((item) => cleanText(item, 500)),
    },
  };
}

function boundedFiles(task: TeamTaskRecord, files: AgentWorkerContext["currentFiles"]) {
  const definition = roleDefinition(task.role);
  const relevant = definition.canWrite
    ? files.filter(
        (file) =>
          task.file_claims.includes(file.path) ||
          definition.writeRoots.some((root) => file.path.startsWith(root)),
      )
    : files;

  const selected: { path: string; content: string }[] = [];
  let bytes = 0;
  for (const file of relevant.slice(0, MAX_CONTEXT_FILES)) {
    if (bytes + file.content.length > MAX_CONTEXT_BYTES) break;
    selected.push(file);
    bytes += file.content.length;
  }
  return selected;
}

function specForPrompt(spec: AppSpec): string {
  return JSON.stringify(
    {
      stack: spec.stack,
      purpose: spec.purpose,
      features: spec.features,
      exclusions: spec.exclusions,
      pages: spec.pages,
      entities: spec.entities,
      server_operations: spec.server_operations,
      authorization_rules: spec.authorization_rules,
      env_vars: spec.env_vars,
      acceptance_checks: spec.acceptance_checks,
      design_preferences: spec.design_preferences,
      definition_of_done: spec.definition_of_done,
    },
    null,
    2,
  ).slice(0, 12_000);
}

export function buildAgentMessages(
  task: TeamTaskRecord,
  context: AgentWorkerContext,
): { role: "system" | "user"; content: string }[] {
  const definition = roleDefinition(task.role);
  const files = boundedFiles(task, context.currentFiles);
  const fileText = files
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join("\n\n") || "No relevant files exist yet.";

  return [
    {
      role: "system",
      content: [
        `You are the ${definition.label} in GET TO IT's bounded agent team.`,
        definition.note,
        ROLE_INSTRUCTIONS[task.role],
        `Allowed capability labels: ${task.allowed_tools.join(", ") || "none"}.`,
        `Writable roots: ${definition.writeRoots.join(", ") || "none"}.`,
        `Declared file claims: ${task.file_claims.join(", ") || "none"}.`,
        "Return only JSON with this shape:",
        '{"summary":"short result","findings":["..."],"evidence":["..."],"files":[{"path":"exact claimed path","content":"complete file"}]}',
        "Use complete file contents, not patches. Return files only for declared claims.",
        "Never include a secret, token, key, password, deployment command or external action.",
        "Do not add scope, pages, entities, tests, configuration or dependencies.",
        "If the role cannot write, return no files.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Project: ${context.projectName}`,
        `Integration status: ${context.integrationStatus}`,
        `Task: ${task.objective}`,
        `Inputs: ${task.inputs.join("; ") || "none"}`,
        `Expected artifacts: ${task.expected_artifacts.join("; ") || "none"}`,
        `Acceptance checks: ${task.acceptance_checks.join("; ") || "none"}`,
        `Approved specification:\n${specForPrompt(context.spec)}`,
        `Integration evidence:\n${
          context.integrationChecks
            .map((check) => `${check.label}: ${check.status} (code ${check.code ?? "n/a"})`)
            .join("\n") || "No runner checks recorded."
        }`,
        `Relevant current files:\n${fileText}`,
      ].join("\n\n"),
    },
  ];
}

export type ModelTaskResult = {
  status: "completed" | "awaiting_review";
  output: { summary: string; findings: string[]; evidence: string[]; checks?: TeamCheck[] };
  branch_files: TeamBranchFile[];
  tokens: { input: number | null; output: number | null };
  model: string;
  /** Model calls actually made: 1 normally, 2 after one rejected reply. */
  attempts: number;
};

/**
 * A reply that breaks the schema is a model mistake, not a task failure, so it
 * is worth asking once more. The ceiling is deliberately two: every attempt is
 * charged to the run's call budget, so one flaky model cannot spin a queue.
 */
export const MAX_REPLY_ATTEMPTS = 2;

const RETRY_INSTRUCTION = [
  "Your previous reply was rejected because it did not match the required JSON.",
  "Return only one JSON object with exactly these keys: summary, findings, evidence, files.",
  "No prose, no extra keys, no markdown fence. Respect every declared file claim.",
].join(" ");

/**
 * Runs one model-backed task. The caller must reserve credits first and close
 * the reservation with the returned tokens. A malformed reply is retried at
 * most once; any remaining failure throws, so the caller records a failed task
 * and the reservation is released. Provider errors are never retried here.
 */
export async function runModelAgentTask(
  task: TeamTaskRecord,
  context: AgentWorkerContext,
  model: string,
  timeoutMs = 90_000,
): Promise<ModelTaskResult> {
  const baseMessages = buildAgentMessages(task, context);

  for (let attempt = 1; attempt <= MAX_REPLY_ATTEMPTS; attempt += 1) {
    const reply = await chatWithOllama({
      model,
      messages:
        attempt === 1
          ? baseMessages
          : [...baseMessages, { role: "user" as const, content: RETRY_INSTRUCTION }],
      format: "json",
      temperature: 0.1,
      timeoutMs,
    });

    try {
      const parsed = parseAgentReply(reply.content);
      const validated = validateAgentReply(task, parsed, context);
      const needsReview =
        task.role === "qa" ||
        task.role === "security" ||
        (task.role === "coordinator" && task.inputs.includes("closeout"));

      return {
        status: needsReview ? "awaiting_review" : "completed",
        output: {
          ...validated.output,
          ...(task.role === "qa" ? { checks: context.integrationChecks } : {}),
          ...(task.role === "security"
            ? { findings: [...validated.output.findings, "Pattern review only: this is not a complete security audit."] }
            : {}),
        },
        branch_files: validated.branch_files,
        tokens: reply.tokens,
        model: reply.model,
        attempts: attempt,
      };
    } catch (error) {
      if (!(error instanceof AgentReplyError)) throw error;
      if (attempt === MAX_REPLY_ATTEMPTS) throw new AgentReplyError(error.message, attempt);
    }
  }

  throw new AgentReplyError("The model returned an unusable task result.", MAX_REPLY_ATTEMPTS);
}
