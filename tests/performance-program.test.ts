import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVAL_CASES, suiteDigest } from "@/lib/improvement-eval";
import {
  CLAIM_LABELS,
  CLAIM_NOTES,
  CLAIM_UNITS,
  PERFORMANCE_CLAIMS,
  PERFORMANCE_FAMILY_DIGEST,
  PERFORMANCE_FAMILY_KEY,
  PERFORMANCE_FAMILY_VERSION,
  PERFORMANCE_POLICIES,
  PERFORMANCE_TASK_KEYS,
  bannedClaimPhrase,
  familyDistribution,
  formatLatency,
  formatPercent,
  programProblems,
  protocolFingerprint,
  type PerformanceDraft,
} from "@/lib/performance-program";

const draft: PerformanceDraft = {
  title: "Channel lookup against the shipped policy",
  question:
    "Does resolving a channel name before posting reach the expected tool more often than the shipped policy?",
  inclusionRules: "The twelve authored intents in the installed tool-selection family.",
  exclusionRules: "Anything outside tool selection and any paid model call.",
  scoringMethod:
    "One authored case is one trial: the chosen tool either matches the expected outcome or it does not.",
  candidatePolicy: "channel-lookup",
  trials: 3,
  timeLimitSeconds: 120,
  costLimitCents: 20,
  humanAssistancePolicy: "A person may help, and any help is recorded on the trial.",
  failureCriteria:
    "Fewer correct tool choices than the baseline, any changed refusal, or a review disagreement above the allowance.",
  supportedClaim: "benchmark",
  claimText:
    "On these twelve authored intents the candidate reaches the expected tool at least twenty percent more often than the shipped policy.",
  minimumEffect: 0.2,
  noninferiorityMargin: 0,
  maxDisagreements: 0,
};

function fingerprintOf(overrides: Partial<PerformanceDraft> = {}): string {
  const merged = { ...draft, ...overrides };
  return protocolFingerprint({
    title: merged.title,
    question: merged.question,
    inclusionRules: merged.inclusionRules,
    exclusionRules: merged.exclusionRules,
    scoringMethod: merged.scoringMethod,
    candidatePolicy: merged.candidatePolicy,
    trials: merged.trials,
    timeLimitSeconds: merged.timeLimitSeconds,
    costLimitCents: merged.costLimitCents,
    humanAssistancePolicy: merged.humanAssistancePolicy,
    failureCriteria: merged.failureCriteria,
    supportedClaim: merged.supportedClaim,
    claimText: merged.claimText,
    minimumEffect: merged.minimumEffect,
    noninferiorityMargin: merged.noninferiorityMargin,
    maxDisagreements: merged.maxDisagreements,
  });
}

describe("performance program registration", () => {
  it("installs exactly the authored task family the migration seeds", () => {
    expect(PERFORMANCE_TASK_KEYS).toEqual(EVAL_CASES.map((entry) => entry.id));
    expect(PERFORMANCE_FAMILY_DIGEST).toBe(suiteDigest());

    const migration = readFileSync(
      path.join(process.cwd(), "supabase/migrations/0083_phase41_performance_program.sql"),
      "utf8",
    );
    expect(migration).toContain(PERFORMANCE_FAMILY_DIGEST);
    expect(migration).toContain(PERFORMANCE_FAMILY_KEY);
    expect(migration).toContain(PERFORMANCE_FAMILY_VERSION);
  });

  it("builds the distribution from the installed family rather than the form", () => {
    const distribution = familyDistribution();
    expect(distribution.suite).toBe("tool_selection");
    expect(distribution.digest).toHaveLength(64);
    expect(distribution.tasks).toBe(12);
    expect(distribution.task_keys).toEqual(PERFORMANCE_TASK_KEYS);
  });

  it("accepts a complete protocol and names the missing piece", () => {
    expect(programProblems(draft)).toEqual([]);

    expect(programProblems({ ...draft, inclusionRules: "too short" }).join(" ")).toContain(
      "inclusion rules",
    );
    expect(programProblems({ ...draft, trials: 0 }).join(" ")).toContain("Trials per task");
    expect(programProblems({ ...draft, timeLimitSeconds: 5 }).join(" ")).toContain("time limit");
    expect(programProblems({ ...draft, noninferiorityMargin: 2 }).join(" ")).toContain(
      "non-inferiority",
    );
    expect(programProblems({ ...draft, supportedClaim: "general_capability" }).join(" ")).toContain(
      "which claim",
    );
    expect(programProblems({ ...draft, candidatePolicy: "made-up" }).join(" ")).toContain(
      "Choose the candidate policy",
    );
  });

  it("refuses an AGI-style claim before it can be registered", () => {
    expect(bannedClaimPhrase("This program shows we built AGI.")).toBe(true);
    expect(bannedClaimPhrase("The singularity has arrived.")).toBe(true);
    expect(bannedClaimPhrase("Artificial general intelligence is here")).toBe(true);
    expect(bannedClaimPhrase("The candidate reaches the expected tool more often.")).toBe(false);

    const problems = programProblems({
      ...draft,
      claimText: "Our evaluation shows we built AGI and should publish it now.",
    });
    expect(problems.join(" ")).toContain("never an AGI");
  });

  it("pins the protocol with a stable fingerprint", () => {
    const first = fingerprintOf();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintOf()).toBe(first);
    expect(fingerprintOf({ trials: 2 })).not.toBe(first);
    expect(fingerprintOf({ claimText: `${draft.claimText} And nothing more.` })).not.toBe(first);
    expect(fingerprintOf({ minimumEffect: 0.3 })).not.toBe(first);
  });

  it("labels the four claims distinctly, each with its own unit", () => {
    expect(PERFORMANCE_CLAIMS).toEqual(["benchmark", "faster", "lower_cost", "distribution"]);
    for (const claim of PERFORMANCE_CLAIMS) {
      expect(CLAIM_LABELS[claim].length).toBeGreaterThan(0);
      expect(CLAIM_UNITS[claim].length).toBeGreaterThan(0);
      expect(CLAIM_NOTES[claim].length).toBeGreaterThan(20);
    }
    expect(CLAIM_UNITS.benchmark).not.toBe(CLAIM_UNITS.faster);
    expect(CLAIM_UNITS.lower_cost).not.toBe(CLAIM_UNITS.benchmark);
  });

  it("only offers installed candidate policies, and no general-capability claim", () => {
    expect(Object.keys(PERFORMANCE_POLICIES).sort()).toEqual([
      "channel-lookup",
      "widened-toolset",
    ]);
    expect(PERFORMANCE_CLAIMS).not.toContain("general_capability");
  });

  it("says plainly when a measurement is missing", () => {
    expect(formatLatency(null)).toBe("not measured");
    expect(formatPercent(null)).toBe("not measured");
    expect(formatLatency(120.4)).toBe("120 ms");
    expect(formatPercent(25)).toBe("25.00%");
  });
});
