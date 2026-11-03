import { z } from "zod";

/**
 * Phase 21 — "Build an App" contract.
 *
 * Everything here is pure and client-safe. The generated project is built by a
 * deterministic scaffolder, not by a model: the same approved specification
 * always produces the same files, and nothing is executed. Paths and sizes are
 * validated before any write, so a bad request is refused rather than stored.
 *
 * This module supports exactly one stack — Next.js, TypeScript and Tailwind CSS,
 * optionally with Supabase — and makes no claim about any other framework.
 */

export const SUPPORTED_STACK = {
  id: "nextjs-typescript-tailwind",
  label: "Next.js + TypeScript + Tailwind CSS",
  note: "This workspace supports one stack. Supabase is added only when you choose it.",
} as const;

export type SupportedStack = typeof SUPPORTED_STACK.id;

export const PROJECT_LIMITS = {
  maxPages: 12,
  maxEntities: 8,
  maxIntegrations: 6,
  maxFiles: 60,
  maxFileChars: 60_000,
  maxTotalChars: 400_000,
  maxPathChars: 160,
  versionsKept: 20,
} as const;

export const GENERATION_NOTE =
  "Files are generated on the server from the approved specification. Nothing is executed, installed or deployed, and generated code is not proof that the app works. No credentials or external accounts are invented.";

export const MOCKED_NOTE =
  "Every external integration in this first version is mocked. A mocked integration has a labelled stub and no working account, key or network call.";

export const NOT_PRODUCTION_NOTE =
  "This is a scaffold, not a production-ready application. Review authentication, authorization, validation, error handling, migrations and every integration before real use.";

export const EXISTING_PLATFORM_NOTE =
  "The workspace reuses this account's sign-in, saved work and usage rules. Project files live in their own tables, separate from task notes and saved results.";

export const EXCLUSIONS: string[] = [
  "No deployment, hosting, domain or infrastructure purchase.",
  "No running generated or untrusted code inside GET TO IT.",
  "No autonomous agents, swarms or background execution.",
  "No invented credentials, accounts or prices.",
];

const BASE_CHECKS: string[] = [
  "Every page in the navigation renders without an unhandled error.",
  "Forms show a visible validation message instead of failing silently.",
  "The production build completes with `npm run build`.",
  "No secret value is committed; `.env.example` lists names only.",
];

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

export const AUTH_CHOICES = [
  {
    id: "supabase",
    label: "Supabase accounts (email and password)",
    note: "Adds owner-only tables, row level security and sign-in checks to the API routes.",
  },
  {
    id: "none",
    label: "No accounts in the first version",
    note: "Pages render, but the write API says persistence is not configured rather than pretending to save.",
  },
] as const;

export const INTAKE_FIELDS = [
  { name: "name", label: "App name", hint: "A short working name." },
  { name: "purpose", label: "App purpose", hint: "What is it for, and what should it replace?" },
  { name: "target_users", label: "Target users", hint: "Who will use it, and what do they already know?" },
  { name: "workflows", label: "Main workflows", hint: "One per line. These become the feature list." },
  { name: "required_pages", label: "Required pages", hint: "One per line, e.g. `/projects | Projects | See every project`." },
  { name: "entities", label: "Data entities", hint: "One per line, e.g. `project: title, notes, status`." },
  { name: "integrations", label: "External integrations", hint: "One per line. Each is labelled MOCKED in the generated project." },
  { name: "design_preferences", label: "Design preferences", hint: "Tone, density, colours, anything to avoid." },
  { name: "definition_of_done", label: "Definition of done", hint: "How you will know the first version is useful." },
] as const;

function lineList(value: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

export function parseIntakeLines(value: string): string[] {
  return lineList(value);
}

export const intakeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Give the app a name of at least 3 characters.")
    .max(80, "Keep the app name under 80 characters."),
  purpose: z
    .string()
    .trim()
    .min(10, "Describe the app purpose in at least 10 characters.")
    .max(1_500, "Keep the purpose under 1500 characters."),
  target_users: z
    .string()
    .trim()
    .min(5, "Say who the first users are.")
    .max(600, "Keep target users under 600 characters."),
  workflows: z
    .string()
    .trim()
    .min(5, "List at least one main workflow.")
    .max(1_500, "Keep workflows under 1500 characters."),
  required_pages: z
    .string()
    .trim()
    .min(3, "List at least one required page.")
    .max(1_000, "Keep required pages under 1000 characters."),
  entities: z
    .string()
    .trim()
    .max(1_000, "Keep data entities under 1000 characters."),
  auth_requirements: z.enum(["supabase", "none"]),
  integrations: z
    .string()
    .trim()
    .max(800, "Keep integrations under 800 characters."),
  design_preferences: z
    .string()
    .trim()
    .max(800, "Keep design preferences under 800 characters."),
  definition_of_done: z
    .string()
    .trim()
    .min(5, "Say how you will know the first version is done.")
    .max(1_000, "Keep the definition of done under 1000 characters."),
});

