import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVAL_CASES, runPolicy, suiteDigest } from "@/lib/improvement-eval";
import {
  ERROR_RECOVERY_CASES,
  ERROR_RECOVERY_FAMILY,
  PERFORMANCE_FAMILIES,
  REQUEST_CLARITY_CASES,
  REQUEST_CLARITY_FAMILY,
  TOOL_SELECTION_FAMILY,
} from "@/lib/performance-families";
import {
  CLAIM_LABELS,
  CLAIM_NOTES,
  CLAIM_UNITS,
  PERFORMANCE_CLAIMS,
  ERROR_RECOVERY_FAMILY_KEY,
  ERROR_RECOVERY_FAMILY_VERSION,
  PERFORMANCE_FAMILIES_LIST,
  PERFORMANCE_FAMILY_DIGEST,
  PERFORMANCE_FAMILY_KEY,
  PERFORMANCE_FAMILY_OPTIONS,
  PERFORMANCE_FAMILY_VERSION,
  PERFORMANCE_POLICIES,
  PERFORMANCE_TASK_KEYS,
  bannedClaimPhrase,
  allFamiliesDistribution,
  familyDistribution,
  familySpec,
  formatLatency,
  formatPercent,
  programProblems,
  replacementPrefill,
  protocolFingerprint,
  REPLACEMENT_PREFILL_FIELDS,
  type PerformanceDraft,
  type RegisterPrefill,
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

  it("installs a third family that scores whether a request can be acted on", () => {
    expect(REQUEST_CLARITY_FAMILY.digest).toBe(suiteDigest(REQUEST_CLARITY_CASES));
    expect(REQUEST_CLARITY_FAMILY.taskKeys).toEqual(
      REQUEST_CLARITY_CASES.map((entry) => entry.id),
    );
    expect(REQUEST_CLARITY_FAMILY.taskKeys.some((key) => PERFORMANCE_TASK_KEYS.includes(key))).toBe(
      false,
    );
    expect(
      REQUEST_CLARITY_FAMILY.taskKeys.some((key) => ERROR_RECOVERY_FAMILY.taskKeys.includes(key)),
    ).toBe(false);

    const migration = readFileSync(
      path.join(process.cwd(), "supabase/migrations/0086_phase41_third_task_family.sql"),
      "utf8",
    );
    expect(migration).toContain(REQUEST_CLARITY_FAMILY.digest);
    expect(migration).toContain(REQUEST_CLARITY_FAMILY.version);
    expect(migration).toContain("request_clarity");
  });

  it("scores the third family's baseline below its candidate", () => {
    const baseline = runPolicy(REQUEST_CLARITY_CASES, REQUEST_CLARITY_FAMILY.baseline.policy);
    const candidate = runPolicy(REQUEST_CLARITY_CASES, REQUEST_CLARITY_FAMILY.candidates[0].policy);

    expect(baseline.passed).toBe(6);
    expect(candidate.passed).toBe(12);
  });

  it("installs a second, genuinely different family with its own pinned digest", () => {
    expect(ERROR_RECOVERY_FAMILY.key).toBe(ERROR_RECOVERY_FAMILY_KEY);
    expect(ERROR_RECOVERY_FAMILY.version).toBe(ERROR_RECOVERY_FAMILY_VERSION);
    expect(ERROR_RECOVERY_FAMILY.digest).toBe(suiteDigest(ERROR_RECOVERY_CASES));
    expect(ERROR_RECOVERY_FAMILY.digest).not.toBe(PERFORMANCE_FAMILY_DIGEST);
    expect(ERROR_RECOVERY_FAMILY.taskKeys).toEqual(ERROR_RECOVERY_CASES.map((entry) => entry.id));
    expect(ERROR_RECOVERY_FAMILY.taskKeys.some((key) => PERFORMANCE_TASK_KEYS.includes(key))).toBe(
      false,
    );

    const migration = readFileSync(
      path.join(process.cwd(), "supabase/migrations/0084_phase41_second_task_family.sql"),
      "utf8",
    );
    expect(migration).toContain(ERROR_RECOVERY_FAMILY.digest);
    expect(migration).toContain(ERROR_RECOVERY_FAMILY.version);
    expect(migration).toContain("error_recovery");

    expect(PERFORMANCE_FAMILIES.map((family) => family.key)).toEqual([
      "tool_selection",
      "error_recovery",
      "request_clarity",
    ]);
    expect(PERFORMANCE_FAMILIES_LIST).toHaveLength(3);
    expect(PERFORMANCE_FAMILY_OPTIONS.map((row) => row.tasks)).toEqual([12, 12, 12]);
  });

  it("distinguishes the two distributions by their own baseline", () => {
    const recoveryBaseline = runPolicy(
      ERROR_RECOVERY_CASES,
      ERROR_RECOVERY_FAMILY.baseline.policy,
    );
    const recoveryCandidate = runPolicy(
      ERROR_RECOVERY_CASES,
      ERROR_RECOVERY_FAMILY.candidates[0].policy,
    );

    // The retry-everything baseline gets the four transient retries right and
    // retries the eight failures that must be stopped or resolved instead.
    expect(recoveryBaseline.passed).toBe(4);
    expect(recoveryCandidate.passed).toBe(12);

    const toolBaseline = runPolicy(EVAL_CASES, TOOL_SELECTION_FAMILY.baseline.policy);
    const toolCandidate = runPolicy(EVAL_CASES, TOOL_SELECTION_FAMILY.candidates[0].policy);
    expect(toolCandidate.passed).toBeGreaterThan(toolBaseline.passed);
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

  it("pins the protocol to the chosen family", () => {
    const toolFingerprint = fingerprintOf();
    const recoveryFingerprint = protocolFingerprint({
      familyKey: ERROR_RECOVERY_FAMILY_KEY,
      title: draft.title,
      question: draft.question,
      inclusionRules: draft.inclusionRules,
      exclusionRules: draft.exclusionRules,
      scoringMethod: draft.scoringMethod,
      candidatePolicy: "classified-retry",
      trials: draft.trials,
      timeLimitSeconds: draft.timeLimitSeconds,
      costLimitCents: draft.costLimitCents,
      humanAssistancePolicy: draft.humanAssistancePolicy,
      failureCriteria: draft.failureCriteria,
      supportedClaim: draft.supportedClaim,
      claimText: draft.claimText,
      minimumEffect: draft.minimumEffect,
      noninferiorityMargin: draft.noninferiorityMargin,
      maxDisagreements: draft.maxDisagreements,
    });
    expect(recoveryFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(recoveryFingerprint).not.toBe(toolFingerprint);
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
    expect(Object.keys(PERFORMANCE_POLICIES).sort()).toEqual(["channel-lookup"]);
    expect(ERROR_RECOVERY_FAMILY.candidates.map((row) => row.key)).toEqual(["classified-retry"]);
    expect(PERFORMANCE_CLAIMS).not.toContain("general_capability");
  });

  it("says plainly when a measurement is missing", () => {
    expect(formatLatency(null)).toBe("not measured");
    expect(formatPercent(null)).toBe("not measured");
    expect(formatLatency(120.4)).toBe("120 ms");
    expect(formatPercent(25)).toBe("25.00%");
  });

  it("builds one combined distribution that keeps every family separate", () => {
    const combined = allFamiliesDistribution();

    expect(combined.suite).toBe("all");
    expect(combined.families.map((row) => row.key)).toEqual(
      PERFORMANCE_FAMILIES.map((row) => row.key),
    );
    expect(combined.task_keys).toEqual([
      ...TOOL_SELECTION_FAMILY.taskKeys,
      ...ERROR_RECOVERY_FAMILY.taskKeys,
      ...REQUEST_CLARITY_FAMILY.taskKeys,
    ]);
    expect(combined.tasks).toBe(36);
    expect(combined.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(combined.digest).not.toBe(PERFORMANCE_FAMILY_DIGEST);
    expect(combined.digest).not.toBe(ERROR_RECOVERY_FAMILY.digest);
    expect(combined.digest).not.toBe(REQUEST_CLARITY_FAMILY.digest);

    for (const entry of combined.families) {
      const installed = familySpec(entry.key);
      expect(installed).not.toBeNull();
      expect(entry.version).toBe(installed!.version);
      expect(entry.digest).toBe(installed!.digest);
      expect(entry.task_keys).toEqual(installed!.taskKeys);
      expect(entry.baseline_policy).toBe(installed!.baseline.key);
      expect(entry.candidate_policy).toBe(installed!.candidates[0].key);
    }

    const migration = readFileSync(
      path.join(process.cwd(), "supabase/migrations/0085_phase41_all_families.sql"),
      "utf8",
    );
    expect(migration).toContain("all_families");
    expect(migration).toContain("family_keys");
    expect(migration).toContain("'families'");
  });


  it("carries every protocol field and limit into a replacement registration", () => {
    const previous = {
      question: "question-copy",
      inclusionRules: "inclusion-copy",
      exclusionRules: "exclusion-copy",
      scoringMethod: "scoring-copy",
      humanAssistancePolicy: "assistance-copy",
      failureCriteria: "failure-copy",
      claimText: "claim-copy",
      trials: 7,
      timeLimitSeconds: 240,
      costLimitCents: 42,
      maxDisagreements: 3,
      minimumEffect: 0.35,
      noninferiorityMargin: 0.07,
    } satisfies RegisterPrefill;

    const prefill = replacementPrefill(previous);

    expect(prefill).toEqual(previous);
    expect(Object.keys(prefill).sort()).toEqual([...REPLACEMENT_PREFILL_FIELDS].sort());
    expect(Object.keys(prefill)).toHaveLength(13);
    expect(REPLACEMENT_PREFILL_FIELDS).toHaveLength(13);
  });

  it("binds every prefilled field to a named input, so a rename fails here", () => {
    const form = readFileSync(
      path.join(process.cwd(), "src/components/performance-program-forms.tsx"),
      "utf8",
    );
    const page = readFileSync(
      path.join(process.cwd(), "src/app/workspace/[workspaceId]/performance/page.tsx"),
      "utf8",
    );

    for (const field of REPLACEMENT_PREFILL_FIELDS) {
      expect(form).toContain(`"${field}"`);
    }
    expect(form).toContain("prefill?.[field.name]");
    expect(form).toContain("prefill?.trials");
    expect(page).toContain("replacementPrefill(previous.program)");
  });

  it("fingerprints the all-family scope apart from a single family", () => {
    const combined = allFamiliesDistribution();
    const fingerprint = protocolFingerprint({
      ...draft,
      scope: "all_families",
      families: combined.families,
      candidatePolicy: "per-family",
    });

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toBe(fingerprintOf());
    expect(
      programProblems({ ...draft, scope: "all_families", candidatePolicy: "per-family" }),
    ).toEqual([]);
    expect(programProblems({ ...draft, candidatePolicy: "per-family" }).join(" ")).toContain(
      "Choose the candidate policy",
    );
  });
});
