#!/usr/bin/env node
/**
 * Compares the functions in a live database against the latest definition of
 * each function in supabase/migrations.
 *
 * Three migrations (0054, 0055, 0056) were applied to production through
 * `pg_get_functiondef`, so their stored text was rewritten by Postgres rather
 * than copied from the repository. This check answers the question that leaves
 * open: are the live bodies still the ones the migrations describe?
 *
 * Bodies are compared with all whitespace removed, so formatting differences do
 * not count and only real changes do. It needs a direct Postgres connection;
 * set SCHEMA_DRIFT_DATABASE_URL (or DATABASE_URL). Without one it skips rather
 * than failing, so CI can run it before the secret exists.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.SCHEMA_DRIFT_DATABASE_URL ?? process.env.DATABASE_URL;
const required = process.env.SCHEMA_DRIFT_REQUIRED === "1";
if (!connectionString) {
  const message = "SCHEMA_DRIFT_DATABASE_URL is not set, so nothing was compared.";
  if (process.env.GITHUB_ACTIONS === "true") {
    // Surfaces in the run summary instead of passing silently.
    console.log(`::warning title=Schema drift check::${message} Add a database URL secret to arm it.`);
  } else {
    console.log(`ℹ ${message} Add a database URL to compare.`);
  }
  process.exit(required ? 1 : 0);
}

const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");
const DEFINITION =
  /create or replace function (public\.[a-z_0-9]+)\s*\(([\s\S]*?)\)\s*returns[\s\S]*?\$\$([\s\S]*?)\$\$;/g;
const normalize = (text) => text.replace(/\s+/g, "");

const expected = new Map();
for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
  const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
  for (const match of sql.matchAll(DEFINITION)) {
    expected.set(match[1].replace("public.", ""), { file, body: normalize(match[3]) });
  }
}

const client = new pg.Client({ connectionString });
await client.connect();
let rows;
try {
  ({ rows } = await client.query(
    `select p.proname, p.prosrc
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'`,
  ));
} finally {
  await client.end();
}

const live = new Map(rows.map((row) => [row.proname, normalize(row.prosrc)]));
const drifted = [];
const missing = [];
for (const [name, definition] of expected) {
  if (!live.has(name)) missing.push(name);
  else if (live.get(name) !== definition.body) drifted.push({ name, file: definition.file });
}

if (missing.length === 0 && drifted.length === 0) {
  console.log(`✔ no drift: ${expected.size} functions match the migrations.`);
  process.exit(0);
}

if (missing.length > 0) {
  console.error(`✖ ${missing.length} function(s) are in the migrations but not the database:`);
  for (const name of missing.slice(0, 20)) console.error(`    ${name}`);
}
if (drifted.length > 0) {
  console.error(`✖ ${drifted.length} function(s) differ from the migrations:`);
  for (const entry of drifted.slice(0, 20)) console.error(`    ${entry.name}  (${entry.file})`);
  console.error("Re-apply the owning migration, or regenerate it from the database if the change was intended.");
}
process.exit(1);