export type AppIntakeInput = z.infer<typeof intakeSchema>;

export function intakeProblems(input: AppIntakeInput): string[] {
  const problems: string[] = [];
  if (lineList(input.required_pages).length > PROJECT_LIMITS.maxPages) {
    problems.push(`Keep required pages to ${PROJECT_LIMITS.maxPages} or fewer.`);
  }
  if (lineList(input.entities).length > PROJECT_LIMITS.maxEntities) {
    problems.push(`Keep data entities to ${PROJECT_LIMITS.maxEntities} or fewer.`);
  }
  if (lineList(input.integrations).length > PROJECT_LIMITS.maxIntegrations) {
    problems.push(`Keep integrations to ${PROJECT_LIMITS.maxIntegrations} or fewer.`);
  }
  for (const page of lineList(input.required_pages)) {
    const path = page.split("|")[0]?.trim() ?? "";
    if (path.includes("..") || path.includes("\\")) {
      problems.push("Page paths cannot contain '..' or a backslash.");
      break;
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Specification
// ---------------------------------------------------------------------------

export type AppSpecPage = { path: string; title: string; purpose: string };
export type AppSpecEntity = { name: string; fields: string[] };
export type AppSpecIntegration = { name: string; env_var: string; mocked: true };

export type AppSpec = {
  stack: SupportedStack;
  purpose: string;
  features: string[];
  exclusions: string[];
  pages: AppSpecPage[];
  navigation: { label: string; href: string }[];
  entities: AppSpecEntity[];
  server_operations: { entity: string; operations: string[] }[];
  authorization_rules: string[];
  integrations: AppSpecIntegration[];
  env_vars: string[];
  acceptance_checks: string[];
  supabase: boolean;
  design_preferences: string;
  definition_of_done: string;
};

export const specInputSchema = z.object({
  features: z.string().trim().max(2_000, "Keep features under 2000 characters."),
  exclusions: z.string().trim().max(2_000, "Keep exclusions under 2000 characters."),
  pages: z.string().trim().max(2_000, "Keep pages under 2000 characters."),
  entities: z.string().trim().max(2_000, "Keep entities under 2000 characters."),
  integrations: z.string().trim().max(1_000, "Keep integrations under 1000 characters."),
  acceptance_checks: z.string().trim().max(2_000, "Keep acceptance checks under 2000 characters."),
  auth_requirements: z.enum(["supabase", "none"]),
});

export type SpecInput = z.infer<typeof specInputSchema>;

export function safeRoutePath(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "/") return "/";
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("//")) return null;
  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length > 6) return null;
  const safe = segments.map((segment) => slugify(segment));
  if (safe.some((segment) => segment === "")) return null;
  return `/${safe.join("/")}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function identifier(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, 40);
  if (cleaned === "") return "record";
  return /^[0-9]/.test(cleaned) ? `item_${cleaned}` : cleaned;
}

export function pluralize(value: string): string {
  if (value.endsWith("s")) return value;
  if (/(ch|sh|x|z)$/.test(value)) return `${value}es`;
  if (/[^aeiou]y$/.test(value)) return `${value.slice(0, -1)}ies`;
  return `${value}s`;
}

export function pascalCase(value: string): string {
  const parts = identifier(value).split("_").filter(Boolean);
  const joined = parts.map((part) => part[0]?.toUpperCase() + part.slice(1)).join("");
  return joined === "" ? "Record" : joined;
}

export function envVarForIntegration(line: string): string {
  const name = line.split(/[:—|]/)[0]?.trim() ?? line;
  return `INTEGRATION_${identifier(name).toUpperCase()}_API_KEY`;
}

export function integrationLabel(line: string): string {
  return (line.split(/[:—|]/)[0]?.trim() ?? line).slice(0, 60);
}

export function parseEntityLine(line: string): AppSpecEntity {
  const [rawName, rawFields = ""] = line.split(":");
  const name = identifier(rawName);
  const fields = lineList(rawFields.replace(/,/g, "\n"))
    .map((field) => identifier(field))
    .filter((field) => !["id", "user_id", "created_at", "updated_at", "user", "created", "updated"].includes(field))
    .slice(0, 8);
  return { name, fields: fields.length > 0 ? fields : ["title", "notes", "status"] };
}

export function parsePageLine(line: string): AppSpecPage {
  const parts = line.split("|").map((part) => part.trim());
  const rawPath = parts[0] ?? "";
  const path = safeRoutePath(rawPath.startsWith("/") ? rawPath : `/${rawPath}`);
  const title = (parts[1] || rawPath.replace(/[/-]+/g, " ")).trim().slice(0, 80) || "Page";
  const purpose = (parts[2] || `Work on ${title.toLowerCase()}.`).trim().slice(0, 300);
  return {
    path: path ?? "/",
    title: title === "" ? "Page" : title,
    purpose,
  };
}

export function composeSpec(input: SpecInput, designPreferences = "", definitionOfDone = ""): AppSpec {
  const supabase = input.auth_requirements === "supabase";

  const pages: AppSpecPage[] = [{ path: "/", title: "Home", purpose: "The first screen and a way into every workflow." }];
  const seenPaths = new Set<string>(["/"]);
  for (const line of lineList(input.pages).slice(0, PROJECT_LIMITS.maxPages)) {
    const page = parsePageLine(line);
    if (seenPaths.has(page.path)) continue;
    seenPaths.add(page.path);
    pages.push(page);
  }

  const entities: AppSpecEntity[] = [];
  const seenEntities = new Set<string>();
  for (const line of lineList(input.entities).slice(0, PROJECT_LIMITS.maxEntities)) {
    const entity = parseEntityLine(line);
    if (seenEntities.has(entity.name)) continue;
    seenEntities.add(entity.name);
    entities.push(entity);
  }

  const integrations: AppSpecIntegration[] = lineList(input.integrations)
    .slice(0, PROJECT_LIMITS.maxIntegrations)
    .map((line) => ({
      name: integrationLabel(line),
      env_var: envVarForIntegration(line),
      mocked: true as const,
    }));

  const envVars = new Set<string>();
  if (supabase && entities.length > 0) {
    envVars.add("NEXT_PUBLIC_SUPABASE_URL");
    envVars.add("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  for (const integration of integrations) envVars.add(integration.env_var);

  const features = lineList(input.features).slice(0, 20);
  const exclusions = lineList(input.exclusions).slice(0, 20);
  const acceptance = lineList(input.acceptance_checks).slice(0, 20);

  return {
    stack: SUPPORTED_STACK.id,
    purpose: definitionOfDone.trim(),
    features: features.length > 0 ? features : ["One useful workflow, end to end."],
    exclusions,
    pages,
    navigation: pages.map((page) => ({ label: page.title, href: page.path })),
    entities,
    server_operations: entities.map((entity) => ({
      entity: entity.name,
      operations: supabase ? ["list", "create"] : ["list (documented)", "create (not configured)"],
    })),
    authorization_rules: supabase
      ? [
          "Only a signed-in person can call the write API; a missing session returns 401.",
          "Every row carries user_id and row level security limits reads and writes to that owner.",
          "The browser uses only the anon key. No service_role key is generated or read.",
        ]
      : [
          "The first version has no accounts.",
          "Write endpoints return 501 with a setup message instead of pretending to save.",
          "Do not expose this scaffold publicly until authentication and authorization are added.",
        ],
    integrations,
    env_vars: [...envVars],
    acceptance_checks: [
      ...(definitionOfDone.trim() === "" ? [] : [definitionOfDone.trim()]),
      ...(acceptance.length > 0 ? acceptance : BASE_CHECKS.filter((check, index) => index < 2)),
      ...BASE_CHECKS.slice(2),
    ],
    supabase,
    design_preferences: designPreferences.trim(),
    definition_of_done: definitionOfDone.trim(),
  };
}

export function specToInput(spec: AppSpec): SpecInput {
  return {
    features: spec.features.join("\n"),
    exclusions: spec.exclusions.join("\n"),
    pages: spec.pages
      .filter((page) => page.path !== "/")
      .map((page) => `${page.path} | ${page.title} | ${page.purpose}`)
      .join("\n"),
    entities: spec.entities.map((entity) => `${entity.name}: ${entity.fields.join(", ")}`).join("\n"),
    integrations: spec.integrations.map((integration) => integration.name).join("\n"),
    acceptance_checks: spec.acceptance_checks.join("\n"),
    auth_requirements: spec.supabase ? "supabase" : "none",
  };
}

export function buildSpecDraft(input: AppIntakeInput): AppSpec {
  // The intake text is captured verbatim on the project row; the spec carries
  // the definition of done separately and the purpose in its own field.
  const draft = draftFromIntake(input);
  return { ...draft, purpose: input.purpose };
}

function draftFromIntake(input: AppIntakeInput): AppSpec {
  const pages = lineList(input.required_pages).map((line) => {
    const parsed = parsePageLine(line);
    return `${parsed.path} | ${parsed.title} | ${parsed.purpose}`;
  });
  const features = lineList(input.workflows).slice(0, 20).join("\n");
  const checks = [`The first version is done when ${input.definition_of_done.replace(/[.\s]+$/, "")}.`];

  return composeSpec(
    {
      features,
      exclusions: EXCLUSIONS.join("\n"),
      pages: pages.join("\n"),
      entities: lineList(input.entities).join("\n"),
      integrations: lineList(input.integrations).join("\n"),
      acceptance_checks: checks.join("\n"),
      auth_requirements: input.auth_requirements,
    },
    input.design_preferences,
    input.definition_of_done,
  );
}

// ---------------------------------------------------------------------------
// Path and size safety
// ---------------------------------------------------------------------------

const BLOCKED_SEGMENTS = new Set([".git", ".next", "node_modules", "secrets"]);
const ALLOWED_PATH = /^[A-Za-z0-9._-]+$/;

/** True only for a relative, normalised project path inside the generated app. */
export function isSafeProjectPath(value: string): boolean {
  if (value.length === 0 || value.length > PROJECT_LIMITS.maxPathChars) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("/") || value.endsWith("/")) return false;
  if (value.includes("\\") || value.includes("//")) return false;

  const segments = value.split("/");
  if (segments.length > 8) return false;
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return false;
    if (segment.length > 64) return false;
    if (!ALLOWED_PATH.test(segment)) return false;
    if (segment.endsWith(".")) return false;
    if (BLOCKED_SEGMENTS.has(segment.toLowerCase())) return false;
    if (/^\.env(\..+)?$/.test(segment) && segment !== ".env.example") return false;
  }
  return true;
}

export class AppBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppBuildError";
  }
}

export type GeneratedFile = { path: string; content: string };

export function assertGenerationFits(files: GeneratedFile[]): void {
  if (files.length === 0) throw new AppBuildError("A project needs at least one file.");
  if (files.length > PROJECT_LIMITS.maxFiles) {
    throw new AppBuildError(
      `That request would create ${files.length} files; the limit is ${PROJECT_LIMITS.maxFiles}.`,
    );
  }

  const seen = new Set<string>();
  let total = 0;

  for (const file of files) {
    if (!isSafeProjectPath(file.path)) {
      throw new AppBuildError(`Unsafe project path refused: ${file.path.slice(0, 80)}`);
    }
    if (seen.has(file.path)) {
      throw new AppBuildError(`Two generated files share the path ${file.path}.`);
    }
    seen.add(file.path);

    if (file.content.length > PROJECT_LIMITS.maxFileChars) {
      throw new AppBuildError(`${file.path} is larger than the 60000 character file limit.`);
    }
    total += file.content.length;
  }

  if (total > PROJECT_LIMITS.maxTotalChars) {
    throw new AppBuildError(
      `That request is larger than the ${PROJECT_LIMITS.maxTotalChars} character project limit.`,
    );
  }
}

// ---------------------------------------------------------------------------
// File generation
// ---------------------------------------------------------------------------

function tsString(value: string): string {
  return JSON.stringify(value);
}

function fieldSchemaLine(field: string): string {
  const optional = ["notes", "description", "body", "details", "summary"].includes(field);
  return `  ${field}: z.string().trim().max(2000, "Keep ${field} under 2000 characters.")${optional ? ".default(\"\")" : ""},`;
}

function entityForm(entity: AppSpecEntity, supabase: boolean): string {
  const component = `${pascalCase(entity.name)}Form`;
  const inputs = entity.fields
    .map(
      (field) => `          <label className="block text-sm font-medium">
            ${field.replace(/_/g, " ")}
            <input
              name={${tsString(field)}}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              maxLength={2000}
            />
          </label>`,
    )
    .join("\n");

  return `"use client";

// Generated form. It performs no client-side authorization: the server route
// validates the input and checks the session.
import { useState, type FormEvent } from "react";

export function ${component}() {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);

    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());

    try {
      const response = await fetch(${tsString(`/api/${pluralize(entity.name)}`)}, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not save. Nothing was changed.");
        return;
      }
      form.reset();
      setSaved(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl border border-slate-200 p-4">
      <h2 className="text-lg font-semibold">Add ${entity.name.replace(/_/g, " ")}</h2>
${inputs}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      {saved ? <p className="text-sm text-green-700">Saved.</p> : null}
      ${supabase ? "" : `<p className="text-xs text-amber-700">Persistence is not configured in this scaffold.</p>`}
    </form>
  );
}
`;
}

function apiRoute(entity: AppSpecEntity, supabase: boolean): string {
  const schemaName = `${pascalCase(entity.name)}Input`;
  const inputShape = entity.fields
    .map((field) => `  ${field}: z.string().trim().max(2000, "Keep ${field} under 2000 characters."),`)
    .join("\n");

  const auth = supabase
    ? `  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
