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

describe("proxy build gate", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("redirects a signed-out visitor from every build path to sign-in with a return path", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    for (const path of ["/build", `/build/${PROJECT_ID}`, `/build/${PROJECT_ID}/team`, `/build/${PROJECT_ID}/deploy`]) {
      const result = await visit(path);
      expect(result.kind, path).toBe("redirect");
      expect(result.location, path).toContain("/sign-in");
      expect(nextTarget(result.location), path).toBe(path);
    }
  });

  it("still redirects signed-out visitors from the previously protected prefixes", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    for (const path of ["/dashboard", "/goals", "/goals/123"]) {
      const result = await visit(path);
      expect(result.kind, path).toBe("redirect");
      expect(nextTarget(result.location), path).toBe(path);
    }
  });

  it("lets a signed-in visitor through the build gate", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    for (const path of ["/build", `/build/${PROJECT_ID}/team`]) {
      expect((await visit(path)).kind, path).toBe("next");
    }
  });

  it("does not gate sign-in for a signed-out visitor or the public home page", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    for (const path of ["/sign-in", "/", "/sign-up"]) {
      expect((await visit(path)).kind, path).toBe("next");
    }
  });

  it("does not treat a path that merely starts with the word build as protected", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    for (const path of ["/builder", "/builds"]) {
      expect((await visit(path)).kind, path).toBe("next");
    }
  });
});
