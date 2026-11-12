import { describe, expect, it } from "vitest";
import { TEAM_ROLES } from "@/lib/agent-team";
import {
  RESEARCH_FUNCTION_ROLES,
  RESEARCH_SPECIALIST_FUNCTIONS,
  buildResearchBrief,
  independenceProblems,
  proposeExperiment,
  syntheticResearchMission,
  validateResearchContract,
  type ResearchContractInput,
  type ResearchFinding,
  type ResearchHypothesis,
  type ResearchMission,
  type ResearchSource,
} from "@/lib/research-missions";

const contract = syntheticResearchMission().contract;

function withContract(patch: Partial<ResearchContractInput>): ResearchContractInput {
  return { ...contract, ...patch };
}

function fields(problems: { field: string }[]): string[] {
  return problems.map((problem) => problem.field);
}

const mission: ResearchMission = {
  id: "m1",
  workspace_id: "w1",
  created_by: "u1",
  orchestration_id: null,
  question: contract.question,
  scope: contract.scope,
  existing_evidence: contract.existing_evidence,
  required_source_tier: contract.required_source_tier,
  allowed_tools: contract.allowed_tools,
  deliverables: contract.deliverables,
  task_budget: contract.task_budget,
  agent_budget: contract.agent_budget,
  retry_budget: contract.retry_budget,
  spend_ceiling_cents: contract.spend_ceiling_cents,
  time_ceiling_minutes: contract.time_ceiling_minutes,
  stop_conditions: contract.stop_conditions,
  checkpoints: contract.checkpoints,
  status: "ready",
  proposed_experiment_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const hypothesis = (id: string, role: "leading" | "competing"): ResearchHypothesis => ({
  id,
  mission_id: "m1",
  statement: id === "h1" ? "Narrow viewports cause abandonment." : "Field count causes abandonment.",
  role,
  status: "open",
  created_at: "2026-01-01T00:00:00.000Z",
});

const source = (patch: Partial<ResearchSource>): ResearchSource => ({
  id: Math.random().toString(36).slice(2),
  mission_id: "m1",
  hypothesis_id: null,
  stance: "supports",
  statement_kind: "observation",
  source_tier: "primary",
  source_kind: "dataset",
  title: "Synthetic source",
  locator: "Synthetic export row 1",
  excerpt: "Completion fell as the required field count rose.",
  verified: true,
  created_at: "2026-01-01T00:00:00.000Z",
  ...patch,
});

const finding = (patch: Partial<ResearchFinding>): ResearchFinding => ({
  id: Math.random().toString(36).slice(2),
  mission_id: "m1",
  hypothesis_id: null,
  claim: "Completion tracked the required field count.",
  label: "observation",
  author_role: "investigator",
  verifier_role: "evidence_verifier",
  status: "supported",
  verified_at: "2026-01-02T00:00:00.000Z",
  created_at: "2026-01-02T00:00:00.000Z",
  ...patch,
});

describe("research contract", () => {
  it("accepts a bounded contract with a competing hypothesis", () => {
    expect(validateResearchContract(contract)).toEqual([]);
  });

  it("requires a competing explanation, not just the leading one", () => {
    const problems = validateResearchContract(
      withContract({ hypotheses: ["Only one explanation is recorded here."] }),
    );
    expect(fields(problems)).toContain("hypotheses");
    expect(problems[0].message).toContain("competing");
  });

  it("never allows outreach or publishing tools", () => {
    const outreach = validateResearchContract(
      withContract({ allowed_tools: ["read_web_page", "send_email"] }),
    );
    expect(outreach.map((problem) => problem.message).join(" ")).toContain("send_email");

    const unknown = validateResearchContract(withContract({ allowed_tools: ["run_shell"] }));
    expect(unknown.map((problem) => problem.message).join(" ")).toContain("run_shell");
  });

  it("bounds tasks, agents, retries, spending and time", () => {
    const problems = validateResearchContract(
      withContract({
        task_budget: 99,
        agent_budget: 99,
        retry_budget: 9,
        spend_ceiling_cents: 999999,
        time_ceiling_minutes: 999999,
      }),
    );
    const set = fields(problems);
    expect(set).toContain("task_budget");
    expect(set).toContain("agent_budget");
    expect(set).toContain("retry_budget");
    expect(set).toContain("spend_ceiling_cents");
    expect(set).toContain("time_ceiling_minutes");
  });

  it("requires a human review checkpoint", () => {
    const problems = validateResearchContract(withContract({ checkpoints: [] }));
    expect(fields(problems)).toContain("checkpoints");
  });
});

describe("specialist functions", () => {
  it("reuses the existing team roles and does not invent new ones", () => {
    for (const fn of RESEARCH_SPECIALIST_FUNCTIONS) {
      expect(TEAM_ROLES).toContain(RESEARCH_FUNCTION_ROLES[fn]);
    }
  });

  it("refuses an evidence verifier that is the same agent as the investigator", () => {
    const problems = independenceProblems({
      investigator: "qa",
      evidence_verifier: "qa",
    });
    expect(problems.join(" ")).toContain("independent verification");
  });

  it("allows genuinely separate agents", () => {
    expect(
      independenceProblems({ investigator: "data", evidence_verifier: "qa" }),
    ).toEqual([]);
  });
});

describe("research brief", () => {
  const hypotheses = [hypothesis("h1", "leading"), hypothesis("h2", "competing")];

  it("surfaces contradictory evidence instead of smoothing it over", () => {
    const sources = [
      source({ hypothesis_id: "h1", stance: "supports" }),
      source({ hypothesis_id: "h1", stance: "contradicts", source_tier: "reputable_secondary" }),
      source({ hypothesis_id: "h2", stance: "supports" }),
    ];
    const brief = buildResearchBrief({
      mission,
      hypotheses,
      sources,
      findings: [finding({ hypothesis_id: "h2", status: "supported" })],
    });

    expect(brief.counts.contradicting).toBe(1);
    expect(brief.alternatives.find((entry) => entry.id === "h1")?.state).toBe("contradicted");
    expect(brief.unresolvedQuestions.join(" ")).toContain("Evidence conflicts");
  });

  it("keeps a proposal out of the findings and never calls it a discovery", () => {
    const sources = [source({})];
    const brief = buildResearchBrief({
      mission,
      hypotheses,
      sources,
      findings: [
        finding({ label: "proposal", verifier_role: null, status: "pending" }),
        finding({ label: "proposal", verifier_role: null, status: "supported" }),
      ],
    });

    expect(brief.findings).toHaveLength(0);
    expect(brief.proposals).toHaveLength(2);
    expect(brief.proposals[1].status).toBe("pending");
    expect(brief.proposals[1].downgraded).toContain("proposal is not evidence");
  });

  it("downgrades a discovery that nobody independent verified", () => {
    const brief = buildResearchBrief({
      mission,
      hypotheses,
      sources: [source({})],
      findings: [
        finding({ label: "discovery", verifier_role: "investigator", status: "supported" }),
      ],
    });

    expect(brief.findings[0].status).toBe("unsupported");
    expect(brief.findings[0].downgraded).toContain("no independent verifier");
    expect(brief.counts.discoveries).toBe(0);
  });

  it("downgrades a discovery contradicted by a verified source", () => {
    const brief = buildResearchBrief({
      mission,
      hypotheses,
      sources: [source({}), source({ stance: "contradicts", source_tier: "reputable_secondary" })],
      findings: [finding({ label: "discovery", status: "supported" })],
    });

    expect(brief.findings[0].status).toBe("unsupported");
    expect(brief.findings[0].downgraded).toContain("contradicts");
  });

  it("accepts a discovery only with an independent verifier and clean support", () => {
    const brief = buildResearchBrief({
      mission,
      hypotheses,
      sources: [source({})],
      findings: [
        finding({
          label: "discovery",
          author_role: "investigator",
          verifier_role: "evidence_verifier",
          status: "supported",
        }),
      ],
    });

    expect(brief.findings[0].status).toBe("supported");
    expect(brief.counts.discoveries).toBe(1);
    expect(brief.findings[0].downgraded).toBeNull();
  });

  it("reports unverified and weak sources as limitations", () => {
    const brief = buildResearchBrief({
      mission: { ...mission, required_source_tier: "primary" },
      hypotheses,
      sources: [
        source({ verified: false }),
        source({ source_tier: "unverified", verified: true }),
      ],
      findings: [finding({ status: "pending", verifier_role: null })],
    });

    const text = brief.limitations.join(" ");
    expect(text).toContain("have not been re-checked");
    expect(text).toContain("below the required quality");
    expect(brief.unresolvedQuestions.join(" ")).toContain("No source has been verified");
  });

  it("proposes one bounded next experiment inside the mission's ceiling", () => {
    const proposal = proposeExperiment({
      mission: { ...mission, time_ceiling_minutes: 45 },
      briefFindings: [],
      alternatives: [
        {
          id: "h1",
          statement: "Narrow viewports cause abandonment.",
          role: "leading" as const,
          supporting: 0,
          contradicting: 0,
          state: "no-evidence" as const,
        },
      ],
      sources: [],
    });

    expect(proposal).not.toBeNull();
    expect(proposal?.time_limit_minutes).toBe(45);
    expect(proposal?.success_criteria.length).toBeGreaterThan(8);
  });

  it("does not propose an experiment before there is anything to test", () => {
    expect(
      proposeExperiment({
        mission,
        briefFindings: [],
        alternatives: [],
        sources: [],
      }),
    ).toBeNull();
  });

  it("carries the synthetic case's unsupported conclusion for the database to refuse", () => {
    const synthetic = syntheticResearchMission();
    expect(synthetic.sources.some((entry) => entry.stance === "contradicts")).toBe(true);
    expect(synthetic.unsupportedAttempt.verifier_role).toBe(
      synthetic.unsupportedAttempt.author_role,
    );
    expect(synthetic.unsupportedAttempt.label).toBe("discovery");
  });
});
