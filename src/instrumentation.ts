import type { Instrumentation } from "next";

import { reportRequestException } from "@/lib/observability/report-exception";

/**
 * Next.js calls this for unhandled errors in server components, route
 * handlers, server actions and middleware. The reporter stores a sanitized
 * record so the scheduled GitHub issue monitor can alert on it.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  await reportRequestException(error, request, context);
};
