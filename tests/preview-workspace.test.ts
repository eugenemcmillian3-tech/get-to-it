import { describe, expect, it } from "vitest";
import {
  PREVIEW_LIMITS,
  applyRepairPatch,
  assertRepairPatch,
  buildRepairMessages,
  diffFiles,
  isRepairPath,
  parseRepairPatch,
  previewToken,
  previewUrl,
  type PreviewConfig,
} from "@/lib/preview-workspace";

const config: PreviewConfig = {
  runnerUrl: "http://127.0.0.1:4311",
  runnerToken: "t".repeat(32),
  signingSecret: "s".repeat(32),
  publicOrigin: "https://preview.example.com",
};

const files = [
  { path: "app/page.tsx", content: "export default function Page(){return <p>ok</p>}\n" },
  { path: "lib/data.ts", content: "export const value = 1;\n" },
  { path: "tests/example.test.ts", content: "expect(1).toBe(1);\n" },
  { path: "package.json", content: '{"scripts":{}}\n' },
];

describe("preview links", () => {
  it("puts the project on its own host and signs an expiring token", () => {
    const url = new URL(previewUrl(config, { key: "a".repeat(32), projectId: "p", userId: "u" }));
    expect(url.host).toBe(`${"a".repeat(32)}.preview.example.com`);
    expect(url.pathname).toBe("/");
    const token = url.searchParams.get("token")!;
    const [body, signature] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    expect(payload.k).toBe("a".repeat(32));
    expect(payload.p).toBe("p");
    expect(payload.u).toBe("u");
    expect(payload.exp).toBeGreaterThan(Date.now());
    expect(signature).toHaveLength(43);
    expect(token).not.toContain(config.signingSecret);
  });

  it("creates a different token per project", () => {
    const a = previewToken(config, { key: "a".repeat(32), projectId: "one", userId: "u" });
    const b = previewToken(config, { key: "a".repeat(32), projectId: "two", userId: "u" });
    expect(a).not.toBe(b);
  });
});

describe("repair boundary", () => {
  it("allows only existing source files", () => {
    expect(isRepairPath("app/page.tsx")).toBe(true);
    expect(isRepairPath("components/form.tsx")).toBe(true);
    expect(isRepairPath("lib/data.ts")).toBe(true);
    expect(isRepairPath("tests/example.test.ts")).toBe(false);
    expect(isRepairPath("package.json")).toBe(false);
    expect(isRepairPath("tsconfig.json")).toBe(false);
    expect(isRepairPath("eslint.config.mjs")).toBe(false);
    expect(isRepairPath("next.config.ts")).toBe(false);
    expect(isRepairPath("app/../secrets.ts")).toBe(false);
    expect(isRepairPath(".env.local")).toBe(false);
  });

  it("refuses tests, config, new files and traversal", () => {
    for (const path of [
      "tests/example.test.ts",
      "package.json",
      "app/../secret.ts",
      "app/new-file.ts",
      ".env.local",
    ]) {
      expect(() =>
        assertRepairPatch(files, {
          summary: "try a forbidden change",
          files: [{ path, content: "x" }],
        }),
      ).toThrow();
    }
  });

  it("applies only replacements and reports the changed files", () => {
    const patch = {
      summary: "Fix the page copy",
      files: [{ path: "app/page.tsx", content: "export default function Page(){return <p>fixed</p>}\n" }],
    };
    const applied = applyRepairPatch(files, patch);
    expect(applied.changed).toEqual(["app/page.tsx"]);
    expect(applied.files.find((file) => file.path === "app/page.tsx")!.content).toContain("fixed");
    expect(applied.files).toHaveLength(files.length);
    expect(applied.files.find((file) => file.path === "tests/example.test.ts")!.content).toContain("expect");
  });

  it("parses one fenced JSON object and rejects prose", () => {
    const parsed = parseRepairPatch(
      '```json\n{"summary":"A real fix","files":[{"path":"lib/data.ts","content":"export const value = 2;"}]}\n```',
    );
    expect(parsed.files[0].path).toBe("lib/data.ts");
    expect(() => parseRepairPatch("I cannot fix this.")).toThrow(/JSON/);
  });

  it("shows a bounded diff without rewriting files", () => {
    const after = files.map((file) =>
      file.path === "lib/data.ts" ? { ...file, content: "export const value = 2;\nexport const extra = 3;\n" } : file,
    );
    const result = diffFiles(files, after);
    expect(result.changed).toEqual(["lib/data.ts"]);
    expect(result.diff).toContain("-export const value = 1;");
    expect(result.diff).toContain("+export const value = 2;");
    expect(result.diff).toContain("+export const extra = 3;");
  });
});

describe("repair prompt", () => {
  it("includes the failure and source, but excludes tests and package files", () => {
    const messages = buildRepairMessages(files, {
      name: "typecheck",
      label: "Typecheck",
      status: "failed",
      code: 2,
      log: "error TS2322: Type 'string' is not assignable to type 'number'.",
    }, 0);

    const text = messages.map((message) => message.content).join("\n");
    expect(text).toContain("error TS2322");
    expect(text).toContain("app/page.tsx");
    expect(text).not.toContain("expect(1).toBe(1)");
    expect(text).not.toContain('"scripts"');
    expect(messages[0].content).toContain("Never delete a test");
    expect(messages[0].content).toContain("Return full file contents");
  });

  it("keeps the configured bounds in one place", () => {
    expect(PREVIEW_LIMITS.maxRepairIterations).toBe(2);
    expect(PREVIEW_LIMITS.maxAiRequests).toBe(2);
    expect(PREVIEW_LIMITS.maxRuntimeMs).toBe(600_000);
    expect(PREVIEW_LIMITS.maxLogChars).toBe(200_000);
  });
});
