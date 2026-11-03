#!/usr/bin/env node
/**
 * GET TO IT preview runner — Phase 22.
 *
 * A separate process from the Next.js app. It owns a root directory outside the
 * application, writes one directory per workspace, and runs project commands in
 * an unprivileged Linux sandbox:
 *
 *   unshare --user --map-root-user --mount --pid --net --uts --ipc
 *     -> tmpfs root, read-only-ish /usr bind, private /proc and /tmp
 *     -> chroot, so the project cannot see the host filesystem
 *     -> no route off the machine: only loopback inside the network namespace
 *     -> prlimit caps, a wall-clock timeout and process-group cleanup
 *
 * It deliberately does not need Docker, root or any platform credential. If the
 * host cannot create user/mount/net namespaces, it refuses to run rather than
 * executing project code unsandboxed.
 *
 * Control API (loopback only): /v1/workspaces ...
 * Public preview API: Host: <workspace-key>.<PREVIEW_HOST_SUFFIX>
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..");

const MAX_LOG = Number(process.env.PREVIEW_MAX_LOG_BYTES || 200_000);
const MAX_FILES = 60;
const MAX_FILE_CHARS = 60_000;
const MAX_TOTAL_CHARS = 400_000;
const CHECK_TIMEOUT = Number(process.env.PREVIEW_CHECK_TIMEOUT_MS || 120_000);
const TOTAL_CHECK_TIMEOUT = Number(process.env.PREVIEW_TOTAL_TIMEOUT_MS || 360_000);
const PREVIEW_TTL = Number(process.env.PREVIEW_TTL_MS || 20 * 60_000);
const MAX_BODY = 2_000_000;

const ALLOWED_SCRIPTS = {
  dev: "next dev",
  build: "next build",
  start: "next start",
  lint: "eslint .",
  typecheck: "tsc --noEmit",
};

const ALLOWED_DEPENDENCIES = {
  "@supabase/ssr": "0.12.7",
  "@supabase/supabase-js": "2.118.0",
  next: "16.4.3",
  react: "19.3.1",
  "react-dom": "19.3.1",
  zod: "4.6.7",
  "@tailwindcss/postcss": "4.3.3",
  "@types/node": "26.6.6",
  "@types/react": "19.3.0",
  "@types/react-dom": "19.3.0",
  eslint: "9.39.1",
  "eslint-config-next": "16.4.3",
  tailwindcss: "4.3.3",
  typescript: "5.9.3",
};

const workspaceState = new Map();
let publicServer = null;
let controlServer = null;
let sweeper = null;

class RunnerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function configFromEnv() {
  return {
    controlPort: Number(process.env.PREVIEW_RUNNER_CONTROL_PORT || 4311),
    publicPort: Number(process.env.PREVIEW_RUNNER_PUBLIC_PORT || 4310),
    controlHost: process.env.PREVIEW_RUNNER_CONTROL_HOST || "127.0.0.1",
    publicHost: process.env.PREVIEW_RUNNER_PUBLIC_HOST || "0.0.0.0",
    root: path.resolve(process.env.PREVIEW_ROOT || path.join(PROJECT_ROOT, ".preview-workspaces")),
    deps: path.resolve(process.env.PREVIEW_DEPS_DIR || path.join(PROJECT_ROOT, "node_modules")),
    token: process.env.PREVIEW_RUNNER_TOKEN || "",
    signingSecret: process.env.PREVIEW_SIGNING_SECRET || "",
    hostSuffix: process.env.PREVIEW_HOST_SUFFIX || "preview.localhost",
    frameAncestors: process.env.PREVIEW_FRAME_ANCESTORS || "'self'",
    previewTtl: PREVIEW_TTL,
  };
}

function log(event, extra = {}) {
  const line = { at: new Date().toISOString(), event, ...extra };
  console.log(JSON.stringify(line));
}

function safeProjectPath(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 160) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("/") || value.endsWith("/") || value.includes("\\") || value.includes("//")) {
    return false;
  }
  const segments = value.split("/");
  if (segments.length > 8) return false;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || segment.length > 64) return false;
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) return false;
    if (segment.endsWith(".")) return false;
    if ([".git", ".next", "node_modules", "secrets"].includes(segment.toLowerCase())) return false;
    if (/^\.env(\..+)?$/.test(segment) && segment !== ".env.example") return false;
  }
  return true;
}

function assertFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) {
    throw new RunnerError(400, `A project needs between 1 and ${MAX_FILES} files.`);
  }
  let total = 0;
  const seen = new Set();
  for (const file of files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      throw new RunnerError(400, "Every file needs a path and content.");
    }
    if (!safeProjectPath(file.path)) throw new RunnerError(400, "Unsafe project path.");
    if (seen.has(file.path)) throw new RunnerError(400, "Duplicate project path.");
    seen.add(file.path);
    if (file.content.length > MAX_FILE_CHARS) throw new RunnerError(400, "A file is too large.");
    total += file.content.length;
  }
  if (total > MAX_TOTAL_CHARS) throw new RunnerError(400, "The project is too large.");
  return files;
}

function writeFiles(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of assertFiles(files)) {
    const target = path.join(dir, ...file.path.split("/"));
    const relative = path.relative(dir, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new RunnerError(400, "Unsafe project path.");
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, { mode: 0o600 });
  }
}

function readPackagePolicy(dir) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    throw new RunnerError(422, "package.json is missing or is not valid JSON.");
  }

  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== "string" || ALLOWED_SCRIPTS[name] !== value) {
      throw new RunnerError(422, `Script "${name}" is outside the configured check policy.`);
    }
  }
  for (const name of ["build", "start"]) {
    if (scripts[name] !== ALLOWED_SCRIPTS[name]) {
      throw new RunnerError(422, `The project must keep its "${name}" script unchanged.`);
    }
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const [name, version] of Object.entries(deps)) {
    if (ALLOWED_DEPENDENCIES[name] !== version) {
      throw new RunnerError(
        422,
        `Dependency "${name}@${version}" is not in the pinned preview cache. Nothing was installed.`,
      );
    }
  }

  const required = ["next", "react", "react-dom"];
  for (const name of required) {
    if (!deps[name]) throw new RunnerError(422, `The project is missing ${name}.`);
  }

  return { scripts, deps };
}

function ensureDeps(dir, depsDir) {
  for (const name of Object.keys(ALLOWED_DEPENDENCIES)) {
    if (!fs.existsSync(path.join(depsDir, ...name.split("/")))) {
      throw new RunnerError(
        503,
        "The preview dependency cache is missing. Run npm ci on the runner host before starting it.",
      );
    }
  }

  const link = path.join(dir, "node_modules");
  try {
    fs.unlinkSync(link);
  } catch {
    /* not there yet */
  }
}

