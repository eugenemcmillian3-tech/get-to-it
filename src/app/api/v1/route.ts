import { API_PREFIX, API_SCOPES, API_VERSION, SCOPE_LABELS } from "@/lib/api/contracts";
import { apiErrorResponse, apiJson } from "@/lib/api/http";

export const runtime = "nodejs";

/** Public capability and version information. No credential is required. */
export function GET() {
  try {
    return apiJson({
      api: "GET TO IT developer API",
      version: API_VERSION,
      prefix: API_PREFIX,
      authentication: "Bearer project API key. Create one on the project's API page.",
      scopes: API_SCOPES.map((scope) => ({ scope, description: SCOPE_LABELS[scope] })),
      documentation: "/docs/developer-api.md",
      limits: {
        rate_limit: "Per credential, configured at creation (1–600 requests per minute).",
        artifacts_page_size: 60,
        page_size: 50,
        idempotency:
          "POST operations require an Idempotency-Key header of 8–128 letters, digits, underscores or dashes.",
      },
      boundaries: [
        "No shell, container or arbitrary code execution.",
        "No credit spending and no AI allowance bypass.",
        "Deployment proposals are drafts; approval stays in the web app.",
      ],
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
