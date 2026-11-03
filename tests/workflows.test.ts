import { describe, expect, it } from "vitest";
import {
  CONNECTORS,
  NO_REAL_CONNECTOR_NOTE,
  demoConnector,
  executorFor,
  getConnector,
  hasRealConnector,
} from "@/lib/connectors";
import {
  EXAMPLE_WORKFLOW_STEPS,
  MAX_DRAFT_LENGTH,
  MAX_SELECTED_TASKS,
  RUN_STATUSES,
  RUN_STATUS_LABELS,
  STEP_KIND_LABELS,
  STEP_STATUS_LABELS,
  WORKFLOW_MAX_STEPS,
  WORKFLOW_STEP_KINDS,
  actionIdempotencyKey,
  approvalCoversAction,
  approvalPreviewLines,
  buildDraftMessages,
  canApproveAction,
  canCancelRun,
  canExecuteAction,
  canRetryStep,
  cleanSelectedTasks,
  contentHash,
  describeStep,
  formatWorkflowTime,
  isDraftUsable,
  isTerminalRunStatus,
  normalizeDraft,
  parseRunContext,
  preservedOutputs,
  runProgress,
  runStatusForStepKind,
  stepStatusForStepKind,
  stepsFromTemplate,
  workflowErrorMessage,
  workflowInputSchema,
  workflowStepsSchema,
} from "@/lib/workflows";

const baseWorkflow = {
  name: "Prepare a weekly project update",
  description: "Draft, review, optionally save.",
  goal_id: "",
  steps: EXAMPLE_WORKFLOW_STEPS,
};

