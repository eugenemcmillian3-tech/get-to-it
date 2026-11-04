import { Client } from "pg";
import {
  INTEGRATION_LIMITS,
  type IntegrationTable,
} from "@/lib/integrations/registry";

/**
 * PostgreSQL integration support.
 *
 * This is the same database type the deployment layer already uses. It only
 * inspects information_schema in a read-only transaction. It never copies rows
 * into AI context, never writes, and never applies a proposed migration.
 */

export class DatabaseIntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseIntegrationError";
  }
}

export type ParsedDatabase = {
  host: string;
  port: number;
  database: string;
  label: string;
};

export function parsePostgresUrl(raw: string): ParsedDatabase {
  const value = raw.trim();
  if (value.length === 0 || value.length > 4_000) {
    throw new DatabaseIntegrationError("Enter a PostgreSQL connection URL.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DatabaseIntegrationError("That is not a complete PostgreSQL connection URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DatabaseIntegrationError("Only PostgreSQL URLs are supported.");
  }
  if (url.username === "" || url.password === "" || url.hostname === "") {
    throw new DatabaseIntegrationError("The connection URL needs a user, password and host.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database === "") throw new DatabaseIntegrationError("The connection URL needs a database name.");
  const port = url.port === "" ? 5432 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new DatabaseIntegrationError("The connection URL has an invalid port.");
  }
  return {
    host: url.hostname,
    port,
    database,
    label: `${url.hostname}:${port}/${database}`,
  };
}

function clientFor(connectionString: string): Client {
  return new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
  });
}

export async function testPostgresConnection(connectionString: string): Promise<void> {
  const client = clientFor(connectionString);
  try {
    await client.connect();
    await client.query("begin read only");
    await client.query("set local statement_timeout = 5000");
    await client.query("select 1");
    await client.query("rollback");
  } catch {
    throw new DatabaseIntegrationError("The PostgreSQL connection could not be verified read-only.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

type SchemaRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
};

export async function inspectPostgresSchema(connectionString: string): Promise<IntegrationTable[]> {
  const client = clientFor(connectionString);
  try {
    await client.connect();
    await client.query("begin read only");
    await client.query("set local statement_timeout = 5000");
    const result = await client.query<SchemaRow>(`
      select table_name, column_name, data_type, is_nullable
        from information_schema.columns
       where table_schema = 'public'
         and table_name not like 'pg_%'
         and table_name not like '_prisma_%'
       order by table_name, ordinal_position
       limit 2000
    `);
    await client.query("rollback");

    const tables = new Map<string, IntegrationTable>();
    for (const row of result.rows) {
      if (tables.size >= INTEGRATION_LIMITS.maxTables && !tables.has(row.table_name)) break;
      const table = tables.get(row.table_name) ?? { name: row.table_name, columns: [] };
      if (table.columns.length < INTEGRATION_LIMITS.maxColumnsPerTable) {
        table.columns.push({
          name: row.column_name,
          type: row.data_type.slice(0, 80),
          nullable: row.is_nullable === "YES",
        });
      }
      tables.set(row.table_name, table);
    }
    return [...tables.values()];
  } catch {
    throw new DatabaseIntegrationError(
      "The schema could not be inspected. Check that the credential can read information_schema.",
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function safeViewName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "table";
}

/** A preview only. The app never applies this SQL. */
export function buildMigrationPreview(tables: IntegrationTable[], slug: string): string {
  const schema = `app_integration_${safeViewName(slug)}`;
  const views = tables
    .filter((table) => table.columns.length > 0)
    .map((table) => {
      const columns = table.columns.map((column) => quoteIdentifier(column.name)).join(", ");
      return `create or replace view ${quoteIdentifier(schema)}.${quoteIdentifier(safeViewName(table.name))} as\n  select ${columns}\n    from public.${quoteIdentifier(table.name)};`;
    })
    .join("\n\n");
  return `-- Preview only. Review with the database owner before applying.
-- Read-only views do not grant write access to the source tables.
create schema if not exists ${quoteIdentifier(schema)};

${views}
`;
}

function tsTypeForDatabase(type: string): string {
  const value = type.toLowerCase();
  if (/(int|numeric|decimal|real|double|money|serial)/.test(value)) return "number";
  if (/(bool)/.test(value)) return "boolean";
  if (/(json|array)/.test(value)) return "unknown";
  if (/(date|time)/.test(value)) return "string";
  return "string";
}

/** Typed read-only wrappers for the generated app. No driver or secret is embedded. */
export function generateDatabaseClient(input: {
  name: string;
  slug: string;
  envPrefix: string;
  tables: IntegrationTable[];
}): string {
  if (input.tables.length === 0) {
    throw new DatabaseIntegrationError("Select at least one table before generating code.");
  }
  const blocks = input.tables.map((table) => {
    const typeName = table.name
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("") || "Record";
    const fields = table.columns
      .map((column) => {
        const name = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(column.name)
          ? column.name
          : JSON.stringify(column.name);
        return `  ${name}${column.nullable ? "?" : ""}: ${tsTypeForDatabase(column.type)};`;
      })
      .join("\n");
    const columns = table.columns.map((column) => quoteIdentifier(column.name)).join(", ");
    return `export type ${typeName} = {\n${fields}\n};\n\nexport const ${typeName.charAt(0).toLowerCase() + typeName.slice(1)}Query =\n  \`select ${columns} from public.${quoteIdentifier(table.name)} limit 100\`;`;
  });

  return `// Generated by GET TO IT Integration Studio.
// Read-only PostgreSQL wrappers. Pass these strings to your own server-side
// database client; this file deliberately contains no driver and no credential.
// Use the development URL for local work and the production URL only when
// explicitly deploying.
export function databaseUrl(): string {
  const value = process.env.${input.envPrefix}_DATABASE_URL;
  if (!value) throw new Error("${input.envPrefix}_DATABASE_URL is not configured.");
  return value;
}

export function productionDatabaseUrl(): string {
  const value = process.env.${input.envPrefix}_DATABASE_URL_PRODUCTION;
  if (!value) throw new Error("${input.envPrefix}_DATABASE_URL_PRODUCTION is not configured.");
  return value;
}

${blocks.join("\n\n")}
`;
}
