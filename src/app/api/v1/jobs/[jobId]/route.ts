import { apiErrorResponse, apiJson } from "@/lib/api/http";
import { cancelJob, getJob } from "@/lib/api/operations";
import { apiSupabase, bearerToken, hashApiToken } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    const keyHash = hashApiToken(bearerToken(request));
    const data = await getJob(apiSupabase(), keyHash, jobId);
    return apiJson(data, { requestId: String(data.request_id ?? "") });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Cancels a queued job. A running deterministic build finishes; it is bounded. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    const keyHash = hashApiToken(bearerToken(request));
    const data = await cancelJob(apiSupabase(), keyHash, jobId);
    return apiJson(data, { requestId: String(data.request_id ?? "") });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
