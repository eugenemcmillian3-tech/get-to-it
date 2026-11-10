#!/usr/bin/env node
/**
 * Route and metadata audit.
 *
 * Opens every public page against a deployed origin and fails if one 404s,
 * serves the wrong content type, loses its share tags, or points at an icon or
 * preview image that does not exist. This is the check that would have caught
 * both the missing favicon and the bare /goals path: it reads the HTML the site
 * actually serves, not the source.
 *
 * Environment:
 *   AUDIT_BASE_URL      origin to audit; defaults to production
 *   AUDIT_TIMEOUT_MS    per-request timeout, default 20000
 *
 * Usage:
 *   node scripts/route-audit.mjs
 *   node scripts/route-audit.mjs --base http://localhost:3000
 *   node scripts/route-audit.mjs --expect-revision <commit-sha>
 *   node scripts/route-audit.mjs --wait-seconds 30
 */

const DEFAULT_BASE_URL = "https://get-to-it-wvpy.vercel.app";
const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT = "get-to-it-route-audit/1.0";

const PAGES = [
  { path: "/", title: "GET TO IT" },
  { path: "/sign-in", title: "Sign in" },
  { path: "/sign-up", title: "Create your account" },
  { path: "/privacy", title: "Privacy" },
  { path: "/terms", title: "Terms" },
  { path: "/refunds", title: "Refunds" },
];

const ASSETS = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

function readOption(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

const argv = process.argv.slice(2);
const baseUrl = (
  readOption(argv, "--base") ??
  process.env.AUDIT_BASE_URL?.trim() ??
  DEFAULT_BASE_URL
).replace(/\/+$/, "");
const timeoutMs = Number(process.env.AUDIT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
const expectedRevision = readOption(argv, "--expect-revision");
const waitSeconds = Number(readOption(argv, "--wait-seconds") ?? 600);

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
    ...init,
  });
  const body = await response.text();
  return { status: response.status, headers: response.headers, body };
}

async function headStatus(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "HEAD",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": USER_AGENT },
  });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
  };
}

function metaContent(html, attribute, key) {
  const pattern = new RegExp(
    `<meta[^>]*${attribute}=["']${key}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const match = html.match(pattern);
  if (match) return match[1];
  // content may come before the property attribute
  const reversed = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*${attribute}=["']${key}["']`,
    "i",
  );
  return html.match(reversed)?.[1];
}

function linkHref(html, rel) {
  const pattern = new RegExp(
    `<link[^>]*rel=["']${rel}["'][^>]*href=["']([^"']*)["']`,
    "i",
  );
  const match = html.match(pattern);
  if (match) return match[1];
  const reversed = new RegExp(
    `<link[^>]*href=["']([^"']*)["'][^>]*rel=["']${rel}["']`,
    "i",
  );
  return html.match(reversed)?.[1];
}

function isNotADeadEnd(html) {
  // A styled 200 page that says "not found" is still a dead end.
  return !/This page could not be found|404\s*[—-]\s*not found/i.test(html);
}

