/**
 * The source revision this build came from.
 *
 * Set `GIT_REVISION` (or the host's `VERCEL_GIT_COMMIT_SHA`) at build time so a
 * running deployment can be tied to one commit. Nothing here is a secret, and an
 * unknown revision is reported as unknown rather than guessed.
 */

const raw =
  process.env.GIT_REVISION ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.NEXT_PUBLIC_GIT_REVISION ??
  "";

export const SOURCE_REVISION = /^[0-9a-f]{7,40}$/i.test(raw.trim())
  ? raw.trim()
  : "unknown";

export const SOURCE_DIRTY =
  process.env.GIT_DIRTY === "true" ? true : process.env.GIT_DIRTY === "false" ? false : null;

/** Short label for the health check and release notes. */
export function revisionLabel(): string {
  if (SOURCE_REVISION === "unknown") return "unknown";
  const short = SOURCE_REVISION.slice(0, 12);
  if (SOURCE_DIRTY === true) return `${short}+dirty`;
  return short;
}
