import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getSupabaseAccountAccess } from "@/lib/deploy/supabase-account";
import { listSupabaseProjects } from "@/lib/deploy/supabase-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** List projects in one organization, using the server-held OAuth token. */
export async function GET(request: NextRequest) {
  const org = request.nextUrl.searchParams.get("org") ?? "";
  if (!/^[a-z0-9-]{1,64}$/i.test(org)) {
    return NextResponse.json({ error: "Choose a valid Supabase organization." }, { status: 400, headers: NO_STORE });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in again to continue." }, { status: 401, headers: NO_STORE });
  }

  try {
    const account = await getSupabaseAccountAccess(session);
    const projects = (await listSupabaseProjects({ accessToken: account.accessToken }))
      .filter((project) => project.organization_slug === org)
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ projects }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Supabase projects could not be read.";
    return NextResponse.json({ error: message.slice(0, 500) }, { status: 502, headers: NO_STORE });
  }
}
