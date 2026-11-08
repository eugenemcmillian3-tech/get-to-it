/**
 * Phase 31 — shared import contract.
 *
 * Client-safe: no Node APIs and no database code. The server-side importer,
 * forms and tests all use the same limits, so the UI cannot claim a different
 * boundary from the validator.
 */

export const IMPORT_LIMITS = {
  maxArchiveBytes: 10 * 1024 * 1024,
  maxExpandedBytes: 20 * 1024 * 1024,
  maxEntries: 1_000,
  maxFiles: 60,
  maxFileChars: 60_000,
  maxTotalChars: 400_000,
  maxPathChars: 160,
  maxPathDepth: 8,
  maxMapJsonChars: 120_000,
} as const;

export const IMPORT_STACK = {
  label: "Next.js App Router + TypeScript + Tailwind CSS",
  note: "Only this builder stack is importable in this phase. Other frameworks and the pages router are reported as unsupported, not approximated.",
} as const;

export const IMPORT_OBJECTIVES = [
  {
    id: "bug",
    label: "Fix a bug",
    hint: "Describe the symptom and where it appears. The bounded review scaffold will not invent an arbitrary fix.",
  },
  {
    id: "feature",
    label: "Add a feature",
    hint: "Describe one small addition. The proposal will name the files and the review path.",
  },
  {
    id: "mobile",
    label: "Improve mobile behavior",
    hint: "Name the screen or navigation that should work better on a small viewport.",
  },
  {
    id: "dependency",
    label: "Replace a selected dependency",
    hint: "Name the dependency and target version. The pinned preview cache may block installation; the proposal will say so.",
  },
  {
    id: "test_coverage",
    label: "Improve test coverage",
    hint: "Name the behavior that needs a check. The existing sandbox command policy still applies.",
  },
] as const;

export type ImportObjective = (typeof IMPORT_OBJECTIVES)[number]["id"];

export const IMPORT_OBJECTIVE_LABELS: Record<ImportObjective, string> = {
  bug: "Fix a bug",
  feature: "Add a feature",
  mobile: "Improve mobile behavior",
  dependency: "Replace a selected dependency",
  test_coverage: "Improve test coverage",
};

export function isImportObjective(value: string): value is ImportObjective {
  return IMPORT_OBJECTIVES.some((objective) => objective.id === value);
}

export class AppImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppImportError";
  }
}