`
    : `  return NextResponse.json(
    {
      error:
        "Persistence is not configured in this scaffold. Add Supabase and owner-only tables before relying on writes.",
    },
    { status: 501 },
  );
`;

  return `import { NextResponse } from "next/server";
import { z } from "zod";
${supabase ? 'import { createClient } from "@/lib/supabase/server";\n' : ""}
const ${schemaName} = z.object({
${inputShape}
});

export async function GET() {
${supabase ? `  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
  const { data, error } = await supabase
    .from(${tsString(entity.name)})
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: "Could not load records." }, { status: 500 });
  }
  return NextResponse.json({ data });
` : `  return NextResponse.json(
    { data: [], error: "Persistence is not configured in this scaffold." },
    { status: 501 },
  );
`}}

export async function POST(request: Request) {
${supabase ? `  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }
` : ""}${auth}
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const parsed = ${schemaName}.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error?.issues[0]?.message ?? "Check the form and try again.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
${
  supabase
    ? `  const { error } = await supabase
    .from(${tsString(entity.name)})
    .insert({ ...parsed.data, user_id: user.id });
  if (error) {
    return NextResponse.json({ error: "Could not save that record." }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });`
    : ""
}
}
`;
}

function entityPage(entity: AppSpecEntity, supabase: boolean): string {
  const title = entity.name.replace(/_/g, " ");
  return `import { ${pascalCase(entity.name)}Form } from "@/components/${entity.name}-form";

