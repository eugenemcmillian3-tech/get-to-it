import { getSupabaseSettings } from "@/lib/supabase/config";

type RequestContext = {
  routePath?: string;
};

type RequestLike = {
  path?: string;
  url?: string;
  method?: string;
};

const MAX_STACK_FRAMES = 8_000;
const MAX_ROUTE_PATH = 300;

function shortString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : null;
}

function stackFrames(error: unknown): string | null {
  if (!(error instanceof Error) || typeof error.stack !== "string") {
    return null;
  }

  // The first stack line usually repeats the message, which may contain user
  // content. Keep only the call frames.
  const frames = error.stack
    .split("\n")
    .filter((line) => line.trim().startsWith("at "))
    .slice(0, 40)
    .join("\n");

  return frames.length > 0 ? frames.slice(0, MAX_STACK_FRAMES) : null;
}

/**
 * Records a sanitized unhandled server exception for the scheduled GitHub
 * issue monitor. It never sends the error message, request body, headers,
 * cookies, user id or email. Missing configuration is a no-op.
 */
export async function reportRequestException(
  error: unknown,
  request: RequestLike,
  context?: RequestContext,
): Promise<void> {
  const settings = getSupabaseSettings();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!settings || !serviceRoleKey) return;

  let requestPath = shortString(request.path, MAX_ROUTE_PATH);
  if (!requestPath && request.url) {
    try {
      requestPath = shortString(new URL(request.url).pathname, MAX_ROUTE_PATH);
    } catch {
      requestPath = null;
    }
  }

  const routePath =
    shortString(context?.routePath, MAX_ROUTE_PATH) ??
    requestPath ??
    "/unknown";
  const errorName =
    error instanceof Error
      ? shortString(error.name, 120) ?? "Error"
      : "UnknownError";
  const digestValue = (error as unknown as { digest?: unknown }).digest;
  const digest =
    typeof digestValue === "string"
      ? shortString(digestValue, 120)
      : null;

  try {
    const response = await fetch(
      `${settings.url.replace(/\/$/, "")}/rest/v1/error_events`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
          prefer: "return=minimal",
        },
        body: JSON.stringify({
          environment: shortString(
            process.env.VERCEL_ENV ?? process.env.NODE_ENV,
            40,
          ) ?? "unknown",
          release: shortString(process.env.VERCEL_GIT_COMMIT_SHA, 80),
          runtime: process.env.NEXT_RUNTIME === "edge" ? "edge" : "nodejs",
          route_path: routePath,
          method: shortString(request.method, 12) ?? "UNKNOWN",
          error_name: errorName,
          digest,
          stack_frames: stackFrames(error),
        }),
        signal: AbortSignal.timeout(2_000),
      },
    );

    if (!response.ok) {
      console.error("error_events insert failed:", response.status);
    }
  } catch {
    // Monitoring must never replace or mask the original exception.
    console.error("error_events insert failed: network");
  }
}
