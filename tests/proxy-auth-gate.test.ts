import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/supabase/config", () => ({
  getSupabaseSettings: () => ({ url: "https://project.supabase.co", anonKey: "anon-key" }),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => ({ kind: "next" })),
    redirect: vi.fn((url: URL) => ({ kind: "redirect", location: url.toString() })),
  },
}));

import { proxy } from "@/proxy";

const PROJECT_ID = "5423c8a0-a8ad-473c-a7bb-b4f71b2e38b1";

/** Every signed-in-only area the proxy must cover. */
const GATED_PREFIXES = [
  "/billing",
  "/build",
  "/credits",
  "/dashboard",
  "/data",
  "/evaluations",
  "/futures",
  "/goals",
  "/outcomes",
  "/owner",
  "/partner",
  "/plan",
  "/radar",
  "/reminders",
  "/reviews",
  "/settings",
  "/templates",
  "/workflows",
  "/workspace",
];

/** Areas that must stay reachable without a session. */
const PUBLIC_PATHS = [
  "/",
  "/sign-in",
  "/sign-up",
  "/share/abc123",
  "/api/health",
  "/auth/callback",
  "/builder",
  "/builds",
];

/** A URL view with accessors, so `redirectUrl.pathname = …` mutates the same URL. */
function viewFor(url: URL) {
  return {
    get pathname() {
      return url.pathname;
    },
    set pathname(value: string) {
      url.pathname = value;
    },
    get search() {
      return url.search;
    },
    set search(value: string) {
      url.search = value;
    },
    get searchParams() {
      return url.searchParams;
    },
    toString: () => url.toString(),
  };
}

function requestFor(path: string) {
  const url = new URL(`https://get-to-it.test${path}`);
  const nextUrl = viewFor(url) as ReturnType<typeof viewFor> & { clone: () => ReturnType<typeof viewFor> };
  nextUrl.clone = () => viewFor(url);
  return { nextUrl, cookies: { getAll: () => [], set: () => undefined } };
}

async function visit(path: string) {
  return (await proxy(requestFor(path) as never)) as unknown as { kind: string; location?: string };
}

function nextTarget(location: string | undefined) {
  return new URL(location ?? "").searchParams.get("next");
}

describe("proxy authentication gate", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("redirects a signed-out visitor from every gated prefix, root and nested path", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    for (const prefix of GATED_PREFIXES) {
      for (const path of [prefix, `${prefix}/example`, `${prefix}/${PROJECT_ID}/team`]) {
        const result = await visit(path);
        expect(result.kind, path).toBe("redirect");
        expect(result.location, path).toContain("/sign-in");
        expect(nextTarget(result.location), path).toBe(path);
      }
    }
  });

  it("leaves public pages, share links and API routes reachable", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    for (const path of PUBLIC_PATHS) {
      expect((await visit(path)).kind, path).toBe("next");
    }
  });

  it("lets a signed-in visitor through every gated prefix", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    for (const prefix of GATED_PREFIXES) {
      expect((await visit(prefix)).kind, prefix).toBe("next");
    }
  });

  it("sends a signed-in visitor from the auth pages to the dashboard", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    for (const path of ["/sign-in", "/sign-up"]) {
      const result = await visit(path);
      expect(result.kind, path).toBe("redirect");
      expect(result.location, path).toContain("/dashboard");
    }
  });

  it("does not gate a path that merely starts with a protected name", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    for (const path of ["/builds", "/builder", "/workflows-archive", "/settings-old"]) {
      expect((await visit(path)).kind, path).toBe("next");
    }
  });
});
