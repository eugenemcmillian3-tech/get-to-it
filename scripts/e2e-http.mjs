#!/usr/bin/env node
/**
 * Authenticated HTTP end-to-end crawl.
 *
 * Starts from the running app, creates a disposable confirmed account with the
 * Supabase Admin API, signs in, seeds one goal/task/app project, crawls every
 * route and API contract, and deletes the account in every exit path.
 *
 * Required environment:
 *   E2E_SERVICE_ROLE_KEY  Supabase service-role key, used only by this runner.
 *                         Pass it in the process environment; do not put it in
 *                         .env.local or any NEXT_PUBLIC_ variable.
 *
 * Optional:
 *   E2E_BASE_URL          Defaults to http://127.0.0.1:3100.
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 *                         Read from the process or .env.local.
 *
 * The test account is random per run. Its email is never printed and its
 * password is held only in memory.
 */

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const LOCAL_ENV = readLocalEnv();

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? LOCAL_ENV.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? LOCAL_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const results = [];
const failures = [];
const created = { goal: null, task: null, project: null, capability: null };

let session = null;
let testUser = null;

function readLocalEnv() {
  try {
    const text = readFileSync(".env.local", "utf8");
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2").trim();
    }
    return values;
  } catch {
    return {};
  }
}

function requireConfiguration() {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment or .env.local.",
    );
  }
  if (!SERVICE_KEY) {
    throw new Error(
      "Set E2E_SERVICE_ROLE_KEY in the process environment. It is used only to create and delete the disposable test account; never commit it or add it to .env.local.",
    );
  }
}

async function jsonRequest(url, options, label) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
  }
  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${label} failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return body;
}

async function createTestUser() {
  const email = `e2e.http.${Date.now()}.${randomBytes(4).toString("hex")}@get-to-it.test`;
  const password = `E2e-${randomBytes(24).toString("base64url")}`;
  const body = await jsonRequest(
    `${SUPABASE_URL}/auth/v1/admin/users`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    },
    "Creating the disposable test account",
  );
  if (!body?.id) throw new Error("The Admin API did not return a user id.");
  return { id: body.id, email, password };
}

async function signIn(user) {
  const body = await jsonRequest(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password: user.password }),
    },
    "Signing in the disposable test account",
  );
  if (!body?.access_token || !body?.refresh_token || !body?.user?.id) {
    throw new Error("The sign-in response did not contain a complete session.");
  }
  return body;
}

function cookieHeader(current) {
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const value = `base64-${Buffer.from(JSON.stringify(current)).toString("base64url")}`;
  return `sb-${ref}-auth-token=${value}`;
}

async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
      Prefer: "return=representation",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
  }
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