async function waitForRevision(revision) {
  const wanted = revision.slice(0, 12);
  const deadline = Date.now() + waitSeconds * 1000;
  let last = "unreachable";

  while (Date.now() < deadline) {
    try {
      const { status, body } = await request("/api/health");
      const parsed = JSON.parse(body);
      last = `${status} ${parsed?.revision ?? "no revision"}`;
      if (status === 200 && typeof parsed?.revision === "string" && parsed.revision.startsWith(wanted)) {
        return `live (revision ${parsed.revision})`;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  throw new Error(`revision ${wanted} was not live within ${waitSeconds}s (last: ${last})`);
}

async function auditPage(page) {
  const { status, headers, body } = await request(page.path);
  const contentType = headers.get("content-type") ?? "";

  if (status !== 200) throw new Error(`HTTP ${status}`);
  if (!contentType.includes("text/html")) throw new Error(`content-type ${contentType}`);
  if (!isNotADeadEnd(body)) throw new Error("served a not-found page with status 200");

  const title = body.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "";
  if (!title.includes(page.title)) {
    throw new Error(`title "${title}" does not mention "${page.title}"`);
  }

  const problems = [];

  const ogTitle = metaContent(body, "property", "og:title");
  if (!ogTitle) problems.push("no og:title");

  const ogImage = metaContent(body, "property", "og:image");
  if (!ogImage) problems.push("no og:image");
  else if (!ogImage.startsWith("https://")) problems.push(`og:image is not absolute (${ogImage})`);

  const twitterCard = metaContent(body, "name", "twitter:card");
  if (twitterCard !== "summary_large_image") {
    problems.push(`twitter:card is ${twitterCard ?? "missing"}`);
  }

  const twitterImage = metaContent(body, "name", "twitter:image");
  if (!twitterImage) problems.push("no twitter:image");
  else if (!twitterImage.startsWith("https://")) {
    problems.push(`twitter:image is not absolute (${twitterImage})`);
  }

  if (!linkHref(body, "icon")) problems.push("no icon link");
  if (!linkHref(body, "manifest")) problems.push("no manifest link");

  if (problems.length) throw new Error(problems.join("; "));

  // The declared preview image has to exist, or the card silently degrades.
  const image = ogImage.startsWith("https://")
    ? new URL(ogImage).pathname + new URL(ogImage).search
    : ogImage;
  const card = await headStatus(image);
  if (card.status !== 200) throw new Error(`og:image ${image} returned ${card.status}`);
  if (!card.contentType.startsWith("image/")) {
    throw new Error(`og:image ${image} is ${card.contentType}`);
  }

  return `200, "${title}", card ${card.contentType}`;
}

async function auditAsset(path) {
  const { status, contentType } = await headStatus(path);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return `200 ${contentType}`;
}

async function auditManifest() {
  const { status, body } = await request("/manifest.webmanifest");
  if (status !== 200) throw new Error(`HTTP ${status}`);

  let manifest;
  try {
    manifest = JSON.parse(body);
  } catch {
    throw new Error("manifest is not JSON");
  }

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  if (!icons.length) throw new Error("manifest declares no icons");
  if (!manifest.name || !manifest.short_name) throw new Error("manifest has no name");
  if (!manifest.start_url) throw new Error("manifest has no start_url");

  for (const icon of icons) {
    const src = typeof icon.src === "string" ? icon.src : "";
    if (!src) throw new Error("manifest icon without src");
    const result = await headStatus(src);
    if (result.status !== 200) throw new Error(`manifest icon ${src} returned ${result.status}`);
  }

  return `${icons.length} icons, start_url ${manifest.start_url}`;
}

async function main() {
  console.log(`Auditing ${baseUrl} at ${new Date().toISOString()}`);

  const results = [];

  const revisionNote = expectedRevision
    ? await waitForRevision(expectedRevision).catch((error) => {
        results.push({ name: `revision ${expectedRevision.slice(0, 12)}`, ok: false, error: error.message });
        return null;
      })
    : null;
  if (revisionNote) results.push({ name: "revision", ok: true, detail: revisionNote });

  for (const page of PAGES) {
    try {
      results.push({ name: page.path, ok: true, detail: await auditPage(page) });
    } catch (error) {
      results.push({ name: page.path, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const path of ASSETS) {
    try {
      results.push({ name: path, ok: true, detail: await auditAsset(path) });
    } catch (error) {
      results.push({ name: path, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  try {
    results.push({ name: "/manifest.webmanifest contents", ok: true, detail: await auditManifest() });
  } catch (error) {
    results.push({
      name: "/manifest.webmanifest contents",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  for (const result of results) {
    console.log(result.ok ? `ok   ${result.name}: ${result.detail}` : `FAIL ${result.name}: ${result.error}`);
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    console.error(`\n${failures.length} of ${results.length} checks failed against ${baseUrl}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${results.length} checks passed against ${baseUrl}.`);
}

main().catch((error) => {
  console.error(`Route audit failed to run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
