import { getSession } from "@/lib/auth";
import { getAppDownloadFiles } from "@/lib/data/app-projects";
import { isUuid } from "@/lib/validation";
import { createZip, downloadFileName } from "@/lib/zip";

/**
 * Project download.
 *
 * Files are read owner-scoped, validated again by the ZIP writer, and returned
 * as a stored ZIP. Nothing outside the generated project is included, and no
 * secret is added here: `.env.example` contains names only.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!isUuid(projectId)) {
    return new Response("Not found", { status: 404 });
  }

  const session = await getSession();
  if (!session) {
    return new Response("Sign in to download this project.", { status: 401 });
  }

  const download = await getAppDownloadFiles(session, projectId);
  if (!download) {
    return new Response("Not found", { status: 404 });
  }

  if (download.files.length === 0) {
    return new Response("Generate the project before downloading it.", { status: 409 });
  }

  const archive = createZip(download.files);

  return new Response(archive.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${downloadFileName(download.project.name)}"`,
      "Content-Length": String(archive.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
