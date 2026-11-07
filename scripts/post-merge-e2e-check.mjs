#!/usr/bin/env node
/**
 * Wait for the post-merge Authenticated E2E run.
 *
 * Finds the push-triggered `e2e.yml` run on `main` for the merged commit and
 * polls it until it succeeds, fails, or the timeout expires. A failed or
 * missing run exits non-zero, so a release cannot be recorded until the merged
 * revision is green. If the commit is not available locally, fetch `origin/main`
 * once and retry before failing. On success, print a copyable release-record
 * block with the merge revision and run URL already filled in.
 *
 * Usage:
 *   npm run check:e2e:post-merge
 *   npm run check:e2e:post-merge -- --commit <merge-sha>
 *   npm run check:e2e:post-merge -- --timeout-seconds 1800 --poll-seconds 10
 *
 * The script uses the authenticated `gh` CLI. Set GH_TOKEN or GITHUB_TOKEN when
 * gh is not already signed in. It never prints environment values.
 *
 * If the requested commit is not available locally, the check fetches
 * `origin/main` once before reporting that it cannot resolve the commit.
 */

import { execFileSync, spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_SECONDS = 30 * 60;
const DEFAULT_POLL_SECONDS = 10;
const BRANCH = "main";
const WORKFLOW = "e2e.yml";
const ACTIONS_URL = "https://github.com";

function usage() {
  console.log(`Usage: npm run check:e2e:post-merge -- [options]

Wait for the push-triggered Authenticated E2E run on ${BRANCH} for a commit.

Options:
  --commit <sha>           Commit to check; defaults to HEAD.
  --timeout-seconds <n>    Give up after n seconds; default ${DEFAULT_TIMEOUT_SECONDS}.
  --poll-seconds <n>       Poll every n seconds; default ${DEFAULT_POLL_SECONDS}.
  -h, --help               Show this help.

Exit status:
  0  the run completed successfully and printed the release-record block
  1  the run failed, was cancelled, was missing, or timed out
`);
}

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${name} needs a value.`);
  return value;
}

function positiveNumber(name, value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return number;
}

function parseOptions(argv) {
  const options = {
    commit: "",
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    pollSeconds: DEFAULT_POLL_SECONDS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--") continue;

    if (argument === "--commit") {
      options.commit = takeValue(argv, i, argument);
      i += 1;
      continue;
    }
    if (argument.startsWith("--commit=")) {
      options.commit = argument.slice("--commit=".length);
      continue;
    }
    if (argument === "--timeout-seconds") {
      options.timeoutSeconds = positiveNumber(
        argument,
        takeValue(argv, i, argument),
        DEFAULT_TIMEOUT_SECONDS,
      );
      i += 1;
      continue;
    }
    if (argument.startsWith("--timeout-seconds=")) {
      options.timeoutSeconds = positiveNumber(
        argument,
        argument.slice("--timeout-seconds=".length),
        DEFAULT_TIMEOUT_SECONDS,
      );
      continue;
    }
    if (argument === "--poll-seconds") {
      options.pollSeconds = positiveNumber(
        argument,
        takeValue(argv, i, argument),
        DEFAULT_POLL_SECONDS,
      );
      i += 1;
      continue;
    }
    if (argument.startsWith("--poll-seconds=")) {
      options.pollSeconds = positiveNumber(
        argument,
        argument.slice("--poll-seconds=".length),
        DEFAULT_POLL_SECONDS,
      );
      continue;
    }
    if (!argument.startsWith("-") && !options.commit) {
      options.commit = argument;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function repository() {
  const configured = process.env.GITHUB_REPOSITORY?.trim();
  if (configured) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(configured)) {
      throw new Error("GITHUB_REPOSITORY must be owner/repo.");
    }
    return configured;
  }

  let remote;
  try {
    remote = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error("No GitHub origin remote found. Set GITHUB_REPOSITORY=owner/repo.");
  }

  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  if (!match) {
    throw new Error("The origin remote is not a GitHub repository. Set GITHUB_REPOSITORY=owner/repo.");
  }
  return `${match[1]}/${match[2]}`;
}

function revParse(target) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", `${target}^{commit}`], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function fetchOriginMain() {
  const result = spawnSync("git", ["fetch", "--quiet", "origin", "main"], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

  if (result.error) {
    throw new Error(`Cannot fetch origin/main: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `Cannot fetch origin/main${result.status ? ` (${result.status})` : ""}.${detail ? ` ${detail}` : ""}`,
    );
  }
}

