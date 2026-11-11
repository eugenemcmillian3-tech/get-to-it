#!/usr/bin/env node
/**
 * Runs the Phase 37 knowledge harness against a throwaway embedded Postgres.
 *
 * Nothing here connects to the hosted project: the database lives in
 * `.knowledge-data/` for the length of the run, is named `knowledge_test`, and
 * is removed afterwards. The test itself refuses to run against any database
 * that does not carry that name.
 *
 * Usage: npm run test:knowledge
 */

import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const DATA_DIR = path.join(process.cwd(), ".knowledge-data");
const PORT = Number(process.env.KNOWLEDGE_TEST_PORT ?? 55433);
const DATABASE = "knowledge_test";

async function main() {
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
  });

  let started = false;

  try {
    await rm(DATA_DIR, { recursive: true, force: true });
    await server.initialise();
    await server.start();
    started = true;
    await server.createDatabase(DATABASE);

    const url = `postgresql://postgres:postgres@127.0.0.1:${PORT}/${DATABASE}`;

    const result = spawnSync("npx", ["vitest", "run", "tests/knowledge.integration.test.ts"], {
      stdio: "inherit",
      env: { ...process.env, KNOWLEDGE_TEST_DATABASE_URL: url },
    });

    if (result.status !== 0) {
      throw new Error(
        `Knowledge harness failed (exit ${result.status ?? "unknown"}). See the test output above.`,
      );
    }

    console.log("\nPhase 37 harness passed on an isolated database: no live data was touched.");
  } finally {
    if (started) {
      try {
        await server.stop();
      } catch (error) {
        console.error("Could not stop the harness database:", error.message);
      }
    }
    await rm(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
