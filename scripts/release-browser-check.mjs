#!/usr/bin/env node
/**
 * Browser keyboard and mobile-width release check.
 *
 * Starts the production build on a loopback port (unless
 * RELEASE_BROWSER_BASE_URL names an already-running origin), then uses
 * Playwright to verify:
 *
 *   * the home page's skip link is the first keyboard stop and moves to #main;
 *   * the sign-in form is reachable in order by Tab, shows a visible focus
 *     ring, accepts typing, and the create-account link activates by keyboard;
 *   * home, sign-in and sign-up do not overflow horizontally at 360 px or
 *     414 px.
 *
 * It creates no account, submits no credential and spends nothing. Set
 * RELEASE_BROWSER_BASE_URL to check a deployed origin instead of a local
 * build. This is a layout and keyboard check, not an accessibility audit.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { chromium } from "playwright";

const requestedBase = process.env.RELEASE_BROWSER_BASE_URL?.replace(/\/$/, "");
const checks = [];
let server = null;
let browser = null;

function fail(message) {
  throw new Error(message);
}

function check(name, run) {
  return Promise.resolve()
    .then(run)
    .then(() => {
      checks.push({ name, ok: true });
      console.log(`✔ ${name}`);
    })
    .catch((error) => {
      checks.push({ name, ok: false, error: error.message });
      console.error(`✖ ${name}: ${error.message}`);
      throw error;
    });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(base, child, output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`The production server exited with code ${child.exitCode}.\n${output()}`);
    }
    try {
      const response = await fetch(`${base}/`);
      if (response.status === 200) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`The production server did not answer at ${base} within 60 seconds.\n${output()}`);
}

async function startLocalServer() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules/next/dist/bin/next");
  let log = "";
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk) => {
    log = `${log}${chunk}`.slice(-8_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  await waitForServer(base, child, () => log);
  server = child;
  return base;
}

function activeElement(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id,
      name: element.getAttribute("name"),
      type: element.getAttribute("type"),
      text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
      href: element.getAttribute("href"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });
}

async function tabTo(page, predicate, limit = 10) {
  const stops = [];
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab");
    const active = await activeElement(page);
    if (!active) break;
    stops.push(active);
    if (predicate(active)) return { active, stops, index };
  }
  fail(`Keyboard focus never reached the expected control. Stops: ${JSON.stringify(stops)}`);
}

async function openPage(context, url, readyText) {
  const page = await context.newPage();
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  if (!response || response.status() !== 200) {
    fail(`${url} answered ${response?.status() ?? "no response"}.`);
  }
  if (readyText) await page.getByText(readyText, { exact: false }).first().waitFor({ timeout: 20_000 });
  return page;
}

async function keyboardChecks(base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await check("home page skip link is the first keyboard stop", async () => {
      const page = await openPage(context, `${base}/`, "Skip to content");
      await page.keyboard.press("Tab");
      const active = await activeElement(page);
      if (!active || active.tag !== "a" || !active.text.includes("Skip to content")) {
        fail(`First Tab stop was ${JSON.stringify(active)}, not the skip link.`);
      }
      await page.keyboard.press("Enter");
      const hash = await page.evaluate(() => location.hash);
      if (hash !== "#main") fail(`Skip link moved to "${hash}", not #main.`);
      await page.close();
    });

    await check("sign-in controls are reachable in keyboard order with a visible focus ring", async () => {
      const page = await openPage(context, `${base}/sign-in`);
      const stops = [];
      for (let index = 0; index < 10; index += 1) {
        await page.keyboard.press("Tab");
        const active = await activeElement(page);
        if (!active) break;
        stops.push(active);
      }
      const emailIndex = stops.findIndex((stop) => stop.name === "email");
      const passwordIndex = stops.findIndex((stop) => stop.name === "password");
      const buttonIndex = stops.findIndex(
        (stop) => stop.tag === "button" && /sign in/i.test(stop.text),
      );
      if (emailIndex < 0 || passwordIndex < 0 || buttonIndex < 0) {
        fail(`Email, password and Sign in were not all keyboard stops: ${JSON.stringify(stops)}`);
      }
      if (!(emailIndex < passwordIndex && passwordIndex < buttonIndex)) {
        fail(`Sign-in tab order is wrong: email=${emailIndex}, password=${passwordIndex}, button=${buttonIndex}.`);
      }
      const emailStop = stops[emailIndex];
      const ring =
        (emailStop.outlineStyle !== "none" && emailStop.outlineWidth !== "0px") ||
        emailStop.boxShadow !== "none";
      if (!ring) {
        fail(`The focused email input has no visible focus ring: ${JSON.stringify(emailStop)}.`);
      }

      await page.goto(`${base}/sign-in`, { waitUntil: "domcontentloaded" });
      await tabTo(page, (active) => active.name === "email");
      await page.keyboard.type("release-check@example.test");
      await page.keyboard.press("Tab");
      const afterEmail = await activeElement(page);
      if (afterEmail?.name !== "password") {
        fail(`Tab after email focused ${JSON.stringify(afterEmail)}, not the password.`);
      }
      await page.keyboard.type("not-a-real-password");
      await page.keyboard.press("Tab");
      const afterPassword = await activeElement(page);
      if (afterPassword?.tag !== "button" || !/sign in/i.test(afterPassword.text)) {
        fail(`Tab after password focused ${JSON.stringify(afterPassword)}, not Sign in.`);
      }
      await page.close();
    });

    await check("create-account link activates by keyboard", async () => {
      const page = await openPage(context, `${base}/sign-in`);
      await tabTo(page, (active) => active.tag === "a" && /create an account/i.test(active.text));
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/sign-up$/, { timeout: 20_000 });
      await page.getByRole("heading", { name: "Create your account" }).waitFor({ timeout: 20_000 });
      await page.close();
    });
  } finally {
    await context.close();
  }
}

async function mobileChecks(base) {
  for (const width of [360, 414]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    try {
      for (const [label, route, readyText] of [
        ["home", "/", "Skip to content"],
        ["sign-in", "/sign-in", "Email"],
        ["sign-up", "/sign-up", "Create your account"],
      ]) {
        await check(`${label} has no horizontal overflow at ${width}px`, async () => {
          const page = await openPage(context, `${base}${route}`, readyText);
          const metrics = await page.evaluate(() => {
            const root = document.documentElement;
            const body = document.body;
            return {
              clientWidth: root.clientWidth,
              scrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
            };
          });
          if (metrics.scrollWidth > metrics.clientWidth + 1) {
            fail(
              `${route} is ${metrics.scrollWidth - metrics.clientWidth}px wider than the ${metrics.clientWidth}px viewport.`,
            );
          }
          await page.close();
        });
      }
    } finally {
      await context.close();
    }
  }
}

let failure = null;

try {
  const base = requestedBase || (await startLocalServer());
  console.log(`Browser checks against ${base}`);

  try {
    browser = await chromium.launch({
      headless: true,
      // Playwright's headless shell is a separate download; the full Chromium
      // binary is what the project already installs for its E2E workflow.
      executablePath: chromium.executablePath(),
    });
  } catch (error) {
    fail(
      `Chromium could not start. Run "npx playwright install chromium" first. ${error.message}`,
    );
  }

  await keyboardChecks(base);
  await mobileChecks(base);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) {
    server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}

console.log(
  JSON.stringify(
    { passed: checks.filter((check) => check.ok).length, failed: checks.filter((check) => !check.ok).length, checks },
    null,
    2,
  ),
);
if (failure) {
  const browserUnavailable =
    /Executable doesn't exist|error while loading shared libraries|could not start/i.test(
      failure.message,
    );
  if (browserUnavailable && process.env.RELEASE_BROWSER_ALLOW_SKIP === "1") {
    console.error(`SKIP: browser keyboard/mobile check did not run. ${failure.message}`);
    process.exitCode = 2;
  } else {
    console.error(`Browser keyboard/mobile check failed: ${failure.message}`);
    process.exitCode = 1;
  }
}
