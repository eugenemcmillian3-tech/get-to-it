import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentReplyError,
  buildAgentMessages,
  parseAgentReply,
  retryInstruction,
  runModelAgentTask,
  validateAgentReply,
  type AgentWorkerContext,
} from "@/lib/agent-worker";
import { buildSpecDraft, type AppIntakeInput } from "@/lib/app-builder";
import type { TeamTaskRecord } from "@/lib/agent-team";

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));
vi.mock("@/lib/ai/ollama", () => ({ chatWithOllama: chatMock }));

const intake: AppIntakeInput = {
  name: "Repair log",
  purpose: "Keep a private record of repairs, parts and follow-ups for a small workshop.",
  target_users: "Two workshop volunteers.",
  workflows: "Log a repair",
  required_pages: "/repairs | Repairs | See every repair",
  entities: "repair: title, notes, status",
  auth_requirements: "supabase",
  integrations: "",
  design_preferences: "Calm and high contrast.",
  definition_of_done: "A volunteer can log a repair and find it again.",
};

const spec = buildSpecDraft(intake);

function task(role: TeamTaskRecord["role"], fileClaims: string[] = []): TeamTaskRecord {
  return {
    id: "task-1",
    run_id: "run-1",
    project_id: "project-1",
    user_id: "user-1",
    position: 0,
    role,
    objective: "Do the bounded task.",
    inputs: [],
    allowed_tools: role === "frontend" ? ["read_files", "write_files"] : ["read_files"],
    expected_artifacts: [],
    acceptance_checks: ["Respect the claim."],
    file_claims: fileClaims,
    budget_seconds: 120,
    budget_calls: 1,
    status: "running",
    model: "glm-5.3-flash",
    calls_used: 0,
    attempts: 1,
    branch_files: [],
    changed_files: [],
    output: null,
    blocker: null,
    error: null,
    started_at: "2026-01-01T00:00:00.000Z",
    finished_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const context: AgentWorkerContext = {
  spec,
  projectName: "Repair log",
  integrationStatus: "pending",
  integrationChecks: [],
  currentFiles: [{ path: "components/hero.tsx", content: "export function Hero() { return null; }" }],
};

describe("agent worker reply gate", () => {
  it("parses fenced JSON and keeps a declared file claim", () => {
    const reply = parseAgentReply(
      '```json\n{"summary":"Adds the hero","findings":[],"evidence":["read the spec"],"files":[{"path":"components/hero.tsx","content":"export function Hero() { return <h1>Repairs</h1>; }"}]}\n```',
    );
    const result = validateAgentReply(task("frontend", ["components/hero.tsx"]), reply, context);

    expect(result.branch_files).toHaveLength(1);
    expect(result.branch_files[0]).toMatchObject({
      path: "components/hero.tsx",
      base_content: "export function Hero() { return null; }",
    });
    expect(result.output.summary).toBe("Adds the hero");
  });

  it("rejects a file the task did not declare", () => {
    const reply = parseAgentReply(
      '{"summary":"Writes another file","files":[{"path":"components/other.tsx","content":"x"}]}',
    );
    expect(() => validateAgentReply(task("frontend", ["components/hero.tsx"]), reply, context)).toThrow(
      "not in this task's declared file claim",
    );
  });

  it("rejects writes from a read-only role", () => {
    const reply = parseAgentReply(
      '{"summary":"Coordinates","files":[{"path":"components/hero.tsx","content":"x"}]}',
    );
    expect(() => validateAgentReply(task("coordinator"), reply, context)).toThrow(
      "cannot write files",
    );
  });

  it("allows a data task to report that no schema change is needed", () => {
    const reply = parseAgentReply(
      '{"summary":"No migration is required","findings":["No new table is justified."],"files":[]}',
    );
    const result = validateAgentReply(task("data"), reply, context);
    expect(result.branch_files).toEqual([]);
    expect(result.output.findings).toEqual(["No new table is justified."]);
  });

  it("rejects credential-like content before a branch can be integrated", () => {
    const reply = parseAgentReply(
      '{"summary":"Adds config","files":[{"path":"components/hero.tsx","content":"const api_key = \\"sk-abcdefghijklmnopqrstuvwx\\";"}]}',
    );
    expect(() => validateAgentReply(task("frontend", ["components/hero.tsx"]), reply, context)).toThrow(
      "appears to contain a credential",
    );
  });

  it("rejects invalid JSON with a usable error", () => {
    expect(() => parseAgentReply("I changed the hero.")).toThrow("valid JSON");
  });
});

describe("model reply retry", () => {
  const claims = ["components/hero.tsx"];
  const validReply = JSON.stringify({
    summary: "Adds the hero",
    findings: [],
    evidence: ["read the spec"],
    files: [
      {
        path: "components/hero.tsx",
        content: "export function Hero() { return <h1>Repairs</h1>; }",
      },
    ],
  });

  beforeEach(() => {
    chatMock.mockReset();
  });

  it("retries once when the first reply breaks the schema", async () => {
    chatMock
      .mockResolvedValueOnce({
        content: '{"unexpected":"shape"}',
        model: "glm-5.3-flash",
        tokens: { input: 10, output: 5 },
      })
      .mockResolvedValueOnce({
        content: validReply,
        model: "glm-5.3-flash",
        tokens: { input: 12, output: 9 },
      });

    const result = await runModelAgentTask(
      task("frontend", claims),
      context,
      "glm-5.3-flash",
    );

    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.branch_files.map((file) => file.path)).toEqual(claims);
    expect(result.tokens).toEqual({ input: 12, output: 9 });
  });

  it("gives up after two rejections and reports the attempts spent", async () => {
    chatMock.mockResolvedValue({
      content: '{"unexpected":"shape"}',
      model: "glm-5.3-flash",
      tokens: { input: 1, output: 1 },
    });

    const error = await runModelAgentTask(task("frontend", claims), context, "glm-5.3-flash").catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(AgentReplyError);
    expect((error as AgentReplyError).attempts).toBe(2);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a provider error", async () => {
    chatMock.mockRejectedValue(new Error("Ollama returned 500"));

    await expect(
      runModelAgentTask(task("frontend", claims), context, "glm-5.3-flash"),
    ).rejects.toThrow("Ollama returned 500");
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
});

describe("retry instruction", () => {
  it("tells a read-only role that files must be empty", () => {
    const text = retryInstruction(task("security"), "Security reviewer cannot write files.");
    expect(text).toContain('"files" must be an empty array []');
    expect(text).toContain("Security reviewer cannot write files.");
  });

  it("reminds a writing role of its declared claims instead", () => {
    const text = retryInstruction(task("frontend", ["components/hero.tsx"]), "bad shape");
    expect(text).toContain("components/hero.tsx");
    expect(text).not.toContain("empty array");
  });

  it("redacts a credential-looking rejection reason", () => {
    const text = retryInstruction(task("security"), "sk-abcdefghijklmnopqrstuvwx");
    expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(text).toContain("[redacted");
  });

  it("retries a read-only role whose first reply proposed files", async () => {
    chatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: "Tightens the client",
          findings: [],
          evidence: [],
          files: [{ path: "lib/db.ts", content: "export const x = 1;" }],
        }),
        model: "nemotron-3-nano:30b-cloud",
        tokens: { input: 5, output: 5 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: "No secret values were reproduced",
          findings: ["Pattern review only"],
          evidence: [],
          files: [],
        }),
        model: "nemotron-3-nano:30b-cloud",
        tokens: { input: 6, output: 6 },
      });

    const result = await runModelAgentTask(task("security"), context, "nemotron-3-nano:30b-cloud");

    expect(result.attempts).toBe(2);
    expect(result.branch_files).toEqual([]);
    const secondCall = chatMock.mock.calls[1][0] as { messages: { content: string }[] };
    expect(secondCall.messages.at(-1)?.content).toContain("empty array");
  });
});

describe("system prompt", () => {
  it("states the empty-files rule up front for a read-only role", () => {
    const messages = buildAgentMessages(task("security"), context);
    expect(messages[0].content).toContain('"files" must be an empty array []');
    expect(messages[0].content).toContain("Security reviewer cannot write files");
  });

  it("applies the same rule to the coordinator without forbidding writes elsewhere", () => {
    expect(buildAgentMessages(task("coordinator"), context)[0].content).toContain(
      '"files" must be an empty array []',
    );
    const writing = buildAgentMessages(task("frontend", ["components/hero.tsx"]), context);
    expect(writing[0].content).not.toContain("empty array");
    expect(writing[0].content).toContain("components/hero.tsx");
  });
});
