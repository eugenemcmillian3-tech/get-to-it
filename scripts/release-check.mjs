#!/usr/bin/env node
/**
 * Reproducible release checks.
 *
 * Runs typecheck, lint, unit tests, a production build, a dependency audit, a
 * secret pattern scan and the Phase 37 knowledge harness, then prints the source
 * revision the result belongs to. The harness replays every migration into its
 * own throwaway database, so a release record shows the schema rules were
 * verified rather than assumed. The restore drill stays separate
 * (`npm run test:restore`) because it is a longer drill.
 *
 * None of this is a security audit. It is a fixed list of automated checks.
 */

import { execFileSync, spawnSync } from "node:child_process";

function run(label, command, args, options = {}) {
  process.stdout.write(`\n▶ ${label}\n`);
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    console.error(`✖ ${label} failed`);
    process.exitCode = 1;
    return false;
  }
  console.log(`✔ ${label}`);
  return true;
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const revision = git(["rev-parse", "HEAD"]) || "unknown";
const short = revision === "unknown" ? "unknown" : revision.slice(0, 12);
const dirty = git(["status", "--porcelain"]) !== "";

console.log("GET TO IT — release checks");
console.log(`revision: ${short}${dirty ? " (dirty worktree)" : ""}`);
console.log("These are automated checks, not a security audit.");

const checks = [
  [
    "Schema snapshot is current",
    "node",
    ["scripts/schema-snapshot.mjs", "--check"],
  ],
  ["Restore drill", "npm", ["run", "test:restore"]],
  ["Typecheck", "npm", ["run", "typecheck"]],
  ["Lint", "npm", ["run", "lint"]],
  ["Unit tests", "npm", ["test"]],
  ["Production build", "npm", ["run", "build"]],
  ["Secret scan", "node", ["scripts/secrets-check.mjs"]],
  ["Phase 37 knowledge harness", "npm", ["run", "test:knowledge"]],
  ["Role guard audit", "npm", ["run", "check:role-guards"]],
  ["Nullable guard audit", "npm", ["run", "check:nullable-guards"]],
  ["Schema drift check", "npm", ["run", "check:schema-drift"]],
  ["Dependency audit (high)", "npm", ["audit", "--omit=dev", "--audit-level=high"]],
];

let passed = 0;
for (const [label, command, args] of checks) {
  if (run(label, command, args)) passed += 1;
}

console.log("\nManual checks that remain manual:");
console.log("  - keyboard-only pass through sign-in, a goal, a workflow and /data");
console.log("  - mobile widths at 360 px and 414 px, no horizontal scroll");
console.log("  - error recovery: stop the database, confirm the health check is 503");

// A check that ran but compared nothing is not the same as a check that passed,
// and a green release record should not imply coverage it did not have.
const notVerified = [];
const driftArmed = Boolean(
  (process.env.SCHEMA_DRIFT_DATABASE_URL ?? process.env.DATABASE_URL)
  || ((process.env.SUPABASE_MANAGEMENT_API ?? "")
    && (process.env.SCHEMA_DRIFT_PROJECT_REF ?? process.env.SUPABASE_PROJECT_REF ?? "")),
);
if (!driftArmed) {
  notVerified.push(
    "schema drift comparison: no database URL or Management API credentials are set, so nothing was compared",
  );
}
console.log(
  notVerified.length === 0
    ? "\nEvery automated check compared something."
    : `\nNot verified by this run:\n${notVerified.map((line) => `  - ${line}`).join("\n")}`,
);

console.log(
  `\n${passed}/${checks.length} automated checks passed for revision ${short}${dirty ? " (dirty)" : ""}.`,
);

process.exit(process.exitCode ?? 0);
