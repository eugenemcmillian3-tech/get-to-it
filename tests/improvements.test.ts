import { describe, expect, it } from "vitest";
import {
  CHANGE_LIMITS,
  buildChangePlan,
  changeSlug,
  clarifyChange,
  containsSecret,
  errorFingerprint,
  evaluationTotals,
  implementFixture,
  inspectProject,
  redactError,
  skillFromPlan,
  type ChangeInput,
} from "@/lib/improvements";

const files = [
  { path: "app/page.tsx", content: "export default function Home(){return <main>Existing home</main>}" },
  { path: "app/layout.tsx", content: "export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}" },
  { path: "components/nav.tsx", content: 'import Link from "next/link";\nexport function Nav(){return <nav className="flex flex-wrap gap-4"><Link href="/">Home</Link></nav>}' },
  { path: "package.json", content: JSON.stringify({ scripts: { typecheck: "tsc --noEmit", lint: "eslint .", test: "vitest run", build: "next build" }, dependencies: { next: "16.4.3" } }) },
  { path: ".env.example", content: "NEXT_PUBLIC_API_URL=\n" },
];

function input(overrides: Partial<ChangeInput> = {}): ChangeInput {
  return { files, kind: "dashboard", request: "Add a dashboard showing the next useful step and recent work.", ...overrides };
}

describe("incremental change planning", () => {
  it("inspects routes, navigation and test commands without secrets", () => {
    const inspection = inspectProject(files);
    expect(inspection.routes).toContain("/");
    expect(inspection.has_navigation).toBe(true);
    expect(inspection.test_commands.join(" ")).toContain("typecheck");
    expect(inspection.env_names).toContain("NEXT_PUBLIC_API_URL");
    expect(JSON.stringify(inspection)).not.toContain("secret-value");
  });

  it("asks for clarification when a request is too vague", () => {
    expect(clarifyChange(input({ request: "fix it" }))).toContain("What exactly should be different, and where?");
  });

  it("plans no more than the bounded file limit and preserves the existing tree", () => {
    const plan = buildChangePlan(input());
    expect(plan.files.length).toBeLessThanOrEqual(CHANGE_LIMITS.maxFiles);
    expect(plan.steps.length).toBeLessThanOrEqual(CHANGE_LIMITS.maxPlanSteps);
    const implemented = implementFixture(files, plan);
    expect(implemented.files.find((file) => file.path === "app/page.tsx")?.content).toBe(files[0].content);
    expect(implemented.files.find((file) => file.path === "app/layout.tsx")?.content).toBe(files[1].content);
    expect(implemented.files.find((file) => file.path === "app/dashboard/page.tsx")?.content).toContain("Dashboard");
    expect(implemented.files.find((file) => file.path === "components/nav.tsx")?.content).toContain('href="/dashboard"');
    expect(implemented.changed.length).toBeLessThanOrEqual(CHANGE_LIMITS.maxFiles);
    expect(implemented.diff).toContain("app/dashboard/page.tsx");
  });

  it("updates an existing navigation component for mobile without replacing it", () => {
    const plan = buildChangePlan(input({ kind: "mobile_navigation", request: "Make the navigation easier to use on a small phone." }));
    const result = implementFixture(files, plan);
    expect(result.changed).toEqual(["components/nav.tsx"]);
    expect(result.files.find((file) => file.path === "app/page.tsx")?.content).toBe(files[0].content);
    expect(result.files.find((file) => file.path === "components/nav.tsx")?.content).toContain('aria-label="Main navigation"');
  });

  it("adds a bounded integration stub without a network call", () => {
    const plan = buildChangePlan(input({ kind: "integration", request: "Add the astronomy API integration." }));
    const result = implementFixture(files, plan);
    const route = result.files.find((file) => file.path.startsWith("app/api/integrations/"));
    expect(route?.content).toContain("contacts no external service");
    expect(route?.content).toContain("501");
    expect(result.files.find((file) => file.path === "app/page.tsx")?.content).toBe(files[0].content);
  });

  it("refuses secret-like project memory text", () => {
    expect(containsSecret("token: ghp_abcdefghijklmnopqrstuvwxyz123456")).toBe(true);
    expect(containsSecret("postgresql://user:password@db.example.test:5432/app")).toBe(true);
    expect(containsSecret("Test command: npm run typecheck")).toBe(false);
  });

  it("redacts selected errors and keeps a stable fingerprint", () => {
    const redacted = redactError(
      "User user@example.test from 192.168.1.4 failed with Bearer abcdefghijklmnop and postgresql://user:pass@db.example.test/app",
    );
    expect(redacted.text).not.toContain("user@example.test");
    expect(redacted.text).not.toContain("192.168.1.4");
    expect(redacted.text).not.toContain("abcdefghijklmnop");
    expect(redacted.redactions).toBeGreaterThan(0);
    expect(errorFingerprint("failed at row 123 for id 11111111-1111-4111-8111-111111111111"))
      .toBe(errorFingerprint("failed at row 999 for id 22222222-2222-4222-8222-222222222222"));
  });

  it("creates versioned skills without deployment or install permissions", () => {
    const plan = buildChangePlan(input());
    const skill = skillFromPlan("11111111-1111-4111-8111-111111111111", plan, {
      name: "Dashboard increment",
      purpose: "Add a bounded dashboard route.",
      inputs: ["Current files"],
      outputs: ["Dashboard page"],
      tests: ["typecheck", "build"],
      limitations: ["Fixture implementation"],
    });
    expect(skill.required_permissions).not.toContain("deploy");
    expect(skill.required_permissions).not.toContain("install_tools");
    expect(skill.tests).toEqual(plan.tests);
    expect(() =>
      skillFromPlan("11111111-1111-4111-8111-111111111111", plan, {
        name: "Bad",
        purpose: "Contains ghp_abcdefghijklmnopqrstuvwxyz123456",
        inputs: [],
        outputs: [],
        tests: [],
        limitations: [],
      }),
    ).toThrow(/credentials|secret/i);
  });

  it("reports evaluation facts without treating output volume as success", () => {
    const totals = evaluationTotals([
      { accepted: true, rejected: false, tests_passed: true, regression_count: 0, runtime_seconds: 20, ai_calls: 0 },
      { accepted: false, rejected: true, tests_passed: false, regression_count: 1, runtime_seconds: 5, ai_calls: 0 },
    ]);
    expect(totals).toEqual({ accepted: 1, rejected: 1, tests_passed: 1, regressions: 1, runtime_seconds: 25, ai_calls: 0 });
  });

  it("creates a safe slug and rejects unsafe paths from the fixture", () => {
    expect(changeSlug("Add a Dashboard!")).toBe("add-a-dashboard");
    expect(changeSlug("!!!")).toBe("change");
    expect(() => implementFixture(files, { ...buildChangePlan(input()), files: [{ path: "../outside.ts", action: "add", reason: "bad" }] })).toThrow(/unsafe/i);
  });
});
