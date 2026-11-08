import { describe, expect, it } from "vitest";
import {
  parseAgentReply,
  validateAgentReply,
  type AgentWorkerContext,
} from "@/lib/agent-worker";
import { buildSpecDraft, type AppIntakeInput } from "@/lib/app-builder";
import type { TeamTaskRecord } from "@/lib/agent-team";

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