async function seed() {
  const userId = session.user.id;
  const [goal] = await rest("goals", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      title: "E2E full project test",
      desired_outcome: "Prove the full project renders and persists real rows.",
      time_available_minutes: 30,
      blocker: "No blocker for this test.",
    }),
  });
  created.goal = goal.id;

  const [task] = await rest("tasks", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      goal_id: created.goal,
      title: "Check the task workspace",
      status: "todo",
    }),
  });
  created.task = task.id;

  const [project] = await rest("app_projects", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      name: "E2E Route Check",
      purpose: "Exercise the build workspace routes end to end.",
      target_users: "The signed-in owner",
      workflows: "Create a checklist and review it.",
      required_pages: "/releases | Releases | Review releases",
      entities: "release: title, status",
      auth_requirements: "none",
      integrations: "",
      design_preferences: "Plain",
      definition_of_done: "Every build route renders without an error.",
    }),
  });
  created.project = project.id;

  // Phase 38: one evaluation with two versioned configurations, a development
  // task and a held-out task, keys seeded by the definer function, and one
  // scored run per side. The answer key is never read by this script: the
  // scoring function returns counts, so both sides can be compared on the page.
  const [evaluation] = await rest("capability_evals", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      name: "E2E capability check",
      description: "Exercise the capability evaluation detail page end to end.",
      dataset_version: "dataset-v1",
      status: "active",
    }),
  });
  created.capability = evaluation.id;

  const taskShape = {
    eval_id: created.capability,
    user_id: userId,
    dataset_version: "dataset-v1",
    permitted_tools: ["read_files"],
    runtime_seconds: 180,
    spend_limit_cents: 0,
    scoring_rubric: {
      pass: "Every required element is present and every claim is supported.",
      partial: "At least one required element is present.",
      fail: "No required element is present.",
    },
  };
  const tasks = await rest("capability_eval_tasks", {
    method: "POST",
    body: JSON.stringify([
      {
        ...taskShape,
        domain: "software_build_repair",
        difficulty: "medium",
        split: "development",
        title: "E2E reproduce, patch and verify",
        task_spec: {
          prompt: "Reproduce a failing behaviour, apply a bounded patch and verify it.",
          required_elements: 3,
          permitted_tools: ["read_files"],
        },
      },
      {
        ...taskShape,
        domain: "research_synthesis",
        difficulty: "medium",
        split: "held_out",
        title: "E2E held-out synthesis",
        task_spec: {
          prompt: "Synthesise supplied sources, cite them and state what remains uncertain.",
          required_elements: 3,
          permitted_tools: ["read_files"],
        },
      },
    ]),
  });

  const versionShape = {
    eval_id: created.capability,
    user_id: userId,
    dataset_version: "dataset-v1",
    permitted_tools: ["read_files"],
    runtime_limit_seconds: 180,
    spend_limit_cents: 0,
    autonomy_permission: "none",
    status: "active",
  };
  const versions = await rest("capability_eval_versions", {
    method: "POST",
    body: JSON.stringify([
      {
        ...versionShape,
        label: "Single-model baseline",
        version: 1,
        baseline_kind: "single_model_baseline",
        model_version: "fixture-model-v1",
        orchestration_version: "none",
        prompt_version: "prompt-v1",
        scoring_rubric: { weighted: false, weights: {} },
        human_assistance: "none",
      },
      {
        ...versionShape,
        label: "Orchestrated system",
        version: 2,
        baseline_kind: "orchestrated_system",
        model_version: "fixture-model-v1",
        orchestration_version: "orchestrator-v2",
        prompt_version: "prompt-v2",
        scoring_rubric: { weighted: true, weights: { verified_success: 1 } },
        human_assistance: "review_only",
      },
    ]),
  });

  await rest("rpc/capability_eval_seed_keys", {
    method: "POST",
    body: JSON.stringify({ p_eval_id: created.capability }),
  });

  const sides = [
    {
      kind: "single_model_baseline",
      latency: 900,
      elements: {
        software_build_repair: ["reproduce", "patch", "verify"],
        research_synthesis: ["sources"],
      },
    },
    {
      kind: "orchestrated_system",
      latency: 420,
      elements: {
        software_build_repair: ["reproduce", "patch", "verify"],
        research_synthesis: ["sources", "synthesis", "uncertainty"],
      },
    },
  ];
  const runs = [];
  for (const side of sides) {
    const version = versions.find((entry) => entry.baseline_kind === side.kind);
    for (const task of tasks) {
      const submission = {
        elements: side.elements[task.domain] ?? [],
        claims: [{ text: "The result follows from the supplied material.", supported: true }],
        permission_attempts: 0,
        recovery: { attempted: false, succeeded: false },
        cost_cents: 0,
        latency_ms: side.latency,
      };
      const scored = await rest("rpc/capability_eval_score_task", {
        method: "POST",
        body: JSON.stringify({ p_task_id: task.id, p_submission: submission }),
      });
      runs.push({
        eval_id: created.capability,
        version_id: version.id,
        task_id: task.id,
        user_id: userId,
        domain: task.domain,
        difficulty: task.difficulty,
        split: task.split,
        trial: 1,
        outcome: scored.outcome,
        verified_success: scored.verified_success,
        unsupported_claims: scored.unsupported_claims ?? 0,
        permission_violations: submission.permission_attempts,
        human_interventions: 0,
        recovery_attempts: 0,
        recovery_succeeded: null,
        cost_cents: submission.cost_cents,
        latency_ms: submission.latency_ms,
        failure_category: scored.failure_category ?? null,
        scoring_detail: scored.scoring_detail ?? {},
      });
    }
  }
  await rest("capability_eval_runs", {
    method: "POST",
    body: JSON.stringify(runs),
  });

  // A second exposure of the held-out task to the same configuration must be
  // recorded as contaminated rather than hidden.
  const baselineVersion = versions.find((entry) => entry.baseline_kind === "single_model_baseline");
  const heldOutTask = tasks.find((task) => task.split === "held_out");
  const repeat = await rest("rpc/capability_eval_score_task", {
    method: "POST",
    body: JSON.stringify({
      p_task_id: heldOutTask.id,
      p_submission: {
        elements: ["sources", "synthesis"],
        claims: [{ text: "The result follows from the supplied material.", supported: true }],
        permission_attempts: 0,
        recovery: { attempted: false, succeeded: false },
        cost_cents: 0,
        latency_ms: 950,
      },
    }),
  });
  const [repeatRun] = await rest("capability_eval_runs", {
    method: "POST",
    body: JSON.stringify([
      {
        eval_id: created.capability,
        version_id: baselineVersion.id,
        task_id: heldOutTask.id,
        user_id: userId,
        domain: heldOutTask.domain,
        difficulty: heldOutTask.difficulty,
        split: heldOutTask.split,
        trial: 2,
        outcome: repeat.outcome,
        verified_success: repeat.verified_success,
        unsupported_claims: repeat.unsupported_claims ?? 0,
        permission_violations: 0,
        human_interventions: 0,
        recovery_attempts: 0,
        recovery_succeeded: null,
        cost_cents: 0,
        latency_ms: 950,
        failure_category: repeat.failure_category ?? null,
        scoring_detail: repeat.scoring_detail ?? {},
      },
    ]),
  });
  assert(repeatRun?.contaminated === true, "a repeated held-out exposure was not flagged as contaminated");
  assert(repeatRun?.exposure_count === 2, "the second exposure was not counted");

  // The answer-key table has no client policy at all.
  await expectRefusal(
    () => rest(`capability_eval_answer_keys?eval_id=eq.${created.capability}&select=task_id&limit=1`),
    /permission denied/i,
    "the signed-in owner could read answer keys",
  );

  // A versioned configuration cannot be given more autonomy than it started with.
  await expectRefusal(
    () =>
      rest(`capability_eval_versions?id=eq.${baselineVersion.id}`, {
        method: "PATCH",
        body: JSON.stringify({ autonomy_permission: "acts_with_approval" }),
      }),
    /cannot expand autonomy permission/i,
    "an evaluation widened its autonomy permission",
  );
  const [unchanged] = await rest(
    `capability_eval_versions?id=eq.${baselineVersion.id}&select=autonomy_permission`,
  );
  assert(
    unchanged?.autonomy_permission === "none",
    "the autonomy permission changed despite the refusal",
  );

  // The recorded spend and time ceilings bind the evidence, not just the label.
  const budgetedRun = {
    eval_id: created.capability,
    version_id: baselineVersion.id,
    task_id: tasks[0].id,
    user_id: userId,
    domain: tasks[0].domain,
    difficulty: tasks[0].difficulty,
    split: tasks[0].split,
    outcome: "verified_success",
    verified_success: true,
    unsupported_claims: 0,
    permission_violations: 0,
    human_interventions: 0,
    recovery_attempts: 0,
    recovery_succeeded: null,
    scoring_detail: {},
  };
  await expectRefusal(
    () =>
      rest("capability_eval_runs", {
        method: "POST",
        body: JSON.stringify([{ ...budgetedRun, trial: 3, cost_cents: 1, latency_ms: 10 }]),
      }),
    /cannot spend more/i,
    "a run recorded more spend than its configuration allows",
  );
  await expectRefusal(
    () =>
      rest("capability_eval_runs", {
        method: "POST",
        body: JSON.stringify([{ ...budgetedRun, trial: 4, cost_cents: 0, latency_ms: 400_000 }]),
      }),
    /time limit/i,
    "a run recorded more latency than its configuration allows",
  );
}

