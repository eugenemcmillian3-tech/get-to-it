import * as Sentry from "@sentry/nextjs";

/**
 * Next.js loads this file once per server runtime. The Sentry configs are
 * intentionally no-ops until the deployment has a DSN.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/** Capture unhandled Server Component, route-handler and middleware errors. */
export const onRequestError = Sentry.captureRequestError;