function createWorkspace(key, projectId, userId, files) {
  const dir = path.join(config.root, key);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  writeFiles(dir, files);
  const policy = readPackagePolicy(dir);
  ensureDeps(dir, config.deps);

  const state = {
    key,
    projectId,
    userId,
    dir,
    policy,
    files,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAt: null,
    status: "ready",
    preview: null,
    logs: [],
  };
  workspaceState.set(key, state);
  return state;
}

function updateWorkspace(key, projectId, files) {
  const state = requireWorkspace(key, projectId);
  fs.rmSync(state.dir, { recursive: true, force: true });
  fs.mkdirSync(state.dir, { recursive: true, mode: 0o700 });
  writeFiles(state.dir, files);
  state.policy = readPackagePolicy(state.dir);
  ensureDeps(state.dir, config.deps);
  state.files = files;
  state.lastSeenAt = Date.now();
  return state;
}

function requireWorkspace(key, projectId) {
  const state = workspaceState.get(key);
  if (!state || (projectId && state.projectId !== projectId)) {
    throw new RunnerError(404, "Workspace not found.");
  }
  state.lastSeenAt = Date.now();
  return state;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sandboxScript(state, command, extra = "") {
  const root = path.join(state.dir, `.root-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  return {
    root,
    script: `
set -eu
R=${shellQuote(root)}
W=${shellQuote(state.dir)}
D=${shellQuote(config.deps)}
mount -t tmpfs tmpfs "$R"
mkdir -p "$R/usr" "$R/etc/ssl" "$R/dev" "$R/proc" "$R/tmp" "$R/workspace" "$R/deps/node_modules" "$R/run"
mount --bind /usr "$R/usr"
ln -s usr/bin "$R/bin"
ln -s usr/sbin "$R/sbin"
ln -s usr/lib "$R/lib"
ln -s usr/lib64 "$R/lib64"
mount --bind /etc/ssl "$R/etc/ssl"
[ -e /etc/ld.so.cache ] && { : > "$R/etc/ld.so.cache"; mount --bind /etc/ld.so.cache "$R/etc/ld.so.cache"; } || true
mount -t proc proc "$R/proc"
for f in null zero random urandom; do
  : > "$R/dev/$f"
  mount --bind "/dev/$f" "$R/dev/$f"
done
mount -t tmpfs tmpfs "$R/tmp"
mount --bind "$W" "$R/workspace"
mkdir -p "$R/workspace/node_modules"
mount --bind "$D" "$R/workspace/node_modules"
ip link set lo up 2>/dev/null || true
${extra}
chroot "$R" /bin/sh -c ${shellQuote(
      `cd /workspace && env -i PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin HOME=/tmp TMPDIR=/tmp CI=1 NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm_config_offline=true npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false NO_UPDATE_NOTIFIER=1 /bin/sh -c ${shellQuote(command)}`,
    )}
`,
  };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env || process.env,
      cwd: options.cwd || config.root,
    });
    let output = "";
    let truncated = false;
    let settled = false;
    let timer = null;

    const append = (chunk) => {
      const text = chunk.toString("utf8");
      if (output.length >= MAX_LOG) {
        truncated = true;
        return;
      }
      output += text.slice(0, MAX_LOG - output.length);
      if (output.length >= MAX_LOG) truncated = true;
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...result, output: truncated ? `${output}\n… log truncated …` : output });
    };

    child.on("error", (error) => finish({ code: -1, timedOut: false, error: error.message }));
    child.on("close", (code) => finish({ code: code ?? -1, timedOut: false }));

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
        finish({ code: -1, timedOut: true });
      }, options.timeoutMs);
    }
  });
}

async function runSandbox(state, command, timeoutMs, extra = "") {
  const { root, script } = sandboxScript(state, command, extra);
  const result = await runProcess(
    "prlimit",
    [
      "--as=6442450944",
      "--nproc=256",
      "--nofile=1024",
      "--fsize=67108864",
      "--core=0",
      "--cpu=180",
      "--",
      "unshare",
      "--user",
      "--map-root-user",
      "--mount",
      "--pid",
      "--net",
      "--uts",
      "--ipc",
      "--fork",
      "--kill-child=SIGKILL",
      "/bin/sh",
      "-c",
      script,
    ],
    { timeoutMs },
  );
  fs.rmSync(root, { recursive: true, force: true });

  const line = `$ ${command}\nexit ${result.code}${result.timedOut ? " (timed out)" : ""}\n${result.output}`;
  state.logs.push(line.slice(0, MAX_LOG));
  state.logs = state.logs.slice(-8);
  return {
    status: result.code === 0 ? "passed" : result.timedOut ? "timed_out" : "failed",
    code: result.code,
    timedOut: Boolean(result.timedOut),
    log: line,
    error: result.error || null,
  };
}

async function runChecks(state) {
  const started = Date.now();
  const checks = [];
  const order = [
    ["typecheck", "Typecheck"],
    ["lint", "Lint"],
    ["test", "Tests"],
    ["build", "Build"],
  ];

  for (const [name, label] of order) {
    if (!state.policy.scripts[name]) {
      checks.push({ name, label, status: "skipped", code: null, log: "No script configured." });
      continue;
    }
    if (Date.now() - started > TOTAL_CHECK_TIMEOUT) {
      checks.push({ name, label, status: "timed_out", code: null, log: "Total check budget exhausted." });
      break;
    }
    const result = await runSandbox(state, `npm run ${name} --silent`, CHECK_TIMEOUT);
    checks.push({ name, label, ...result });
  }

  return {
    status: checks.every((check) => check.status === "passed" || check.status === "skipped")
      ? "passed"
      : "failed",
    checks,
    durationMs: Date.now() - started,
    log: checks
      .filter((check) => check.status !== "skipped")
      .map((check) => `### ${check.label} — ${check.status}\n${check.log}`)
      .join("\n\n")
      .slice(0, MAX_LOG),
  };
}

async function startPreview(state) {
  if (state.preview) return state.preview;

  if (!fs.existsSync(path.join(state.dir, ".next", "BUILD_ID"))) {
    const build = await runSandbox(state, "npm run build --silent", CHECK_TIMEOUT);
    if (build.status !== "passed") {
      throw new RunnerError(422, "The project did not build, so it cannot be previewed.");
    }
  }

  const socket = path.join(state.dir, ".preview.sock");
  fs.rmSync(socket, { force: true });

  const bridgePort = await freePort();
  const previewCommand =
    "rm -f /workspace/.preview.sock; socat UNIX-LISTEN:/workspace/.preview.sock,fork,unlink-early TCP:127.0.0.1:3000 & exec npm run start --silent -- -H 127.0.0.1 -p 3000";

  const sandbox = sandboxScript(state, previewCommand, "ip link set lo up 2>/dev/null || true");
  const previewProcess = spawn(
    "prlimit",
    [
      "--as=4294967296",
      "--nproc=256",
      "--nofile=1024",
      "--fsize=16777216",
      "--core=0",
      "--cpu=300",
      "--",
      "unshare",
      "--user",
      "--map-root-user",
      "--mount",
      "--pid",
      "--net",
      "--uts",
      "--ipc",
      "--fork",
      "--kill-child=SIGKILL",
      "/bin/sh",
      "-c",
      sandbox.script,
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );

  const bridge = spawn(
    "socat",
    [
      `TCP-LISTEN:${bridgePort},bind=127.0.0.1,reuseaddr,fork`,
      `UNIX-CONNECT:${socket}`,
    ],
    { detached: true, stdio: "ignore" },
  );

  let previewLog = "";
  const append = (chunk) => {
    if (previewLog.length < MAX_LOG) previewLog += chunk.toString("utf8").slice(0, MAX_LOG - previewLog.length);
  };
  previewProcess.stdout.on("data", append);
  previewProcess.stderr.on("data", append);

  const ready = await waitForHttp(bridgePort, 60_000);
  if (!ready) {
    try {
      process.kill(-previewProcess.pid, "SIGKILL");
      process.kill(-bridge.pid, "SIGKILL");
    } catch {
      /* ignore */
    }
    fs.rmSync(sandbox.root, { recursive: true, force: true });
    throw new RunnerError(422, "The preview did not become reachable before the timeout.");
  }

  state.preview = {
    bridgePort,
    bridgePid: bridge.pid,
    processPid: previewProcess.pid,
    socket,
    log: previewLog,
    startedAt: Date.now(),
  };
  state.status = "preview";
  state.expiresAt = Date.now() + config.previewTtl;
  state.lastSeenAt = Date.now();
  return state.preview;
}

function stopWorkspace(state, remove = true) {
  if (state.preview) {
    for (const pid of [state.preview.processPid, state.preview.bridgePid]) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  state.preview = null;
  state.status = "stopped";
  workspaceState.delete(state.key);
  if (remove) {
    setTimeout(() => fs.rmSync(state.dir, { recursive: true, force: true }), 100);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function waitForHttp(port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const attempt = () => {
      const request = http.get({ host: "127.0.0.1", port, path: "/" }, (response) => {
        response.resume();
        resolve(true);
      });
      request.setTimeout(2_000, () => request.destroy());
      request.on("error", () => {
        if (Date.now() - started > timeoutMs) resolve(false);
        else setTimeout(attempt, 400);
      });
    };
    attempt();
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new RunnerError(413, "Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new RunnerError(400, "Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function bearerOk(req) {
  const header = req.headers.authorization || "";
  const expected = `Bearer ${config.token}`;
  if (!config.token || header.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function createControlServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://runner");
      if (url.pathname === "/v1/health" && req.method === "GET") {
        return sendJson(res, 200, {
          ok: true,
          workspaces: workspaceState.size,
          sandbox: "unshare-user-mount-pid-net",
          network: "loopback-only",
        });
      }

      if (!bearerOk(req)) return sendJson(res, 401, { ok: false, error: "Unauthorized." });

      if (url.pathname === "/v1/workspaces" && req.method === "POST") {
        const body = await readBody(req);
        const projectId = String(body.projectId || "");
        const userId = String(body.userId || "");
        if (!/^[0-9a-f-]{36}$/i.test(projectId) || !/^[0-9a-f-]{36}$/i.test(userId)) {
          throw new RunnerError(400, "A project and owner are required.");
        }
        const key = crypto.randomBytes(16).toString("hex");
        const state = createWorkspace(key, projectId, userId, body.files);
        return sendJson(res, 201, { ok: true, key, status: state.status });
      }

      const match = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{32})(?:\/(checks|preview|stop|files|probe))?$/);
      if (!match) return sendJson(res, 404, { ok: false, error: "Not found." });
      const [, key, action] = match;

      if (action === "files" && req.method === "PUT") {
        const body = await readBody(req);
        const state = updateWorkspace(key, String(body.projectId || ""), body.files);
        return sendJson(res, 200, { ok: true, status: state.status });
      }

      const state = workspaceState.get(key);
      if (!state) return sendJson(res, 404, { ok: false, error: "Workspace not found." });

      if (action === "checks" && req.method === "POST") {
        state.status = "checking";
        state.expiresAt = Date.now() + config.previewTtl;
        const result = await runChecks(state);
        state.status = result.status === "passed" ? "checks_passed" : "checks_failed";
        state.lastSeenAt = Date.now();
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (action === "preview" && req.method === "POST") {
        if (!config.signingSecret) {
          throw new RunnerError(503, "PREVIEW_SIGNING_SECRET is not configured on the runner.");
        }
        await startPreview(state);
        return sendJson(res, 200, {
          ok: true,
          key,
          host: `${key}.${config.hostSuffix}`,
          expiresAt: state.expiresAt,
        });
      }

      if (action === "probe" && req.method === "POST") {
        const probeFile = path.join(state.dir, ".runner-probe.cjs");
        fs.writeFileSync(
          probeFile,
          `const fs=require("fs"),net=require("net");
const out={cwd:process.cwd(),hostPasswd:fs.existsSync("/etc/passwd"),hostRoot:fs.existsSync("/root"),workspace:fs.existsSync("/workspace"),nodeModules:fs.existsSync("/workspace/node_modules"),platformKey:Boolean(process.env.OLLAMA_API_KEY||process.env.PREVIEW_RUNNER_TOKEN),network:false};
function done(){console.log(JSON.stringify(out));process.exit(0)}
const s=net.connect({host:"1.1.1.1",port:443});
s.setTimeout(800);
s.on("connect",()=>{out.network=true;s.destroy();done()});
s.on("error",()=>done());
s.on("timeout",()=>{s.destroy();done()});
`,
        );
        try {
          const result = await runSandbox(state, "node .runner-probe.cjs", 15_000);
          const line = result.log.split("\n").find((part) => part.startsWith("{"));
          return sendJson(res, 200, {
            ok: result.status === "passed",
            probe: line ? JSON.parse(line) : null,
            log: result.log.slice(-2_000),
          });
        } finally {
          fs.rmSync(probeFile, { force: true });
        }
      }

      if (action === "stop" && req.method === "POST") {
        stopWorkspace(state);
        return sendJson(res, 200, { ok: true, stopped: true });
      }

      return sendJson(res, 405, { ok: false, error: "Method not allowed." });
    } catch (error) {
      const status = error instanceof RunnerError ? error.status : 500;
      if (status >= 500) log("runner_error", { message: error instanceof Error ? error.message : "unknown" });
      return sendJson(res, status, {
        ok: false,
        error: error instanceof Error ? error.message : "The runner failed.",
      });
    }
  });
}

function previewTokenOk(req, state) {
  if (!config.signingSecret) return false;
  const url = new URL(req.url || "/", "http://preview");
  const fromQuery = url.searchParams.get("token");
  const cookieName = `pv_${state.key.slice(0, 8)}`;
  const cookies = String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  const token = fromQuery || (cookies ? decodeURIComponent(cookies.slice(cookieName.length + 1)) : "");
  if (!token) return { ok: false };

  const [body, signature] = token.split(".");
  if (!body || !signature) return { ok: false };
  const expected = crypto
    .createHmac("sha256", config.signingSecret)
    .update(body)
    .digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false };
  }
  if (payload.k !== state.key || payload.p !== state.projectId) return { ok: false };
  if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return { ok: false };
  return { ok: true, fromQuery: Boolean(fromQuery), cookieName };
}

function createPublicServer() {
  return http.createServer((req, res) => {
    const host = String(req.headers.host || "").split(":")[0].toLowerCase();
    const key = host.split(".")[0];
    const state = workspaceState.get(key);
    if (!state || !state.preview) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Preview not running.");
      return;
    }

    const auth = previewTokenOk(req, state);
    if (!auth.ok) {
      res.writeHead(401, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      res.end("This preview link is missing, expired or not yours. Start the preview again.");
      return;
    }

    state.lastSeenAt = Date.now();
    state.expiresAt = Date.now() + config.previewTtl;

    if (auth.fromQuery) {
      const url = new URL(req.url || "/", "http://preview");
      url.searchParams.delete("token");
      res.writeHead(302, {
        Location: `${url.pathname}${url.search}`,
        "Set-Cookie": `${auth.cookieName}=${encodeURIComponent(
          new URL(req.url || "/", "http://preview").searchParams.get("token"),
        )}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(config.previewTtl / 1000)}${
          process.env.PREVIEW_PUBLIC_ORIGIN?.startsWith("https") ? "; Secure" : ""
        }`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      res.end();
      return;
    }

    const headers = { ...req.headers };
    for (const name of ["cookie", "authorization", "x-forwarded-host", "x-forwarded-for"]) {
      delete headers[name];
    }
    headers.host = "127.0.0.1:3000";

    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: state.preview.bridgePort,
        method: req.method,
        path: req.url,
        headers,
      },
      (response) => {
        const headers = { ...response.headers };
        delete headers["set-cookie"];
        delete headers["x-frame-options"];
        headers["content-security-policy"] = `frame-ancestors ${config.frameAncestors}`;
        headers["referrer-policy"] = "no-referrer";
        headers["x-content-type-options"] = "nosniff";
        res.writeHead(response.statusCode || 502, headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("The preview process is not answering.");
    });
    req.pipe(upstream);
  });
}

async function checkSandboxSupport() {
  const test = await new Promise((resolve) => {
    const child = spawn(
      "unshare",
      ["--user", "--map-root-user", "--mount", "--net", "--fork", "/bin/sh", "-c", "exit 0"],
      { stdio: "ignore" },
    );
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
  if (!test) {
    throw new Error(
      "This host cannot create unprivileged user, mount and network namespaces. The runner refuses to execute project code without them.",
    );
  }
}

export async function startRunner(overrides = {}) {
  config = { ...configFromEnv(), ...overrides };
  if (!config.token) throw new Error("PREVIEW_RUNNER_TOKEN is required.");
  if (config.token.length < 24) throw new Error("PREVIEW_RUNNER_TOKEN must be at least 24 characters.");
  if (!path.isAbsolute(config.root)) throw new Error("PREVIEW_ROOT must be absolute.");
  await checkSandboxSupport();

  fs.mkdirSync(config.root, { recursive: true, mode: 0o700 });

  controlServer = createControlServer();
  await new Promise((resolve, reject) => {
    controlServer.once("error", reject);
    controlServer.listen(config.controlPort, config.controlHost, resolve);
  });

  publicServer = createPublicServer();
  await new Promise((resolve, reject) => {
    publicServer.once("error", reject);
    publicServer.listen(config.publicPort, config.publicHost, resolve);
  });

  sweeper = setInterval(() => {
    const now = Date.now();
    for (const state of workspaceState.values()) {
      const expiry = state.expiresAt || state.lastSeenAt + config.previewTtl;
      if (now > expiry) {
        log("preview_expired", { key: state.key });
        stopWorkspace(state);
      }
    }
  }, 30_000);
  sweeper.unref();

  log("runner_started", {
    control: `${config.controlHost}:${config.controlPort}`,
    public: `${config.publicHost}:${config.publicPort}`,
    hostSuffix: config.hostSuffix,
  });

  return { controlServer, publicServer, close: stopRunner, config };
}

export async function stopRunner() {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
  for (const state of [...workspaceState.values()]) stopWorkspace(state);
  await Promise.all([
    controlServer ? new Promise((resolve) => controlServer.close(resolve)) : null,
    publicServer ? new Promise((resolve) => publicServer.close(resolve)) : null,
  ]);
  controlServer = null;
  publicServer = null;
}

let config = configFromEnv();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startRunner().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