describe("workflow step kinds", () => {
  it("supports exactly the five documented kinds", () => {
    expect([...WORKFLOW_STEP_KINDS]).toEqual([
      "user_input",
      "ai_draft",
      "user_review",
      "connector_action",
      "checkpoint",
    ]);
    for (const kind of WORKFLOW_STEP_KINDS) {
      expect(STEP_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it("accepts the example weekly update workflow", () => {
    const parsed = workflowInputSchema.safeParse(baseWorkflow);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.steps.map((step) => step.kind)).toEqual([
      "user_input",
      "ai_draft",
      "user_review",
      "connector_action",
      "checkpoint",
    ]);
  });
});

describe("workflow validation", () => {
  it("requires input first", () => {
    const parsed = workflowInputSchema.safeParse({
      ...baseWorkflow,
      steps: EXAMPLE_WORKFLOW_STEPS.slice(1),
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0].message).toMatch(/first step/i);
  });

  it("requires drafting, review and a checkpoint", () => {
    const withoutDraft = workflowInputSchema.safeParse({
      ...baseWorkflow,
      steps: EXAMPLE_WORKFLOW_STEPS.filter((step) => step.kind !== "ai_draft"),
    });
    expect(withoutDraft.success).toBe(false);

    const withoutReview = workflowInputSchema.safeParse({
      ...baseWorkflow,
      steps: EXAMPLE_WORKFLOW_STEPS.filter((step) => step.kind !== "user_review"),
    });
    expect(withoutReview.success).toBe(false);

    const withoutCheckpoint = workflowInputSchema.safeParse({
      ...baseWorkflow,
      steps: EXAMPLE_WORKFLOW_STEPS.filter((step) => step.kind !== "checkpoint"),
    });
    expect(withoutCheckpoint.success).toBe(false);
  });

  it("refuses a connector action before a review step", () => {
    const parsed = workflowInputSchema.safeParse({
      ...baseWorkflow,
      steps: [
        EXAMPLE_WORKFLOW_STEPS[0],
        EXAMPLE_WORKFLOW_STEPS[1],
        EXAMPLE_WORKFLOW_STEPS[3],
        EXAMPLE_WORKFLOW_STEPS[2],
        EXAMPLE_WORKFLOW_STEPS[4],
      ],
    });
    expect(parsed.success).toBe(false);
    const messages = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
    expect(messages.join(" ")).toMatch(/after a review step/);
  });

  it("requires a destination for a connector action", () => {
    const parsed = workflowInputSchema.safeParse({
      ...baseWorkflow,
      steps: EXAMPLE_WORKFLOW_STEPS.map((step) =>
        step.kind === "connector_action" ? { ...step, config: { connector: "demo_notes" } } : step,
      ),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown step kind", () => {
    const parsed = workflowInputSchema.safeParse({
      ...baseWorkflow,
      steps: [...EXAMPLE_WORKFLOW_STEPS, { kind: "http_request", title: "Call an API" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("caps the number of steps", () => {
    const many = Array.from({ length: WORKFLOW_MAX_STEPS + 1 }, () => ({
      kind: "checkpoint" as const,
      title: "Checkpoint",
      instructions: "",
      retry_policy: "manual" as const,
      config: {},
    }));
    expect(workflowStepsSchema.safeParse(many).success).toBe(false);
  });

  it("rejects an empty workflow name", () => {
    expect(workflowInputSchema.safeParse({ ...baseWorkflow, name: "" }).success).toBe(false);
  });
});

describe("exact content approvals", () => {
  const content = "This week: shipped the import fix.";
  const action = {
    connector: "demo_notes",
    destination: "Weekly updates (demo)",
    content,
    content_hash: contentHash(content),
  };

  const approval = {
    connector: action.connector,
    destination: action.destination,
    approved_content: content,
    approved_hash: action.content_hash,
    consumed_at: null as string | null,
  };

  it("accepts an approval for exactly this action", () => {
    expect(approvalCoversAction(approval, action)).toBe(true);
  });

  it("refuses different content, destination or connector", () => {
    expect(approvalCoversAction({ ...approval, approved_content: `${content} ` }, action)).toBe(
      false,
    );
    expect(
      approvalCoversAction({ ...approval, destination: "Someone else (demo)" }, action),
    ).toBe(false);
    expect(approvalCoversAction({ ...approval, connector: "other" }, action)).toBe(false);
  });

  it("refuses a hash that does not match the content", () => {
    expect(approvalCoversAction({ ...approval, approved_hash: "deadbeefdeadbeef" }, action)).toBe(
      false,
    );
  });

  it("refuses a consumed or missing approval", () => {
    expect(
      approvalCoversAction({ ...approval, consumed_at: new Date().toISOString() }, action),
    ).toBe(false);
    expect(approvalCoversAction(null, action)).toBe(false);
  });

  it("only approves pending actions and only executes approved ones", () => {
    expect(canApproveAction("pending_approval")).toBe(true);
    expect(canApproveAction("approved")).toBe(false);
    expect(canApproveAction("executing")).toBe(false);
    expect(canExecuteAction("approved", true)).toBe(true);
    expect(canExecuteAction("approved", false)).toBe(false);
    expect(canExecuteAction("executing", true)).toBe(false);
  });

  it("previews connector, destination and content", () => {
    expect(approvalPreviewLines(action).map((line) => line.label)).toEqual([
      "Connector",
      "Destination",
      "Content",
    ]);
  });
});

describe("content hashes and idempotency keys", () => {
  it("hashes deterministically and notices small edits", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
    expect(contentHash("abc")).not.toBe(contentHash("abc "));
    expect(contentHash("")).toHaveLength(16);
  });

  it("keys one action per run, step, attempt and content", () => {
    const hash = contentHash("text");
    expect(actionIdempotencyKey("run-1", 3, hash)).toBe(`run-1:3:1:${hash}`);
    expect(actionIdempotencyKey("run-1", 3, hash, 2)).toBe(`run-1:3:2:${hash}`);
    expect(actionIdempotencyKey("run-2", 3, hash)).not.toBe(
      actionIdempotencyKey("run-1", 3, hash),
    );
  });
});

describe("retry policy per step", () => {
  const failed = { retry_policy: "manual" as const, status: "failed" as const };

  it("allows a manual retry when nothing reached the connector", () => {
    expect(canRetryStep(failed, [])).toBe(true);
    expect(canRetryStep(failed, [{ status: "failed" }])).toBe(true);
  });

  it("refuses a retry that could send twice", () => {
    expect(canRetryStep(failed, [{ status: "executing" }])).toBe(false);
    expect(canRetryStep(failed, [{ status: "outcome_uncertain" }])).toBe(false);
    expect(canRetryStep(failed, [{ status: "succeeded" }])).toBe(false);
  });

  it("honours a no-retry step and ignores steps that have not failed", () => {
    expect(canRetryStep({ ...failed, retry_policy: "none" }, [])).toBe(false);
    expect(canRetryStep({ ...failed, status: "succeeded" }, [])).toBe(false);
  });
});

describe("run states and progress", () => {
  it("tracks the eight documented states", () => {
    expect([...RUN_STATUSES]).toHaveLength(8);
    expect(RUN_STATUS_LABELS.not_started).toBe("Not started");
    expect(RUN_STATUS_LABELS.waiting_for_input).toBe("Waiting for input");
    expect(RUN_STATUS_LABELS.running).toBe("Running");
    expect(RUN_STATUS_LABELS.waiting_for_approval).toBe("Waiting for approval");
    expect(RUN_STATUS_LABELS.succeeded).toBe("Succeeded");
    expect(RUN_STATUS_LABELS.failed).toBe("Failed");
    expect(RUN_STATUS_LABELS.cancelled).toBe("Cancelled");
    expect(RUN_STATUS_LABELS.outcome_uncertain).toBe("Outcome uncertain");
    // Run states are a superset of step states: only a run can be not started.
    for (const status of RUN_STATUSES) {
      if (status === "not_started") continue;
      expect(STEP_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("knows which runs are finished and cancellable", () => {
    expect(isTerminalRunStatus("succeeded")).toBe(true);
    expect(isTerminalRunStatus("outcome_uncertain")).toBe(true);
    expect(isTerminalRunStatus("waiting_for_input")).toBe(false);
    expect(canCancelRun("waiting_for_approval")).toBe(true);
    expect(canCancelRun("cancelled")).toBe(false);
  });

  it("maps each step kind to the state it waits in", () => {
    expect(runStatusForStepKind("user_input")).toBe("waiting_for_input");
    expect(runStatusForStepKind("checkpoint")).toBe("waiting_for_input");
    expect(runStatusForStepKind("ai_draft")).toBe("running");
    expect(runStatusForStepKind("user_review")).toBe("waiting_for_approval");
    expect(runStatusForStepKind("connector_action")).toBe("waiting_for_approval");
    expect(stepStatusForStepKind("user_input")).toBe("waiting_for_input");
  });

  it("counts completed steps and what the run waits for", () => {
    const steps = [
      { kind: "user_input" as const, status: "succeeded" as const, position: 1 },
      { kind: "ai_draft" as const, status: "succeeded" as const, position: 2 },
      { kind: "user_review" as const, status: "waiting_for_approval" as const, position: 3 },
      { kind: "checkpoint" as const, status: "pending" as const, position: 4 },
    ];
    const progress = runProgress(steps);
    expect(progress).toEqual({ total: 4, done: 2, percent: 50, waitingFor: "user_review" });
    expect(runProgress([])).toEqual({ total: 0, done: 0, percent: 0, waitingFor: null });
  });

  it("keeps outputs from earlier steps after a later failure", () => {
    const outputs = preservedOutputs([
      { position: 2, title: "Draft", kind: "ai_draft", output: { text: "Draft text" } },
      { position: 1, title: "Input", kind: "user_input", output: { notes: "Notes" } },
      { position: 3, title: "Save", kind: "connector_action", output: null },
    ]);
    expect(outputs.map((output) => output.position)).toEqual([1, 2]);
  });
});

describe("reusing templates", () => {
  const templateSteps = [
    { title: "Draft the outline", estimated_minutes: 20, example_deliverable: null },
    { title: "Write the sections", estimated_minutes: 40, example_deliverable: null },
  ];

  it("builds the standard workflow around template steps", () => {
    const steps = stepsFromTemplate(templateSteps);
    expect(steps[0].kind).toBe("user_input");
    expect(steps[1].kind).toBe("ai_draft");
    expect(steps[2].kind).toBe("user_review");
    expect(steps.slice(3).every((step) => step.kind === "checkpoint")).toBe(true);
    expect(steps[3].title).toBe("Draft the outline");
    expect(steps).toHaveLength(5);
    expect(workflowInputSchema.safeParse({ ...baseWorkflow, steps }).success).toBe(true);
  });

  it("never exceeds the step limit", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      title: `Step ${index + 1}`,
      estimated_minutes: 10,
      example_deliverable: null,
    }));
    const steps = stepsFromTemplate(many);
    expect(steps.length).toBeLessThanOrEqual(WORKFLOW_MAX_STEPS);
    expect(workflowStepsSchema.safeParse(steps).success).toBe(true);
  });
});

describe("draft prompts", () => {
  const messages = buildDraftMessages({
    goalTitle: "Ship the beta",
    instructions: "Summarise only the selected work.",
    notes: "Mention the import fix.",
    selectedWork: "- Fix import\n  Saved work: Handled empty rows.",
    taskTitles: ["Fix import"],
  });

  it("forbids invented facts and external actions", () => {
    const system = messages[0];
    expect(system.role).toBe("system");
    expect(system.content).toMatch(/never invent facts/i);
    expect(system.content).toMatch(/never claim an external action/i);
  });

  it("includes the goal, selected work and notes", () => {
    const user = messages[1].content;
    expect(user).toContain("Ship the beta");
    expect(user).toContain("Fix import");
    expect(user).toContain("Mention the import fix.");
  });
});

describe("draft handling", () => {
  it("strips markup and code fences from model output", () => {
    const cleaned = normalizeDraft("# Heading\n\n**Bold** text with `<b>html</b>`.\n\n```js\ncode\n```");
    expect(cleaned).not.toContain("#");
    expect(cleaned).not.toContain("**");
    expect(cleaned).not.toContain("<b>");
    expect(cleaned).not.toContain("```");
    expect(cleaned).toContain("Bold text with");
  });

  it("caps very long drafts", () => {
    const cleaned = normalizeDraft("a".repeat(MAX_DRAFT_LENGTH + 500));
    expect(cleaned.length).toBeLessThanOrEqual(MAX_DRAFT_LENGTH + 1);
  });

  it("rejects unusable replies", () => {
    expect(isDraftUsable("")).toBe(false);
    expect(isDraftUsable("   ")).toBe(false);
    expect(isDraftUsable("12 34")).toBe(false);
    expect(isDraftUsable("A real draft.")).toBe(true);
  });
});

describe("run context and work selection", () => {
  it("reads stored context defensively", () => {
    expect(parseRunContext(null)).toEqual({});
    expect(parseRunContext([1, 2])).toEqual({});
    expect(parseRunContext({ inputs: "notes", selectedTaskIds: ["a", 2, "b"] })).toEqual({
      inputs: "notes",
      selectedTaskIds: ["a", "b"],
    });
    expect(parseRunContext({ draft: 5 })).toEqual({});
  });

  it("only allows completed tasks of the run's goal, without duplicates", () => {
    const selected = cleanSelectedTasks(
      ["a", "b", "a", "c"],
      [
        { id: "a", status: "completed" },
        { id: "b", status: "todo" },
        { id: "c", status: "completed" },
      ],
    );
    expect(selected).toEqual(["a", "c"]);
  });

  it("caps the number of selected tasks", () => {
    const candidates = Array.from({ length: MAX_SELECTED_TASKS + 5 }, (_, index) => ({
      id: `task-${index}`,
      status: "completed",
    }));
    expect(cleanSelectedTasks(candidates.map((task) => task.id), candidates)).toHaveLength(
      MAX_SELECTED_TASKS,
    );
  });
});

describe("simulated connector", () => {
  it("has exactly one, explicitly simulated connector", () => {
    expect(CONNECTORS).toHaveLength(1);
    expect(getConnector("demo_notes")?.simulated).toBe(true);
    expect(hasRealConnector()).toBe(false);
    expect(NO_REAL_CONNECTOR_NOTE).toMatch(/simulated/i);
    expect(getConnector("gmail")).toBeNull();
    expect(executorFor("gmail")).toBeNull();
  });

  it("records the approved content without leaving the app", async () => {
    const result = await demoConnector.execute({
      connector: "demo_notes",
      destination: "Weekly updates (demo)",
      content: "Approved text",
      idempotencyKey: "run-1:4:1:abc123abc123",
    });
    expect(result.status).toBe("succeeded");
    expect(result.externalRef).toMatch(/^demo-/);
    expect(result.message).toMatch(/no external service/i);
  });

  it("does nothing with empty content", async () => {
    const result = await demoConnector.execute({
      connector: "demo_notes",
      destination: "Weekly updates (demo)",
      content: "   ",
      idempotencyKey: "run-1:4:1:empty00000000",
    });
    expect(result.status).toBe("failed");
    expect(result.externalRef).toBeUndefined();
  });
});

describe("messages and descriptions", () => {
  it("explains each failure code", () => {
    expect(workflowErrorMessage("approval-mismatch")).toMatch(/doesn't match/i);
    expect(workflowErrorMessage("already-executing")).toMatch(/not started twice/i);
    expect(workflowErrorMessage("retry-blocked")).toMatch(/send it twice/i);
    expect(workflowErrorMessage("no-connector")).toMatch(/no action was attempted/i);
    expect(workflowErrorMessage("unknown-code")).toMatch(/nothing was sent/i);
  });

  it("describes steps, including the action destination", () => {
    expect(
      describeStep({
        kind: "connector_action",
        title: "Save the update",
        config: { destination: "Weekly updates (demo)" },
      }),
    ).toContain("Weekly updates (demo)");
    expect(describeStep({ kind: "checkpoint", title: "Done" })).toContain("Completion checkpoint");
  });

  it("formats timestamps and ignores invalid ones", () => {
    expect(formatWorkflowTime("2026-03-14T10:00:00Z")).toContain("Mar 14");
    expect(formatWorkflowTime("not a date")).toBe("");
  });
});
