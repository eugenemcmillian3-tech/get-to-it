import { getSession } from "@/lib/auth";
import { getProjectModelWorkspace } from "@/lib/data/project-model";
import { diffProjectModels, formatProjectModelChangelog } from "@/lib/project-model";
import { isUuid } from "@/lib/validation";

function versionParam(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Downloads a selected project-model comparison as Markdown.
 *
 * The workspace read is owner-scoped in the data layer and by RLS. Only stored
 * snapshots are compared, so the export cannot include uncommitted file changes
 * or runtime observations. The filename is built from validated integers.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  if (!isUuid(projectId)) {
    return new Response("Not found", { status: 404 });
  }

  const session = await getSession();
  if (!session) {
    return new Response("Sign in to download this changelog.", { status: 401 });
  }

  const workspace = await getProjectModelWorkspace(session, projectId);
  if (!workspace) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const requestedFrom = versionParam(url.searchParams.get("from"));
  const requestedTo = versionParam(url.searchParams.get("to"));
  if (!requestedFrom || !requestedTo) {
    return new Response("Choose two model versions.", { status: 400 });
  }

  const selectedFrom = workspace.models.find((model) => model.version === requestedFrom);
  const selectedTo = workspace.models.find((model) => model.version === requestedTo);
  if (!selectedFrom || !selectedTo) {
    return new Response("That model version was not found.", { status: 404 });
  }
  if (selectedFrom.version === selectedTo.version) {
    return new Response("Choose two different model versions.", { status: 400 });
  }

  const [from, to] =
    selectedFrom.version < selectedTo.version
      ? [selectedFrom, selectedTo]
      : [selectedTo, selectedFrom];

  const markdown = formatProjectModelChangelog({
    project_name: workspace.project.name,
    from: {
      version: from.version,
      spec_version: from.spec_version,
      app_version: from.app_version,
      source_digest: from.source_digest,
      created_at: from.created_at,
    },
    to: {
      version: to.version,
      spec_version: to.spec_version,
      app_version: to.app_version,
      source_digest: to.source_digest,
      created_at: to.created_at,
    },
    diff: diffProjectModels(from.model, to.model),
  });

  return new Response(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="project-model-v${from.version}-to-v${to.version}.md"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
