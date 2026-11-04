import { NextResponse } from "next/server";
import { completeConnection } from "@/lib/composio/adapter";
import { getAppOrigin } from "@/lib/composio/sdk";
import { getSession } from "@/lib/auth";
import { isUuid } from "@/lib/validation";

/**
 * Composio authorization callback.
 *
 * Provider query parameters are not proof of ownership. The attempt id, its
 * stored one-time state, the signed-in user and the provider's own account
 * owner are all verified before a connection is saved. The redirect target is
 * always this app's connections page; no user-supplied destination is used.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(path: string, request: Request): NextResponse {
  const base = getAppOrigin() ?? new URL(request.url).origin;
  return NextResponse.redirect(new URL(path, base));
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return back("/?composio=signin", request);
  }

  const url = new URL(request.url);
  const attemptId = url.searchParams.get("attempt") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const providerStatus = (url.searchParams.get("status") ?? "").toLowerCase();
  const connectedAccountId = url.searchParams.get("connected_account_id") ?? "";

  if (!isUuid(attemptId) || !/^[a-f0-9]{64}$/.test(state)) {
    return back("/build?composio=invalid_callback", request);
  }

  try {
    const result = await completeConnection(session, {
      attemptId,
      state,
      providerStatus,
      connectedAccountId,
    });

    if (!result.projectId) {
      return back("/build?composio=invalid_callback", request);
    }

    const target = `/build/${result.projectId}/connections`;
    if (result.ok) {
      return back(`${target}?composio=${result.status}`, request);
    }
    return back(`${target}?composio=failed`, request);
  } catch {
    return back("/build?composio=failed", request);
  }
}