function resolveCommit(input) {
  const target = input || "HEAD";
  const local = revParse(target);
  if (local) return local;

  console.log(`Commit ${target} is not available locally; fetching origin/main...`);
  fetchOriginMain();

  const fetched = revParse(target);
  if (fetched) return fetched;

  throw new Error(
    `Cannot resolve ${target} after fetching origin/main. Fetch the branch containing it or pass its full SHA with --commit.`,
  );
}

function ghJson(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    timeout: 30_000,
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error("The GitHub CLI (gh) is not installed. Install it and run gh auth login.");
    }
    throw new Error(`gh could not be started: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `gh run list failed${result.status ? ` (${result.status})` : ""}.${detail ? ` ${detail}` : ""}`,
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("gh returned unreadable JSON.");
  }
}

function findRun(repo, commit) {
  const runs = ghJson([
    "run",
    "list",
    "--repo",
    repo,
    "--workflow",
    WORKFLOW,
    "--branch",
    BRANCH,
    "--event",
    "push",
    "--commit",
    commit,
    "--limit",
    "1",
    "--json",
    "databaseId,headSha,status,conclusion,url",
  ]);

  if (!Array.isArray(runs)) throw new Error("gh returned an unexpected run list.");
  return runs[0] ?? null;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function noRunMessage(repo, commit) {
  return `No push-triggered Authenticated E2E run found for ${commit.slice(0, 12)} on ${BRANCH}. Check ${ACTIONS_URL}/${repo}/actions/workflows/${WORKFLOW}.`;
}

function releaseRecordBlock(commit, run) {
  const fields = [
    ["Release date (UTC)", `\`${new Date().toISOString()}\``],
    ["Pre-merge source revision (`npm run release:check`)", "`________`"],
    ["PR", "`________`"],
    ["Merge revision on `main`", `\`${commit}\``],
    ["Post-merge E2E run URL", run.url || "`________`"],
    ["Post-merge E2E result", "`success`"],
    ["Production deployment ID", "`________`"],
    ["Production `/api/health` revision", "`________`"],
    ["Manual smoke checks", "`________`"],
    ["Rollback / backup reference (if applicable)", "`________`"],
    ["Approved by / UTC", "`________`"],
  ];

  return [
    "Release record (copy into the release issue or operations log):",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...fields.map(([field, value]) => `| ${field} | ${value} |`),
  ].join("\n");
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const repo = repository();
  const commit = resolveCommit(options.commit);
  const short = commit.slice(0, 12);
  const timeoutMs = options.timeoutSeconds * 1000;
  const pollMs = options.pollSeconds * 1000;
  const deadline = Date.now() + timeoutMs;

  console.log(`Waiting for Authenticated E2E (push) on ${BRANCH} for ${short}...`);

  let lastState = "";
  let lastNoRunNotice = 0;

  for (;;) {
    const run = findRun(repo, commit);
    const now = Date.now();

    if (!run) {
      const state = "missing";
      if (state !== lastState || now - lastNoRunNotice >= 60_000) {
        console.log(noRunMessage(repo, commit));
        lastNoRunNotice = now;
      }
      lastState = state;
    } else {
      if (run.headSha && run.headSha !== commit) {
        throw new Error(`gh returned a run for ${run.headSha}, not ${commit}.`);
      }

      const status = String(run.status ?? "unknown");
      const conclusion = String(run.conclusion ?? "");
      const state = `${status}/${conclusion}`;

      if (state !== lastState) {
        console.log(
          `Run ${run.databaseId}: ${status}${conclusion ? ` (${conclusion})` : ""}`,
        );
        if (run.url) {
          console.log(`Run: ${run.url}`);
        }
        lastState = state;
      }

      if (status === "completed") {
        if (conclusion === "success") {
          console.log(`Post-merge Authenticated E2E passed for ${short}.`);
          if (run.url) {
            console.log(`Run: ${run.url}`);
          }
          console.log("");
          console.log(releaseRecordBlock(commit, run));
          return;
        }

        throw new Error(
          `Post-merge Authenticated E2E ${conclusion || "completed without success"} for ${short}.${run.url ? ` Run: ${run.url}` : ""}`,
        );
      }
    }

    if (now >= deadline) {
      if (run) {
        throw new Error(
          `Timed out after ${options.timeoutSeconds}s waiting for ${short}; last status was ${run.status}.${run.url ? ` Run: ${run.url}` : ""}`,
        );
      }
      throw new Error(
        `Timed out after ${options.timeoutSeconds}s. ${noRunMessage(repo, commit)}`,
      );
    }

    await sleep(pollMs);
  }
}

main().catch((error) => {
  console.error(`Post-merge E2E check failed: ${error.message}`);
  process.exitCode = 1;
});
