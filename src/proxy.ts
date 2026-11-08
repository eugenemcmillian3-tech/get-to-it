import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseSettings } from "@/lib/supabase/config";

// Every prefix here is signed-in only, and every page under it also gates
// itself with requireSession. This list is the outer layer, so a page added
// under one of them cannot serve content to a signed-out visitor just because
// it forgot the check. /api, /auth and /share are deliberately absent: their
// route handlers authenticate themselves, and share links are public by
// design. A new signed-in-only area belongs in this list.
const PROTECTED_PREFIXES = [
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
const AUTH_PAGES = ["/sign-in", "/sign-up"];

export async function proxy(request: NextRequest) {
  const settings = getSupabaseSettings();
  if (!settings) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(settings.url, settings.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

  if (!user && isProtected) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/sign-in";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && AUTH_PAGES.includes(path)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
