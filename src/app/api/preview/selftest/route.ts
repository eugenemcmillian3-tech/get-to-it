import { NextResponse } from "next/server";
import { secretsMatch } from "@/lib/cron-auth";
import {
  createRenderSandboxClient,
  getSandboxConfig,
  runSandboxChecks,
  SandboxUnavailableError,
} from "@/lib/preview-sandbox";

/**
 * Render Sandboxes self-test.
 *
 * Proves the deployed backend end to end without a signed-in user: it uploads a
 * tiny fixture project to a real sandbox, runs the same fixed command policy the
 * workspace uses, and reports each check's exit code and the wall time. No user
 * data is involved and the fixture is a constant of this module, so the endpoint
 * cannot be used to run arbitrary code.
 *
 * Requires `Authorization: Bearer $PREVIEW_SELFTEST_TOKEN`. With the variable
 * unset the route is disabled and refuses everything — the same fail-closed rule
 * the cron routes follow.
 *
 * `?case=failing` swaps in a deliberately wrong assertion so the failure path
 * can be observed as a non-zero exit code rather than assumed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PACKAGE_JSON = `{
  "name": "sandbox-selftest",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test lib/sum.test.mjs" },
  "dependencies": {
    "next": "15.1.6",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@eslint/js": "9.18.0",
    "@types/node": "22.10.7",
    "@types/react": "19.0.7",
    "eslint": "9.18.0",
    "typescript": "5.7.3"
  }
}
`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "allowJs": true,
    "checkJs": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["**/*.ts", "**/*.tsx", "lib/**/*.js"],
  "exclude": ["node_modules", ".next"]
}
`;

const ESLINT_CONFIG = `import js from "@eslint/js";

export default [
  { ignores: [".next/**", "node_modules/**"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
  },
];
`;

const LAYOUT_TSX = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

const PAGE_TSX = `export default function Page() {
  return <main>sandbox self-test</main>;
}
`;

const SUM_JS = `/** @param {number[]} values */
export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
`;

const PASSING_TEST = `import test from "node:test";
import assert from "node:assert/strict";
import { sum } from "./sum.js";

test("adds numbers", () => {
  assert.equal(sum([1, 2, 3]), 6);
});
`;

const FAILING_TEST = `import test from "node:test";
import assert from "node:assert/strict";
import { sum } from "./sum.js";

test("adds numbers", () => {
  assert.equal(sum([1, 2, 3]), 7);
});
`;

const FIXTURE: { path: string; content: string }[] = [
  { path: "package.json", content: PACKAGE_JSON },
  { path: "tsconfig.json", content: TSCONFIG_JSON },
  { path: "eslint.config.mjs", content: ESLINT_CONFIG },
  { path: "app/layout.tsx", content: LAYOUT_TSX },
  { path: "app/page.tsx", content: PAGE_TSX },
  { path: "lib/sum.js", content: SUM_JS },
  { path: "lib/sum.test.mjs", content: PASSING_TEST },
];

function refuse(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const token = process.env.PREVIEW_SELFTEST_TOKEN?.trim();
  if (!token) {
    return refuse("PREVIEW_SELFTEST_TOKEN is not set, so the sandbox self-test is disabled.", 503);
  }

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || !secretsMatch(header.slice("Bearer ".length), token)) {
    return refuse("Unauthorized.", 401);
  }

  const config = getSandboxConfig();
  if (!config) {
    return refuse("Render Sandboxes is not configured on this server.", 503);
  }

  const failing = new URL(request.url).searchParams.get("case") === "failing";
  const files = failing
    ? FIXTURE.map((file) => (file.path === "lib/sum.test.mjs" ? { path: file.path, content: FAILING_TEST } : file))
    : FIXTURE;

  try {
    const client = await createRenderSandboxClient(config);
    const result = await runSandboxChecks(config, client, files);
    return NextResponse.json(
      {
        ok: true,
        case: failing ? "failing" : "passing",
        status: result.status,
        wall_ms: result.durationMs,
        checks: result.checks.map((check) => ({
          name: check.name,
          label: check.label,
          status: check.status,
          exit_code: check.code,
          log_chars: check.log.length,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof SandboxUnavailableError
        ? error.message
        : "The Render sandbox could not complete the self-test.";
    return refuse(message, 502);
  }
}
