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
 * The check arms itself in two ways: a direct connection (SCHEMA_DRIFT_DATABASE_URL
 * or DATABASE_URL), or the Supabase Management API (SUPABASE_MANAGEMENT_API plus
 * SCHEMA_DRIFT_PROJECT_REF/SUPABASE_PROJECT_REF) for hosts that cannot open a
 * database connection. A direct connection that fails auth falls back to the API
 * when it is configured, and says so. With neither, the check reports that it
 * compared nothing; SCHEMA_DRIFT_REQUIRED=1 turns that into a failure.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { collectCatalog, diffCatalog } from "./schema-catalog.mjs";

const DEFAULT_SNAPSHOT = process.env.SCHEMA_DRIFT_SNAPSHOT
  ? path.resolve(process.env.SCHEMA_DRIFT_SNAPSHOT)
  : path.join(process.cwd(), "supabase/schema.snapshot.json");
const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");
const DEFINITION =
  /create or replace function (public\.[a-z_0-9]+)\s*\(([\s\S]*?)\)\s*returns[\s\S]*?\$\$([\s\S]*?)\$\$;/g;
const normalizeWhitespace = (text) => text.replace(/\s+/g, "");

// A comment is part of prosrc but not part of behaviour, so a body that differs
// only in comments is not drift. Quote-aware, because a `--` inside a string
// literal is data rather than a comment.
const stripComments = (sql) => {
  let out = "";
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const character = sql[i];
    if (inString) {
      out += character;
      if (character === "'") {
        if (sql[i + 1] === "'") {
          out += "'";
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (character === "'") {
      inString = true;
      out += character;
      continue;
    }
    if (character === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    out += character;
  }
  return out;
};

const normalize = (text) => normalizeWhitespace(stripComments(text));
const printCatalog = process.argv.includes("--print-catalog");
const connectionString = process.env.SCHEMA_DRIFT_DATABASE_URL ?? process.env.DATABASE_URL;
const apiToken = process.env.SUPABASE_MANAGEMENT_API ?? "";
const projectRef =
  process.env.SCHEMA_DRIFT_PROJECT_REF ?? process.env.SUPABASE_PROJECT_REF ?? "";
const apiArmed = apiToken !== "" && projectRef !== "";
const required = process.env.SCHEMA_DRIFT_REQUIRED === "1";
const strictDefs = process.env.SCHEMA_DRIFT_STRICT_DEFS === "1";

if (!connectionString && !apiArmed) {
  const message =
    "no database URL and no Management API credentials are set, so nothing was compared.";
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning title=Schema drift check::${message} Add a database URL or the API secrets to arm it.`);
  } else {
    console.log(`ℹ ${message} Add a database URL or the API secrets to compare.`);
  }
  process.exit(required ? 1 : 0);
}

const expectedFunctions = new Map();
for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
  const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
  for (const match of sql.matchAll(DEFINITION)) {
    expectedFunctions.set(match[1].replace("public.", ""), {
      file,
      body: normalize(match[3]),
      withoutComments: normalizeWhitespace(match[3]),
    });
  }
}

async function openDirectClient(url) {
  const direct = new pg.Client({ connectionString: url });
  await direct.connect();
  return {
    query: (sql) => direct.query(sql),
    close: () => direct.end(),
  };
}

// The Management API runs one statement and returns its rows, which is all the
// catalog queries need. It also works from a host that cannot reach the database
// port, where a direct connection times out or is refused.
function openApiClient(token, ref) {
  const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`;
  return {
    query: async (sql) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`Management API ${response.status}: ${body.slice(0, 300)}`);
      }
      let rows = [];
      try {
        rows = JSON.parse(body);
      } catch {
        throw new Error(`Management API returned a non-JSON body: ${body.slice(0, 200)}`);
      }
      return { rows: Array.isArray(rows) ? rows : [] };
    },
    close: async () => {},
  };
}

let client;
let transport = "direct";
if (connectionString) {
  try {
    client = await openDirectClient(connectionString);
  } catch (error) {
    if (!apiArmed) throw error;
    console.error(
      `ℹ the direct connection failed (${(error).message}); comparing through the Management API instead.`,
    );
    client = openApiClient(apiToken, projectRef);
    transport = "management-api";
  }
} else {
  client = openApiClient(apiToken, projectRef);
  transport = "management-api";
}