export const metadata = { title: ${tsString(`${title} — ${title}`)} };

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold capitalize">${title}</h1>
      <p className="mt-2 text-slate-600">
        Create a ${title.replace(/s$/, "")}. ${
          supabase
            ? "Only your signed-in account can read or write these rows."
            : "This scaffold has no persistence configured yet."
        }
      </p>
      <${pascalCase(entity.name)}Form />
    </main>
  );
}
`;
}

function migration(spec: AppSpec): string {
  const tables = spec.entities
    .map((entity) => {
      const columns = entity.fields
        .map((field) => `  ${field} text not null default '' check (char_length(${field}) <= 2000),`)
        .join("\n");
      return `create table if not exists public.${entity.name} (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
${columns}
  created_at timestamptz not null default now()
);

alter table public.${entity.name} enable row level security;

create policy "owners read their ${entity.name}" on public.${entity.name}
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owners add their ${entity.name}" on public.${entity.name}
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owners update their ${entity.name}" on public.${entity.name}
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "owners delete their ${entity.name}" on public.${entity.name}
  for delete to authenticated using (user_id = (select auth.uid()));

create index if not exists ${entity.name}_user_idx on public.${entity.name} (user_id, created_at desc);`;
    })
    .join("\n\n");

  return `-- Generated by GET TO IT for ${spec.pages[0]?.title ?? "the app"}.
