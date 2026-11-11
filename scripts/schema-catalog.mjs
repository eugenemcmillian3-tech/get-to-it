/**
 * Reads the parts of a schema that migrations also define, in a form that can be
 * compared between two databases: row-level security policies, constraints and
 * indexes.
 *
 * Definitions come back from Postgres as text, so everything is normalised to a
 * single line. A different PostgreSQL major version can still format a
 * definition differently; regenerate the snapshot on the engine you compare
 * against if that happens.
 */

const norm = (value) => (value ?? "").replace(/\s+/g, " ").trim();

export async function collectCatalog(client) {
  const policies = (
    await client.query(`
      select tablename, policyname, cmd, roles::text as roles, qual, with_check
        from pg_policies
       where schemaname = 'public'
    `)
  ).rows
    .map((row) => ({
      key: `${row.tablename}.${row.policyname}`,
      table: row.tablename,
      name: row.policyname,
      cmd: row.cmd,
      roles: norm(row.roles),
      qual: norm(row.qual),
      check: norm(row.with_check),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const constraints = (
    await client.query(`
      select rel.relname as table_name, c.conname, c.contype,
             pg_get_constraintdef(c.oid) as definition
        from pg_constraint c
        join pg_class rel on rel.oid = c.conrelid
        join pg_namespace n on n.oid = rel.relnamespace
       where n.nspname = 'public'
         and c.contype in ('c', 'f', 'u', 'p', 'x')
    `)
  ).rows
    .map((row) => ({
      key: `${row.table_name}.${row.conname}`,
      table: row.table_name,
      name: row.conname,
      type: row.contype,
      definition: norm(row.definition),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const indexes = (
    await client.query(`
      select tablename, indexname, indexdef
        from pg_indexes
       where schemaname = 'public'
    `)
  ).rows
    .map((row) => ({
      key: `${row.tablename}.${row.indexname}`,
      table: row.tablename,
      name: row.indexname,
      definition: norm(row.indexdef),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return { policies, constraints, indexes };
}

/** Sections where the live catalog differs from the snapshot. */
export function diffCatalog(expected, actual) {
  const report = [];
  for (const section of ["policies", "constraints", "indexes"]) {
    const want = new Map((expected?.[section] ?? []).map((entry) => [entry.key, entry]));
    const have = new Map((actual?.[section] ?? []).map((entry) => [entry.key, entry]));
    for (const [key, entry] of want) {
      const live = have.get(key);
      if (!live) report.push({ section, key, kind: "missing" });
      else if (JSON.stringify(live) !== JSON.stringify(entry)) report.push({ section, key, kind: "changed" });
    }
    for (const key of have.keys()) {
      if (!want.has(key)) report.push({ section, key, kind: "unexpected" });
    }
  }
  return report;
}