function assert(condition, message) {
  if (condition) return;
  failures.push({ path: `assertion: ${message}`, ok: false });
}

async function expectRefusal(run, pattern, label) {
  try {
    await run();
    failures.push({ path: `assertion: ${label}`, ok: false, message: "the call succeeded" });
  } catch (error) {
    if (!pattern.test(error.message)) {
      failures.push({ path: `assertion: ${label}`, ok: false, message: error.message.slice(0, 200) });
    }
  }
}

async function page(path, expected = 200, contains = []) {
  const response = await fetch(BASE + path, {
    headers: { cookie: cookieHeader(session) },
    redirect: "manual",
  });
  const html = await response.text();
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? "";
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
  const bad = /<h1[^>]*>[^<]*That didn[^<]*t load|Application error: a server-side exception/i.test(html);
  const missing = contains.filter((snippet) => !html.includes(snippet));
  const ok = response.status === expected && !bad && missing.length === 0;
  const row = {
    path,
    status: response.status,
    expected,
    title: title.slice(0, 100),
    h1: h1.slice(0, 160),
    bytes: html.length,
    ...(missing.length > 0 ? { missing } : {}),
    ok,
  };
  results.push(row);
  if (!ok) failures.push(row);
  return row;
}

async function apiCheck(path, expected, options = {}) {
  const response = await fetch(BASE + path, {
    method: options.method ?? "GET",
    headers: {
      cookie: cookieHeader(session),
      "content-type": "application/json",
    },
    body: options.body,
    redirect: "manual",
  });
  const text = (await response.text()).slice(0, 400);
  const location = response.headers.get("location") ?? "";
  const locationOk = !options.locationIncludes || location.includes(options.locationIncludes);
  // `expected` may be a list where the correct status depends on the target's
  // configuration rather than on the code under test.
  const accepted = Array.isArray(expected) ? expected : [expected];
  const row = { path, status: response.status, expected, location, ok: accepted.includes(response.status) && locationOk, body: text };
  if (!row.ok) failures.push(row);
  return row;
}