-- Owner-only tables. No privileged server key and no seeded accounts.
${tables}
`;
}

function pageComponent(page: AppSpecPage, entity?: AppSpecEntity): string {
  const form = entity ? `${pascalCase(entity.name)}Form` : null;
  return `${form ? `import { ${form} } from "@/components/${entity!.name}-form";\n` : ""}import Link from "next/link";

export const metadata = { title: ${tsString(page.title)} };

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold">${page.title.replace(/[{}<>]/g, "")}</h1>
      <p className="mt-3 text-slate-600">${page.purpose.replace(/[{}<>]/g, "")}</p>
      ${form ? `<${form} />` : `<p className="mt-6 text-sm text-slate-500">Replace this scaffold copy with the real ${page.title.toLowerCase()} workflow.</p>`}
      <Link href="/" className="mt-8 inline-block underline">
        Back home
      </Link>
    </main>
  );
}
`;
}

function homeComponent(spec: AppSpec): string {
  const links = spec.pages
    .filter((page) => page.path !== "/")
    .map(
      (page) => `        <li key=${tsString(page.path)}>
          <Link className="underline" href=${tsString(page.path)}>${page.title.replace(/[{}<>]/g, "")}</Link>
          <span className="ml-2 text-sm text-slate-500">${page.purpose.replace(/[{}<>]/g, "")}</span>
        </li>`,
    )
    .join("\n");

  return `import Link from "next/link";

