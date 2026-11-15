#!/usr/bin/env node
/**
 * Database-down health check.
 *
 * Starts a local Next dev server with the public Supabase URL pointed at a
 * closed loopback port, then verifies that `/api/health` reports the outage
 * rather than crashing or pretending to be healthy:
 *
 *   * HTTP 503;
 *   * status "degraded" and checks.database "unavailable";
 *   * configuration still "configured";
 *   * no probe URL or key in the response, and `cache-control: no-store`.
 *
 * The check uses a development server because a production build inlines the
 * public Supabase settings. It starts its own process on a free port, makes one
 * request and stops it; no account, database row or external call is created.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";

const BROKEN_URL = "http://127.0.0.1:9";
const PLACEHOLDER_KEY = "health-check-placeholder";
const checks = [];
let server = null;

function fail(message) {
  throw new Error(message);
}

function check(name) {
  checks.push(name);
  console.log(`✔ ${name}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base, child, output) {
  const deadline = Date.now() + 90_000;
  let last = "";

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`The development server exited with code ${child.exitCode}.\n${output()}`);
    }
    try {
      const response = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.text();
      if (response.status !== 500) return { response, body };
      last = `HTTP 500: ${body.slice(0, 300)}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  fail(`The health endpoint did not answer within 90 seconds. Last result: ${last}\n${output()}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;

  await new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      resolve();
    }, 3_000);

    child.once("exit", done);
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  });
}

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules/next/dist/bin/next");
  let log = "";

  server = spawn(
    process.execPath,
    [nextBin, "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_SUPABASE_URL: BROKEN_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: PLACEHOLDER_KEY,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const collect = (chunk) => {
    log = `${log}${chunk}`.slice(-8_000);
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);

  const { response, body } = await waitForHealth(base, server, () => log);

  if (response.status !== 503) {
    fail(`Expected HTTP 503 while the database is unreachable, got ${response.status}: ${body.slice(0, 300)}`);
  }
  check("health check returns 503 when the database is unreachable");

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail(`The health response was not JSON: ${body.slice(0, 300)}`);
  }

  if (parsed?.status !== "degraded") {
    fail(`Expected status "degraded", got ${JSON.stringify(parsed?.status)}.`);
  }
  if (parsed?.checks?.database !== "unavailable") {
    fail(`Expected checks.database "unavailable", got ${JSON.stringify(parsed?.checks?.database)}.`);
  }
  if (parsed?.checks?.configuration !== "configured") {
    fail(`Expected checks.configuration "configured", got ${JSON.stringify(parsed?.checks?.configuration)}.`);
  }
  check("health response names the database as unavailable");

  if (body.includes(BROKEN_URL) || body.includes(PLACEHOLDER_KEY)) {
    fail("The health response echoed the probe URL or key.");
  }
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (!cacheControl.includes("no-store")) {
    fail(`Expected cache-control to include "no-store", got ${JSON.stringify(cacheControl)}.`);
  }
  check("health response is uncached and contains no probe values");

  console.log(
    `\n${checks.length}/${checks.length} database-down health checks passed.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`Database-down health check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await stopServer(server);
}
