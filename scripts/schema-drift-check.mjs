#!/usr/bin/env node
/**
 * Compares a live database against the repository.
 *
 * Function bodies are compared with supabase/migrations, because that is where
 * they are written. Policies, constraints and indexes are compared with
 * supabase/schema.snapshot.json, which `npm run schema:snapshot` regenerates by
 * replaying the same migrations.
 *
 * Structural drift (an object that exists on one side only) always fails.
 * A changed definition fails only with SCHEMA_DRIFT_STRICT_DEFS=1, because the
 * snapshot is generated on the embedded engine while production may run a
 * different PostgreSQL major version, and deparsed definitions can be formatted
 * differently by the engine alone.
 *
 * Without a database URL the check says it compared nothing; SCHEMA_DRIFT_REQUIRED=1
 * turns that into a failure.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { collectCatalog, diffCatalog } from "./schema-catalog.mjs";

const DEFAULT_SNAPSHOT = path.join(process.cwd(), "supabase/schema.snapshot.json");
const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");
const DEFINITION =
  /create or replace function (public\.[a-z_0-9]+)\s*\(([\s\S]*?)\)\s*returns[\s\S]*?\$\$([\s\S]*?)\$\$;/g;
const normalize = (text) => text.replace(/\s+/g, "");
const printCatalog = process.argv.includes("--print-catalog");
const connectionString = process.env.SCHEMA_DRIFT_DATABASE_URL ?? process.env.DATABASE_URL;
const required = process.env.SCHEMA_DRIFT_REQUIRED === "1";
const strictDefs = process.env.SCHEMA_DRIFT_STRICT_DEFS === "1";

if (!connectionString) {
  const message = "SCHEMA_DRIFT_DATABASE_URL is not set, so nothing was compared.";
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning title=Schema drift check::${message} Add a database URL secret to arm it.`);
  } else {
    console.log(`ℹ ${message} Add a database URL to compare.`);
  }
  process.exit(required ? 1 : 0);
}

const expectedFunctions = new Map();
for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
  const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
  for (const match of sql.matchAll(DEFINITION)) {
    expectedFunctions.set(match[1].replace("public.", ""), { file, body: normalize(match[3]) });
  }
}

const client = new pg.Client({ connectionString });
await client.connect();

let catalog;
let functionRows;
try {
  catalog = await collectCatalog(client);
  ({ rows: functionRows } = await client.query(
    `select p.proname, p.prosrc
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'`,
  ));
} finally {
  await client.end();
}

if (printCatalog) {
  // A synchronous write: pipe writes are asynchronous, so console.log followed
  // by process.exit() can truncate a catalog this large.
  writeFileSync(1, JSON.stringify(catalog) + "\n");
  process.exit(0);
}

const live = new Map(functionRows.map((row) => [row.proname, normalize(row.prosrc)]));
const missingFunctions = [];
const driftedFunctions = [];
for (const [name, definition] of expectedFunctions) {
  if (!live.has(name)) missingFunctions.push(name);
  else if (live.get(name) !== definition.body) driftedFunctions.push({ name, file: definition.file });
}

let catalogDiff = [];
let snapshotNote = "";
try {
  const snapshot = JSON.parse(readFileSync(DEFAULT_SNAPSHOT, "utf8"));
  catalogDiff = diffCatalog(snapshot, catalog);
  if (snapshot.generatedWith) snapshotNote = ` (snapshot engine: ${snapshot.generatedWith.split(" on ")[0]})`;
} catch (error) {
  console.error(`✖ could not read ${DEFAULT_SNAPSHOT}: ${(error).message}`);
  process.exit(1);
}

const structural = catalogDiff.filter((entry) => entry.kind !== "changed");
const changedDefinitions = catalogDiff.filter((entry) => entry.kind === "changed");
const failed = missingFunctions.length > 0
  || driftedFunctions.length > 0
  || structural.length > 0
  || (strictDefs && changedDefinitions.length > 0);

if (!failed) {
  console.log(
    `✔ no drift: ${expectedFunctions.size} functions match the migrations; `
    + `${catalog.policies.length} policies, ${catalog.constraints.length} constraints and `
    + `${catalog.indexes.length} indexes match the snapshot${snapshotNote}.`,
  );
  if (changedDefinitions.length > 0) {
    console.log(
      `ℹ ${changedDefinitions.length} definition(s) differ only in text; `
      + "set SCHEMA_DRIFT_STRICT_DEFS=1 to fail on those as well.",
    );
  }
  process.exit(0);
}

if (missingFunctions.length > 0) {
  console.error(`✖ ${missingFunctions.length} function(s) are in the migrations but not the database:`);
  for (const name of missingFunctions.slice(0, 20)) console.error(`    ${name}`);
}
if (driftedFunctions.length > 0) {
  console.error(`✖ ${driftedFunctions.length} function(s) differ from the migrations:`);
  for (const entry of driftedFunctions.slice(0, 20)) console.error(`    ${entry.name}  (${entry.file})`);
}
if (structural.length > 0) {
  console.error(`✖ ${structural.length} schema object(s) exist on one side only:`);
  for (const entry of structural.slice(0, 20)) console.error(`    ${entry.kind} ${entry.section}: ${entry.key}`);
}
if (changedDefinitions.length > 0) {
  const label = strictDefs ? "✖" : "ℹ";
  console.error(
    `${label} ${changedDefinitions.length} definition(s) differ in text${snapshotNote}:`,
  );
  for (const entry of changedDefinitions.slice(0, 20)) console.error(`    ${entry.section}: ${entry.key}`);
  if (!strictDefs) console.error("    Set SCHEMA_DRIFT_STRICT_DEFS=1 to treat these as drift.");
}
console.error("Re-apply the owning migration, or regenerate the snapshot with `npm run schema:snapshot`.");
process.exit(1);
