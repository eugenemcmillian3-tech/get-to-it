import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS_DIR = join(process.cwd(), "src/lib/actions");
const ALLOWED_EXPORT = /^export\s+(async\s+function\b|type\b|interface\b|\{\s*type\b)/;

describe("server action modules", () => {
  it("only export async functions and types", () => {
    const violations: string[] = [];

    for (const file of readdirSync(ACTIONS_DIR).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(join(ACTIONS_DIR, file), "utf8");
      if (!/^\s*["']use server["'];?\s*$/m.test(source)) continue;

      source.split(/\r?\n/).forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("export ")) return;
        if (ALLOWED_EXPORT.test(trimmed)) return;
        violations.push(`${file}:${index + 1}: ${trimmed}`);
      });
    }

    expect(violations).toEqual([]);
  });
});
