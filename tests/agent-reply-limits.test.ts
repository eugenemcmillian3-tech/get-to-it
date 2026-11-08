import { describe, expect, it } from "vitest";
import { buildSpecDraft, type AppIntakeInput } from "@/lib/app-builder";
import type { TeamTaskRecord } from "@/lib/agent-team";
import {
  buildAgentMessages,
  parseAgentReply,
  retryInstruction,
  type AgentWorkerContext,
} from "@/lib/agent-worker";

const INTAKE: AppIntakeInput = {
  name: "Repair log",
  purpose: "Keep a private record of repairs, parts and follow-ups for a small workshop.",
  target_users: "Two workshop volunteers who are comfortable with email but not spreadsheets.",
  workflows: "Log a repair",
  required_pages: "/repairs | Repairs | See every repair",
  entities: "repair: title, notes, status",
  auth_requirements: "supabase",
  integrations: "",
  design_preferences: "Calm and high contrast.",
  definition_of_done: "A volunteer can log a repair and find it again the same day.",
};

function coordinator(): TeamTaskRecord {
  return {
    id: "task-1",
    run_id: "run-1",
    project_id: "project-1",
    user_id: "user-1",
    position: 0,
    role: "coordinator",
    objective: "Confirm the approved specification and publish a bounded work queue.",
    inputs: ["spec-version:approved"],
    allowed_tools: ["read_spec", "queue_tasks", "request_review"],
    expected_artifacts: [],
    acceptance_checks: ["Every work item maps to the approved specification."],
    file_claims: [],
    budget_seconds: 60,
    budget_calls: 1,
    status: "running",
    model: "deepseek-v4-pro",
    calls_used: 0,
    attempts: 1,
    retries: 0,
    retry_reason: null,
    branch_files: [],
    changed_files: [],
    output: null,
    blocker: null,
    error: null,
    started_at: null,
    finished_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const context: AgentWorkerContext = {
  spec: buildSpecDraft(INTAKE),
  projectName: "Repair log",
  integrationStatus: "pending",
  integrationChecks: [],
  currentFiles: [],
};

describe("agent reply limits", () => {
  it("names the field that broke the schema instead of a generic message", () => {
    const reply = JSON.stringify({
      summary: "x".repeat(501),
      findings: [],
      evidence: [],
      files: [],
    });
    expect(() => parseAgentReply(reply)).toThrow(/unusable task result \(summary: /);
    expect(() => parseAgentReply(reply)).toThrow(/500 characters/);
  });

  it("names an unexpected key", () => {
    const reply = JSON.stringify({ summary: "A queue was published.", queue: ["a"] });
    expect(() => parseAgentReply(reply)).toThrow(/unusable task result/);
    expect(() => parseAgentReply(reply)).toThrow(/queue/);
  });

  it("states the reply limits in the system prompt", () => {
    const [system] = buildAgentMessages(coordinator(), context);
    expect(system.content).toContain("at most 200 characters");
    expect(system.content).toContain("at most 12 items");
    expect(system.content).toContain("Add no other keys.");
  });

  it("restates the limits when a reply is retried", () => {
    const text = retryInstruction(coordinator(), "The model returned an unusable task result (summary: too big).");
    expect(text).toContain("at most 200 characters");
    expect(text).toContain("at most 12 items");
    expect(text).toContain("summary: too big");
  });
});
