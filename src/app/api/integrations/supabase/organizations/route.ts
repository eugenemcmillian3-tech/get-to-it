import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSupabaseAccountAccess } from "@/lib/deploy/supabase-account";
import { listSupabaseOrganizations } from "@/lib/deploy/supabase-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** List the organizations the connected Supabase account can access. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in again to continue." }, { status: 401, headers: NO_STORE });
  }

  try {
    const account = await getSupabaseAccountAccess(session);
    const organizations = await listSupabaseOrganizations({ accessToken: account.accessToken });
    return NextResponse.json({ organizations }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Supabase account could not be read.";
    return NextResponse.json({ error: message.slice(0, 500) }, { status: 502, headers: NO_STORE });
  }
}
