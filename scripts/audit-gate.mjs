#!/usr/bin/env node
/**
 * Dependency audit gate.
 *
 * `npm audit --audit-level=high` fails on any high advisory anywhere in the
 * tree, including dev-only tools that never ship and that have no fixed release
 * above them. That gate could only ever be satisfied by downgrading the test and
 * lint stack, so it stopped protecting anything and started blocking every
 * merge. This script replaces it with two rules that can both be met honestly:
 *
 *   1. The production tree (what actually ships) must have no high or critical
 *      advisory. There is no allowance here, ever.
 *   2. A dev-only advisory at high or critical must be listed below with a
 *      reason and an expiry date. A new one fails the build, and an expired
 *      entry fails the build until someone re-reviews it.
 *
 * Exit codes: 0 clean (or only allowed dev advisories), 1 a rule failed,
 * 2 the audit could not be read (never treated as a pass).
 */

import { spawnSync } from "node:child_process";

const THRESHOLD = new Set(["high", "critical"]);

/**
 * Dev-only advisories that no available release fixes. Each entry must name the
 * advisory, say why it cannot affect production, and carry a review date.
 * Remove an entry as soon as an upgrade makes it unnecessary — a stale entry is
 * reported, and an expired one fails.
 */
const DEV_ALLOWANCES = [
  {
    id: "GHSA-fc5q-39xc-vjpf",
    expires: "2027-02-01",
    reason:
      "picomatch ReDoS through single-branch repeated extglobs. Every path is dev tooling: " +
      "eslint-config-next -> fast-glob -> micromatch, and vitest -> vite -> tinyglobby/fdir. " +
      "The patterns handed to it are our own lint and test globs, never user input, and the " +
      "package is absent from the production tree. picomatch 4.0.7 is the newest release, so " +
      "there is nothing to upgrade to; npm's suggested fix is a downgrade of eslint-config-next " +
      "and vitest, which is not an improvement.",
  },
];

function audit(args) {
  const result = spawnSync("npm", ["audit", "--json", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    console.error(`Could not run npm audit: ${result.error.message}`);
    process.exit(2);
  }

  const text = (result.stdout || "").trim();
  if (!text) {
    console.error("npm audit produced no JSON output.");
    if (result.stderr) console.error(result.stderr.trim().slice(0, 2000));
    process.exit(2);
  }

  try {
    return JSON.parse(text);
  } catch {
    console.error("npm audit output was not JSON.");
    console.error(text.slice(0, 2000));
    process.exit(2);
  }
}

/** Distinct advisories (GHSA ids), with the packages that pull them in. */
function collect(report) {
  const advisories = new Map();

  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || !via) continue;

      const id = String(via.url ?? "").split("/").pop();
      if (!id) continue;

      const found = advisories.get(id) ?? {
        id,
        title: via.title ?? "(no title)",
        severity: via.severity ?? entry.severity ?? "unknown",
        packages: new Set(),
      };
      found.packages.add(name);
      advisories.set(id, found);
    }
  }

  return advisories;
}

function gated(advisories) {
  return [...advisories.values()].filter((advisory) => THRESHOLD.has(advisory.severity));
}

function describe(advisory) {
  return `${advisory.id} (${advisory.severity}) ${advisory.title} — ${[...advisory.packages].sort().join(", ")}`;
}

function main() {
  const full = collect(audit([]));
  const production = collect(audit(["--omit=dev"]));

  const today = new Date().toISOString().slice(0, 10);
  const allowedIds = new Set(DEV_ALLOWANCES.map((entry) => entry.id));
  const failures = [];

  const shipped = gated(production);
  console.log(
    `Production dependencies: ${shipped.length === 0 ? "no high or critical advisory" : `${shipped.length} high or critical`}.`,
  );
  for (const advisory of shipped) failures.push(`production: ${describe(advisory)}`);

  const dev = gated(full).filter((advisory) => !production.has(advisory.id));
  const unexpected = dev.filter((advisory) => !allowedIds.has(advisory.id));
  const allowed = dev.filter((advisory) => allowedIds.has(advisory.id));

  console.log(
    `Dev-only dependencies: ${dev.length} high or critical, ${allowed.length} allowed with a review date.`,
  );
  for (const advisory of allowed) console.log(`  allowed: ${describe(advisory)}`);
  for (const advisory of unexpected) {
    failures.push(
      `dev-only advisory not on the allowance list: ${describe(advisory)}\n` +
        "      Fix it by upgrading, or add a dated entry to DEV_ALLOWANCES in scripts/audit-gate.mjs with a reason.",
    );
  }

  for (const entry of DEV_ALLOWANCES) {
    if (entry.expires < today) {
      failures.push(
        `allowance ${entry.id} expired on ${entry.expires}. Re-check for a fixed release, then renew or remove the entry.`,
      );
    }
    if (!full.has(entry.id)) {
      console.log(
        `  note: ${entry.id} is no longer reported; remove its entry from scripts/audit-gate.mjs.`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("\nDependency audit gate failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("\nDependency audit gate passed.");
}

main();