export const metadata = { title: ${tsString(spec.pages[0]?.title ?? "Home")} };

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-4xl font-black tracking-tight">${(spec.pages[0]?.title ?? "Home").replace(/[{}<>]/g, "")}</h1>
      <p className="mt-4 text-slate-600">${(spec.features[0] ?? "A first working version.").replace(/[{}<>]/g, "")}</p>
      <ul className="mt-8 space-y-3">
${links || `        <li>Add a workflow to the specification to generate pages.</li>`}
      </ul>
    </main>
  );
}
`;
}

function navComponent(spec: AppSpec): string {
  const links = spec.navigation
    .map(
      (item) => `        <Link className="underline" href=${tsString(item.href)}>${item.label.replace(/[{}<>]/g, "")}</Link>`,
    )
    .join("\n");

  return `import Link from "next/link";

export function Nav() {
  return (
    <nav className="flex flex-wrap gap-4 border-b border-slate-200 px-6 py-4 text-sm">
${links}
    </nav>
  );
}
`;
}

function layoutComponent(name: string): string {
  return `import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: ${tsString(name)},
  description: "Generated by GET TO IT. Not production ready.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">
        <Nav />
        {children}
      </body>
    </html>
  );
}
`;
}

function validationFile(spec: AppSpec): string {
  const blocks = spec.entities
    .map(
      (entity) => `export const ${entity.name}Input = z.object({
${entity.fields.map(fieldSchemaLine).join("\n")}
});

export type ${pascalCase(entity.name)}Input = z.infer<typeof ${entity.name}Input>;`,
    )
    .join("\n\n");

  return `import { z } from "zod";

// Shared input validation. Keep server-side validation even when a form also
// checks values in the browser.
${blocks || "export const health = z.object({ ok: z.boolean() });"}
`;
}

function integrationsFile(spec: AppSpec): string | null {
  if (spec.integrations.length === 0) return null;

  const stubs = spec.integrations
    .map(
      (integration) => `export async function call${pascalCase(integration.name)}(input: unknown): Promise<never> {
  void input;
  // MOCKED: no account, key or network request exists for this integration.
  throw new Error(${tsString(`${integration.name} is mocked in this scaffold.`)});
}`,
    )
    .join("\n\n");

  return `// MOCKED INTEGRATIONS. Nothing here calls a provider. Replace each stub only
