#!/usr/bin/env node
/**
 * Wait for the post-merge Authenticated E2E run.
 *
 * Finds the push-triggered `e2e.yml` run on `main` for the merged commit and
 * polls it until it succeeds, fails, or the timeout expires. A failed or
 * missing run exits non-zero, so a release cannot be recorded until the merged
 * revision is green. If the commit is not available locally, fetch `origin/main`
 * once and retry before failing. The push run includes the production-owner-copy
 * job on `main`, so a green run covers both the merged source and the deployed
 * origin. On success, create or update the GitHub release record issue for the
 * merge commit, then print the same table. Use --no-post to only print it.
 *
 * Usage:
 *   npm run check:e2e:post-merge
 *   npm run check:e2e:post-merge -- --commit <merge-sha>
 *   npm run check:e2e:post-merge -- --timeout-seconds 1800 --poll-seconds 10
 *   npm run check:e2e:post-merge -- --no-post
 *
 * The script uses the authenticated `gh` CLI. Set GH_TOKEN or GITHUB_TOKEN when
 * gh is not already signed in. Posting the release record needs issue write
 * access; use --no-post when only the local block is wanted. It never prints
 * environment values.
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
  --no-post                Print the release record but do not post it to GitHub.
  -h, --help               Show this help.

Exit status:
  0  the run passed and its release record was posted, or --no-post was used
  1  the run failed, was cancelled, was missing, timed out, or could not be recorded
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
    postReleaseRecord: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--no-post") {
      options.postReleaseRecord = false;
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

function runGh(args, label) {
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
      `${label} failed${result.status ? ` (${result.status})` : ""}.${detail ? ` ${detail}` : ""}`,
    );
  }

  return result.stdout.trim();
}

function ghJson(args, label) {
  const stdout = runGh(args, label);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${label} returned unreadable JSON.`);
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
  ], "gh run list");

  if (!Array.isArray(runs)) throw new Error("gh returned an unexpected run list.");
  return runs[0] ?? null;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function noRunMessage(repo, commit) {
  return `No push-triggered Authenticated E2E run found for ${commit.slice(0, 12)} on ${BRANCH}. Check ${ACTIONS_URL}/${repo}/actions/workflows/${WORKFLOW}.`;
}

function releaseRecordFields(commit, run, releaseDate) {
  return [
    ["Release date (UTC)", `\`${releaseDate}\``],
    ["Pre-merge source revision (`npm run release:check`)", "`________`"],
    ["PR", "`________`"],
    ["Merge revision on `main`", `\`${commit}\``],
    ["Post-merge E2E run URL", run.url || "`________`"],
    ["Post-merge E2E result", "`success`"],
    ["Production owner-copy assertion", "`success`"],
    ["Production deployment ID", "`________`"],
    ["Production `/api/health` revision", "`________`"],
    ["Manual smoke checks", "`________`"],
    ["Rollback / backup reference (if applicable)", "`________`"],
    ["Approved by / UTC", "`________`"],
  ];
}

function releaseRecordTable(commit, run, releaseDate) {
  return [
    "| Field | Value |",
    "| --- | --- |",
    ...releaseRecordFields(commit, run, releaseDate).map(
      ([field, value]) => `| ${field} | ${value} |`,
    ),
  ].join("\n");
}

function releaseRecordBlock(commit, run, releaseDate) {
  return [
    "Release record:",
    "",
    releaseRecordTable(commit, run, releaseDate),
  ].join("\n");
}

function releaseRecordBody(repo, commit, run, releaseDate) {
  return [
    "A blank required field means **NO-GO**. See the release checklist in",
    `[OPERATIONS.md](https://github.com/${repo}/blob/main/OPERATIONS.md#release-checklist).`,
    "",
    "## Release record",
    "",
    releaseRecordTable(commit, run, releaseDate),
    "",
    `Generated by \`npm run check:e2e:post-merge\` after push run ${run.url || "(URL unavailable)"}.`,
    "The production owner-copy job is part of that run. Manual fields remain",
    "blank until the release owner completes them.",
  ].join("\n");
}

function releaseRecordTitle(commit, releaseDate) {
  return `Release: production verification ${releaseDate.slice(0, 10)} (${commit.slice(0, 12)})`;
}

function postReleaseRecord(repo, commit, releaseDate, run) {
  const short = commit.slice(0, 12);
  // List issues directly instead of using search: a just-created issue can take
  // seconds to enter GitHub's search index, which would create a duplicate when
  // the checker is rerun immediately.
  const issues = ghJson(
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,title,state,url",
    ],
    "gh issue list",
  );
  if (!Array.isArray(issues)) throw new Error("gh returned an unexpected release-record list.");

  const body = releaseRecordBody(repo, commit, run, releaseDate);
  const existing = issues.find(
    (issue) =>
      typeof issue?.title === "string" &&
      issue.title.startsWith("Release:") &&
      issue.title.includes(`(${short})`),
  );

  if (existing) {
    runGh(
      ["issue", "edit", String(existing.number), "--repo", repo, "--body", body],
      "gh issue edit",
    );
    console.log(`Updated release record issue #${existing.number}: ${existing.url}`);
    return existing.url;
  }

  const url = runGh(
    [
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      releaseRecordTitle(commit, releaseDate),
      "--body",
      body,
    ],
    "gh issue create",
  );
  console.log(`Opened release record issue: ${url}`);
  return url;
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
          console.log(
            `Post-merge Authenticated E2E and production owner-copy checks passed for ${short}.`,
          );
          if (run.url) {
            console.log(`Run: ${run.url}`);
          }
          const releaseDate = new Date().toISOString();
          console.log("");
          console.log(releaseRecordBlock(commit, run, releaseDate));
          if (options.postReleaseRecord) {
            postReleaseRecord(repo, commit, releaseDate, run);
          } else {
            console.log("Skipped posting the release record because --no-post was used.");
          }
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
