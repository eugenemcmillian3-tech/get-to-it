#!/usr/bin/env node
/**
 * Starts an isolated Postgres, replays every migration, and runs the restore and
 * authorization drill against it. Nothing here connects to the live project.
 *
 * Usage: npm run test:restore
 */

import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const DATA_DIR = path.join(process.cwd(), ".restore-data");
const PORT = Number(process.env.RESTORE_TEST_PORT ?? 55432);
const DATABASE = "restore_test";

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

    const result = spawnSync(
      "npx",
      ["vitest", "run", "tests/restore.integration.test.ts"],
      {
        stdio: "inherit",
        env: { ...process.env, RESTORE_TEST_DATABASE_URL: url },
      },
    );

    if (result.status !== 0) {
      throw new Error(
        `Restore drill failed (exit ${result.status ?? "unknown"}). See the test output above.`,
      );
    }

    console.log("\nRestore drill passed on an isolated database: no live data was touched.");
  } finally {
    if (started) {
      try {
        await server.stop();
      } catch (error) {
        console.error("Could not stop the test database:", error.message);
      }
    }
    await rm(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