// after a real account, key and review exist.
${stubs}
`;
}

function envExample(spec: AppSpec): string {
  const lines = [
    "# Names only. Never commit values, and never put a service_role key here.",
    "# This file was generated without secrets.",
  ];
  if (spec.env_vars.length === 0) {
    lines.push("# No environment variables are required by this scaffold.");
  }
  for (const variable of spec.env_vars) {
    if (variable.startsWith("NEXT_PUBLIC_SUPABASE")) {
      lines.push(`# Public Supabase URL and anon key. RLS is what limits access.`, `${variable}=`);
    } else {
      lines.push(`# MOCKED integration. Leave blank until a real account is connected.`, `${variable}=`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function readme(spec: AppSpec, name: string): string {
  const pages = spec.pages
    .map((page) => `- \`${page.path}\` — ${page.title}: ${page.purpose}`)
    .join("\n");
  const entities = spec.entities.length
    ? spec.entities.map((entity) => `- \`${entity.name}\`: ${entity.fields.join(", ")}`).join("\n")
    : "- No data entities were specified, so no database tables were generated.";
  const integrations = spec.integrations.length
    ? spec.integrations.map((integration) => `- ${integration.name} — MOCKED (\`${integration.env_var}\`)`).join("\n")
    : "- None.";
  const checks = spec.acceptance_checks.map((check) => `- [ ] ${check}`).join("\n");
  const features = spec.features.map((feature) => `- ${feature}`).join("\n");
  const exclusions = (spec.exclusions.length ? spec.exclusions : EXCLUSIONS)
    .map((item) => `- ${item}`)
    .join("\n");

  return `# ${name}

Generated by GET TO IT from an approved specification. This is a scaffold, not a
production-ready application. Nothing was executed, installed or deployed.

## Stack

Next.js, TypeScript and Tailwind CSS${spec.supabase ? ", with Supabase for accounts and owner-only persistence" : ""}.
No other framework is supported by this generator.

## Purpose

${spec.purpose ?? ""}

## Features

${features}

## Pages

${pages}

## Data

${entities}

${spec.supabase ? "Run `supabase/migrations/0001_init.sql` in your Supabase project. It creates owner-only tables with row level security." : "No database is wired in this version."}

## Setup

1. \`npm install\`
2. Copy \`.env.example\` to \`.env.local\` and fill in values yourself. Example files here contain names only.
3. ${spec.supabase ? "Run the migration in `supabase/migrations/0001_init.sql`." : "Add authentication and a database before exposing writes."}
4. \`npm run dev\`

## External integrations

${integrations}

Every integration above is mocked. The stub in \`lib/integrations.ts\` throws a
labelled error and makes no network call. No credentials or external accounts
were invented.

## Acceptance checks

${checks}

## What is deliberately not included

${exclusions}
- No deployment, hosting or infrastructure purchase.
- No claim of production readiness.

## Security notes

${spec.authorization_rules.map((rule) => `- ${rule}`).join("\n")}
- Never add a \`service_role\` key to this project or to client code.
`;
}

function acceptanceFile(spec: AppSpec): string {
  return `# Acceptance checks

${spec.acceptance_checks.map((check) => `- [ ] ${check}`).join("\n")}

## Not claimed

- These checks have not been run by GET TO IT.
- Generated code is not evidence that the app works.
- This project has not been deployed and is not production ready.
`;
}

export function buildProjectFiles(spec: AppSpec, intake: Pick<AppIntakeInput, "name" | "purpose">): GeneratedFile[] {
  if (spec.stack !== SUPPORTED_STACK.id) {
    throw new AppBuildError("This generator only supports the Next.js, TypeScript and Tailwind stack.");
  }
  if (spec.pages.length > PROJECT_LIMITS.maxPages + 1) {
    throw new AppBuildError(`A project is limited to ${PROJECT_LIMITS.maxPages} pages.`);
  }
  if (spec.entities.length > PROJECT_LIMITS.maxEntities) {
    throw new AppBuildError(`A project is limited to ${PROJECT_LIMITS.maxEntities} data entities.`);
  }
  if (spec.integrations.length > PROJECT_LIMITS.maxIntegrations) {
    throw new AppBuildError(`A project is limited to ${PROJECT_LIMITS.maxIntegrations} integrations.`);
  }

  const files: GeneratedFile[] = [];
  const add = (filePath: string, content: string) => files.push({ path: filePath, content });

  add(
    "package.json",
    `${JSON.stringify(
      {
        name: slugify(intake.name) || "generated-app",
        private: true,
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start",
          lint: "eslint .",
          typecheck: "tsc --noEmit",
        },
        // Exact versions, matching the trusted cache the preview runner
        // mounts read-only. Changing one is refused by dependency policy.
        dependencies: {
          "@supabase/ssr": "0.12.7",
          "@supabase/supabase-js": "2.118.0",
          next: "16.4.3",
          react: "19.3.1",
          "react-dom": "19.3.1",
          zod: "4.6.7",
        },
        devDependencies: {
          "@tailwindcss/postcss": "4.3.3",
          "@types/node": "26.6.6",
          "@types/react": "19.3.0",
          "@types/react-dom": "19.3.0",
          eslint: "9.39.1",
          "eslint-config-next": "16.4.3",
          tailwindcss: "4.3.3",
          typescript: "5.9.3",
        },
      },
      null,
      2,
    )}\n`,
  );

  add(
    "tsconfig.json",
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: false,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"],
      },
      null,
      2,
    )}\n`,
  );

  add("next-env.d.ts", `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`);
  add("next.config.ts", `import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n`);
  add(
    "eslint.config.mjs",
    `import { defineConfig, globalIgnores } from "eslint/config";\nimport nextVitals from "eslint-config-next/core-web-vitals";\nimport nextTs from "eslint-config-next/typescript";\n\nexport default defineConfig([\n  ...nextVitals,\n  ...nextTs,\n  globalIgnores([".next/**", "out/**", "next-env.d.ts"]),\n]);\n`,
  );
  add(
    "postcss.config.mjs",
    `const config = { plugins: { "@tailwindcss/postcss": {} } };\n\nexport default config;\n`,
  );
  add(
    "app/globals.css",
    `@import "tailwindcss";\n\n:root {\n  color-scheme: light;\n}\n\nbody {\n  font-family: ui-sans-serif, system-ui, sans-serif;\n}\n`,
  );
  add("app/layout.tsx", layoutComponent(intake.name));
  add("app/page.tsx", homeComponent(spec));
  add("app/error.tsx", `"use client";\n\nexport default function Error({ reset }: { reset: () => void }) {\n  return (\n    <main className="mx-auto max-w-2xl px-6 py-12">\n      <h1 className="text-2xl font-bold">Something went wrong</h1>\n      <p className="mt-2 text-slate-600">The page hit an error. Your data was not changed.</p>\n      <button onClick={reset} className="mt-4 rounded-lg border px-4 py-2">Try again</button>\n    </main>\n  );\n}\n`);
  add("app/not-found.tsx", `import Link from "next/link";\n\nexport default function NotFound() {\n  return (\n    <main className="mx-auto max-w-2xl px-6 py-12">\n      <h1 className="text-2xl font-bold">Not found</h1>\n      <Link href="/" className="mt-4 inline-block underline">Back home</Link>\n    </main>\n  );\n}\n`);
  add("components/nav.tsx", navComponent(spec));

  for (const page of spec.pages.filter((item) => item.path !== "/")) {
    const route = page.path.replace(/^\//, "");
    const matching = spec.entities.find((entity) => `/${pluralize(entity.name)}` === page.path);
    add(`app/${route}/page.tsx`, pageComponent(page, matching));
  }

  const pagePaths = new Set(spec.pages.map((page) => page.path));

  for (const entity of spec.entities) {
    add(`components/${entity.name}-form.tsx`, entityForm(entity, spec.supabase));

    // A required page already covers this route when it exists; do not create
    // a second file for the same path.
    const entityPath = `/${pluralize(entity.name)}`;
    if (!pagePaths.has(entityPath)) {
      pagePaths.add(entityPath);
      add(`app/${pluralize(entity.name)}/page.tsx`, entityPage(entity, spec.supabase));
    }
  }

  if (spec.entities.length > 0) {
    add("lib/validation.ts", validationFile(spec));
  }

  if (spec.supabase && spec.entities.length > 0) {
    add(
      "lib/supabase/server.ts",
      `import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component; middleware can refresh the session.
        }
      },
    },
  });
}
`,
    );
    add("supabase/migrations/0001_init.sql", migration(spec));
  }

  for (const entity of spec.entities) {
    add(`app/api/${pluralize(entity.name)}/route.ts`, apiRoute(entity, spec.supabase));
  }

  const integrations = integrationsFile(spec);
  if (integrations) add("lib/integrations.ts", integrations);

  add(".env.example", envExample(spec));
  add("README.md", readme(spec, intake.name));
  add("ACCEPTANCE.md", acceptanceFile(spec));

  assertGenerationFits(files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// Change summaries and versions
// ---------------------------------------------------------------------------

export type FileChangeSummary = {
  added: number;
  changed: number;
  removed: number;
  summary: string;
};

export function summarizeChanges(previous: GeneratedFile[], next: GeneratedFile[]): FileChangeSummary {
  const before = new Map(previous.map((file) => [file.path, file.content]));
  const after = new Map(next.map((file) => [file.path, file.content]));

  let added = 0;
  let changed = 0;
  let removed = 0;

  for (const [path, content] of after) {
    if (!before.has(path)) added += 1;
    else if (before.get(path) !== content) changed += 1;
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removed += 1;
  }

  const parts = [`${added} added`, `${changed} changed`, `${removed} removed`];
  return {
    added,
    changed,
    removed,
    summary: `${next.length} files (${parts.join(", ")}).`,
  };
}

/** Keeps the newest `keep` versions, oldest first, after a new snapshot. */
export function keepNewestVersions<T extends { version: number }>(versions: T[], keep = PROJECT_LIMITS.versionsKept): T[] {
  return [...versions].sort((a, b) => a.version - b.version).slice(-keep);
}

export function versionSummary(previous: GeneratedFile[], next: GeneratedFile[], label: string): string {
  return `${label} ${summarizeChanges(previous, next).summary}`;
}