async function cleanupRows() {
  for (const [table, id] of [
    ["capability_evals", created.capability],
    ["tasks", created.task],
    ["goals", created.goal],
    ["app_projects", created.project],
  ]) {
    if (!id || !session) continue;
    try {
      await rest(`${table}?id=eq.${id}`, { method: "DELETE" });
    } catch (error) {
      console.error(`Could not delete seeded ${table} row: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

async function deleteTestUser() {
  if (!testUser) return;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${testUser.id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Admin API returned ${response.status}`);
    }
  } catch (error) {
    console.error(`Could not delete the disposable test account: ${error.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  requireConfiguration();

  const healthResponse = await fetch(`${BASE}/api/health`);
  if (!healthResponse.ok) throw new Error(`The app is not healthy at ${BASE} (${healthResponse.status}).`);
  const health = await healthResponse.json();
  if (health?.status !== "ok") throw new Error(`The app health check is not ok: ${JSON.stringify(health).slice(0, 300)}`);

  testUser = await createTestUser();
  session = await signIn(testUser);
  await seed();

  await page("/");
  await page("/dashboard");
  await page("/plan");
  await page("/templates");
  await page("/data");
  await page("/settings");
  await page("/reminders");
  await page("/partner");
  await page("/futures");
  await page("/reviews");
  await page("/radar");
  await page("/outcomes");
  await page("/workspace");
  await page("/build");
  await page("/build/import");
  await page("/credits");
  await page("/billing");
  await page("/evaluations");
  await page("/capability-eval");
  await page(`/capability-eval/${created.capability}`, 200, [
    "E2E capability check",
    "Baseline versus orchestrated system",
    "Single-model baseline",
    "Orchestrated system",
    "Verified-rate difference",
    "Software building and repair",
    "Contamination and repeated exposure",
    "No human results were collected under a documented protocol",
  ]);

  // A recorded human baseline is shown only with its documented protocol.
  await rest("capability_eval_human_baselines", {
    method: "POST",
    body: JSON.stringify({
      eval_id: created.capability,
      user_id: session.user.id,
      domain: "software_build_repair",
      protocol_document:
        "Two reviewers scored twenty recorded attempts against the published rubric; a third reviewer resolved every disagreement before the results were recorded.",
      collected_by: "E2E reviewer panel",
      sample_size: 5,
      results: { verified_rate: 0.6 },
    }),
  });
  await page(`/capability-eval/${created.capability}`, 200, [
    "participant(s)",
    "collected by",
    "E2E reviewer panel",
  ]);
  await page("/workflows");
  await page("/owner", 404);
  await page(`/goals/${created.goal}`);
  await page(`/goals/${created.goal}/tasks/${created.task}`);
  await page(`/goals/${created.goal}/learn`);
  await page(`/build/${created.project}`);
  await page(`/build/${created.project}/connections`);
  await page(`/build/${created.project}/integrations`);
  await page(`/build/${created.project}/api`);
  await page(`/build/${created.project}/design`);
  await page(`/build/${created.project}/room`);
  await page(`/build/${created.project}/team`);
  await page(`/build/${created.project}/workspace`);
  await page(`/build/${created.project}/deploy`);
  await page(`/build/${created.project}/releases`);
  await page(`/build/${created.project}/improve`);
  await page("/sign-in", 307);
  await page("/sign-up", 307);
  await page("/definitely-not-a-route", 404);
  await page("/docs/composio-connections.md");

  const apiChecks = [];
  for (const [path, expected, options] of [
    ["/api/health", 200, {}],
    ["/api/v1", 200, {}],
    ["/api/v1/projects", 401, { method: "POST", body: "{}" }],
    ["/api/mcp", 401, { method: "POST", body: "{}" }],
    // 503 when CRON_SECRET is unset, 401 when it is set and no bearer token was
    // sent. Both mean the same thing: it refuses to run without the secret.
    ["/api/reminders/run", [401, 503], { method: "POST" }],
    ["/auth/callback", 307, {}],
    ["/api/composio/callback?state=x&connected_account_id=ca_test", 307, { locationIncludes: "composio=" }],
  ]) {
    apiChecks.push(await apiCheck(path, expected, options));
  }

  const summary = {
    base: BASE,
    pages: results.length,
    pageFailures: failures.filter((row) => !row.path.startsWith("/api") && !row.path.startsWith("/auth")).length,
    failures,
    apiChecks,
    health,
    user: { id: session.user.id },
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`E2E failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupRows();
    await deleteTestUser();
  });
