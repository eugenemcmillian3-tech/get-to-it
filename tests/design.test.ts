import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_CONFIG,
  DESIGN_CSS_END,
  DESIGN_CSS_START,
  buildDesignFiles,
  buildDesignCss,
  checkAccessibility,
  contrastRatio,
  diffFiles,
  normaliseDesignConfig,
  parseSections,
  upsertDesignCss,
} from "@/lib/design";
import { activeContentProblem, detectRasterMime, validateAssetBytes } from "@/lib/design-assets";
import type { AppSpec } from "@/lib/app-builder";

const SPEC: AppSpec = {
  stack: "nextjs-typescript-tailwind",
  purpose: "A drill app.",
  features: ["Keep a list"],
  exclusions: [],
  pages: [
    { path: "/", title: "Home", purpose: "Start here." },
    { path: "/items", title: "Items", purpose: "See items." },
  ],
  navigation: [{ label: "Home", href: "/" }],
  entities: [{ name: "item", fields: ["title", "notes"] }],
  server_operations: [{ entity: "item", operations: ["list", "create"] }],
  authorization_rules: ["Owners only."],
  integrations: [],
  env_vars: [],
  acceptance_checks: ["It works."],
  supabase: true,
  design_preferences: "",
  definition_of_done: "Useful.",
};

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
}

describe("design contract", () => {
  it("starts with a valid, readable default configuration", () => {
    expect(DEFAULT_DESIGN_CONFIG.brief.length).toBeGreaterThan(20);
    expect(contrastRatio(DEFAULT_DESIGN_CONFIG.colors.text, DEFAULT_DESIGN_CONFIG.colors.background)).toBeGreaterThan(4.5);
    expect(DEFAULT_DESIGN_CONFIG.sections).toContain("states");
  });

  it("normalises unknown values instead of trusting stored JSON", () => {
    const config = normaliseDesignConfig({
      brief: "x".repeat(5000),
      colors: { text: "red", primary: "#123456" },
      typography: { sans: "comic", base_size: 99, line_height: 0 },
      spacing: "huge",
      variant: "round",
      sections: ["hero", "hero", "nonsense"],
      text: { headline: "" },
    });

    expect(config.colors.text).toBe(DEFAULT_DESIGN_CONFIG.colors.text);
    expect(config.colors.primary).toBe("#123456");
    expect(config.typography.sans).toBe("system");
    expect(config.typography.base_size).toBe(16);
    expect(config.spacing).toBe("comfortable");
    expect(config.variant).toBe("soft");
    expect(config.sections).toEqual(["hero"]);
    expect(config.brief.length).toBe(4000);
  });

  it("parses only known section ids in the order given", () => {
    expect(parseSections("states, hero, states, nope, data")).toEqual(["states", "hero", "data"]);
    expect(parseSections("")).toEqual([]);
  });

  it("generates tokens including focus, reduced motion and responsive rules", () => {
    const css = buildDesignCss({ ...DEFAULT_DESIGN_CONFIG, variant: "sharp", spacing: "spacious" });
    expect(css).toContain("--design-radius: 0.25rem");
    expect(css).toContain("--design-space: 1.5rem");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("@media (max-width: 640px)");
  });

  it("preserves CSS outside the marked block and replaces only the block", () => {
    const existing = `@import "tailwindcss";\n.custom { color: red; }\n\n${DESIGN_CSS_START}\nold\n${DESIGN_CSS_END}\n.footer { color: blue; }\n`;
    const next = upsertDesignCss(existing, "new-token: 1;");
    expect(next).toContain(".custom { color: red; }");
    expect(next).toContain(".footer { color: blue; }");
    expect(next).toContain("new-token: 1;");
    expect(next).not.toContain("old\n");
  });

  it("builds only the bounded design files and includes real routes/entities", () => {
    const globals = `@import "tailwindcss";\n.keep { color: red; }\n`;
    const files = buildDesignFiles(SPEC, DEFAULT_DESIGN_CONFIG, [], globals);
    expect(files.map((file) => file.path)).toEqual([
      "app/globals.css",
      "components/design/ui.tsx",
      "lib/design-manifest.ts",
      "app/design-preview/page.tsx",
      "DESIGN.md",
    ]);
    expect(files.find((file) => file.path === "app/globals.css")?.content).toContain(".keep");
    expect(files.find((file) => file.path === "lib/design-manifest.ts")?.content).toContain("/items");
    expect(files.some((file) => file.path.includes("api/"))).toBe(false);
  });

  it("runs static accessibility checks without claiming a complete audit", () => {
    const files = buildDesignFiles(SPEC, DEFAULT_DESIGN_CONFIG, [], `@import "tailwindcss";\n`);
    const checks = checkAccessibility(DEFAULT_DESIGN_CONFIG, files);
    expect(checks.find((check) => check.id === "contrast")?.status).toBe("pass");
    expect(checks.find((check) => check.id === "labels")?.status).toBe("pass");
    expect(checks.find((check) => check.id === "audit")?.status).toBe("warn");
    expect(checks.find((check) => check.id === "audit")?.detail).toContain("not a complete");
  });

  it("shows a bounded diff and ignores unchanged files", () => {
    const before = [{ path: "README.md", content: "same" }];
    const after = [
      { path: "README.md", content: "same" },
      { path: "DESIGN.md", content: "new" },
    ];
    const diff = diffFiles(before, after);
    expect(diff).toContain("new file DESIGN.md");
    expect(diff).not.toContain("README.md");
  });
});

describe("design asset safety", () => {
  it("accepts a genuine PNG and records a hash and license notes", () => {
    const asset = validateAssetBytes({
      name: "reference.png",
      declaredType: "image/png",
      bytes: pngBytes(),
      attribution: "Own screenshot",
      licenseNote: "Owner supplied",
      permissionConfirmed: true,
    });
    expect(asset.mime).toBe("image/png");
    expect(asset.sha256).toHaveLength(64);
    expect(asset.attribution).toBe("Own screenshot");
    expect(asset.content_base64).toContain("iVBORw0KGgo");
  });

  it("refuses SVG and HTML as active content", () => {
    expect(activeContentProblem(new TextEncoder().encode("<svg><script>alert(1)</script></svg>"), "image/svg+xml")).toContain("active content");
    expect(activeContentProblem(new TextEncoder().encode("<html>hi</html>"), "text/html")).toContain("active content");
    expect(() =>
      validateAssetBytes({
        name: "bad.svg",
        declaredType: "image/svg+xml",
        bytes: new TextEncoder().encode("<svg></svg>"),
        attribution: "",
        licenseNote: "",
        permissionConfirmed: true,
      }),
    ).toThrow(/SVG|active/i);
  });

  it("refuses a mismatched declared type, unknown bytes and missing permission", () => {
    expect(detectRasterMime(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(() =>
      validateAssetBytes({
        name: "fake.png",
        declaredType: "image/png",
        bytes: new TextEncoder().encode("not a png"),
        attribution: "",
        licenseNote: "",
        permissionConfirmed: true,
      }),
    ).toThrow(/genuine PNG/);
    expect(() =>
      validateAssetBytes({
        name: "a.jpg",
        declaredType: "image/png",
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]),
        attribution: "",
        licenseNote: "",
        permissionConfirmed: true,
      }),
    ).toThrow(/declared type/i);
    expect(() =>
      validateAssetBytes({
        name: "a.png",
        declaredType: "image/png",
        bytes: pngBytes(),
        attribution: "",
        licenseNote: "",
        permissionConfirmed: false,
      }),
    ).toThrow(/permission/);
  });
});
