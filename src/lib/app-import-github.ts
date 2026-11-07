import { AppImportError, IMPORT_LIMITS } from "./app-import-constants";

const GITHUB_REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const GITHUB_REF = /^[A-Za-z0-9._/-]{1,200}$/;

export function isGitHubRepository(value: string): boolean {
  return GITHUB_REPO.test(value);
}

export function isGitHubBranch(value: string): boolean {
  return GITHUB_REF.test(value) && !value.includes("..") && !value.startsWith("-") && !value.endsWith("/");
}

async function readResponseWithLimit(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    throw new AppImportError(
      `The repository archive is larger than ${Math.floor(limit / 1024 / 1024)} MB.`,
    );
  }
  if (!response.body) throw new AppImportError("The repository archive response had no body.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new AppImportError(
          `The repository archive is larger than ${Math.floor(limit / 1024 / 1024)} MB.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return output;
}

/**
 * Fetches GitHub's source ZIP for an already-authorized connection. The token
 * stays in the server action and is never put in the URL or the returned data.
 */
export async function fetchGitHubZipball(input: {
  token: string;
  repository: string;
  branch: string;
  fetchImpl?: typeof fetch;
}): Promise<Uint8Array> {
  if (!isGitHubRepository(input.repository)) {
    throw new AppImportError("The connected repository name is not valid.");
  }
  if (!isGitHubBranch(input.branch)) {
    throw new AppImportError("The connected repository branch is not valid.");
  }
  if (!input.token) {
    throw new AppImportError("The connected GitHub credential is unavailable. Reconnect the repository and try again.");
  }

  const fetcher = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetcher(
      `https://api.github.com/repos/${input.repository}/zipball/${encodeURIComponent(input.branch)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${input.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "GET-TO-IT-import",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch {
    throw new AppImportError("The repository archive could not be downloaded. Check the connection and try again.");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AppImportError("GitHub rejected the repository connection. Reconnect it and try again.");
    }
    if (response.status === 404) {
      throw new AppImportError("The connected repository or branch was not found. Reconnect it and try again.");
    }
    throw new AppImportError(`GitHub returned ${response.status} while downloading the repository.`);
  }

  return readResponseWithLimit(response, IMPORT_LIMITS.maxArchiveBytes);
}