let catalog;
let functionRows;
let liveVersion = "";
try {
  ({ rows: [{ version: liveVersion }] } = await client.query("select version() as version"));
  catalog = await collectCatalog(client);
  ({ rows: functionRows } = await client.query(
    `select p.proname, p.prosrc
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'`,
  ));
} finally {
  await client.close();
}

if (printCatalog) {
  // A synchronous write: pipe writes are asynchronous, so console.log followed
  // by process.exit() can truncate a catalog this large.
  writeFileSync(1, JSON.stringify(catalog) + "\n");
  process.exit(0);
}

const live = new Map(functionRows.map((row) => [row.proname, normalize(row.prosrc)]));
const liveRaw = new Map(functionRows.map((row) => [row.proname, normalizeWhitespace(row.prosrc)]));
const missingFunctions = [];
const driftedFunctions = [];
const commentOnly = [];
for (const [name, definition] of expectedFunctions) {
  if (!live.has(name)) missingFunctions.push(name);
  else if (live.get(name) !== definition.body) driftedFunctions.push({ name, file: definition.file });
  else if (liveRaw.get(name) !== definition.withoutComments) commentOnly.push(name);
}

let catalogDiff = [];
let snapshotNote = "";
let snapshotEngine = "";
try {
  const snapshot = JSON.parse(readFileSync(DEFAULT_SNAPSHOT, "utf8"));
  catalogDiff = diffCatalog(snapshot, catalog);
  snapshotEngine = snapshot.generatedWith ?? "";
  if (snapshotEngine) snapshotNote = ` (snapshot engine: ${snapshotEngine.split(" on ")[0]})`;
} catch (error) {
  console.error(`✖ could not read ${DEFAULT_SNAPSHOT}: ${(error).message}`);
  process.exit(1);
}

// The snapshot is generated on the embedded engine while production may run a
// different major version, and a deparsed definition can be formatted
// differently by the engine alone. Saying which case applies is the difference
// between noise a reader learns to ignore and a change they should look at.
const majorOf = (text) => {
  const match = /PostgreSQL (\d+)/.exec(text ?? "");
  return match ? Number(match[1]) : null;
};
const snapshotMajor = majorOf(snapshotEngine);
const liveMajor = majorOf(liveVersion);
const engineSkew = snapshotMajor !== null && liveMajor !== null && snapshotMajor !== liveMajor;
const engineDetail = snapshotMajor === null || liveMajor === null
  ? ""
  : engineSkew
    ? ` The engines differ (snapshot PostgreSQL ${snapshotMajor}, live PostgreSQL ${liveMajor}), so formatting alone can explain these.`
    : ` Both sides report PostgreSQL ${liveMajor}, so these are real definition changes rather than formatting.`;

const structural = catalogDiff.filter((entry) => entry.kind !== "changed");
const changedDefinitions = catalogDiff.filter((entry) => entry.kind === "changed");
// Matching engines remove formatting as an explanation, so a text-only
// difference is a real change and must not be filed away as noise.
const enginesMatch = snapshotMajor !== null && liveMajor !== null && snapshotMajor === liveMajor;
const failed = missingFunctions.length > 0
  || driftedFunctions.length > 0
  || structural.length > 0
  || ((strictDefs || enginesMatch) && changedDefinitions.length > 0);

if (!failed) {
  console.log(
    `✔ no drift: ${expectedFunctions.size} functions match the migrations; `
    + `${catalog.policies.length} policies, ${catalog.constraints.length} constraints and `
    + `${catalog.indexes.length} indexes match the snapshot${snapshotNote}`
    + ` (live read over ${transport})`
    + (commentOnly.length > 0
      ? `; ${commentOnly.length} function(s) differ only in comments, which do not change behaviour.`
      : "."),
  );
  if (changedDefinitions.length > 0) {
    console.log(
      `ℹ ${changedDefinitions.length} definition(s) differ only in text; `
      + "set SCHEMA_DRIFT_STRICT_DEFS=1 to fail on those as well."
      + engineDetail,
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
  const label = strictDefs || enginesMatch ? "✖" : "ℹ";
  console.error(
    `${label} ${changedDefinitions.length} definition(s) differ in text${snapshotNote}${engineDetail}:`,
  );
  for (const entry of changedDefinitions.slice(0, 20)) console.error(`    ${entry.section}: ${entry.key}`);
  if (!strictDefs && !enginesMatch) console.error("    Set SCHEMA_DRIFT_STRICT_DEFS=1 to treat these as drift.");
}
console.error("Re-apply the owning migration, or regenerate the snapshot with `npm run schema:snapshot`.");
process.exit(1);
