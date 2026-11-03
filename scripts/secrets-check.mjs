#!/usr/bin/env node
/**
 * Secret scan over tracked files. Prints file and line only — never the value.
 * This is a useful automated check, not a complete security audit.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  { name: "stripe_live_key", regex: /sk_live_[0-9A-Za-z]{10,}/ },
  { name: "stripe_test_key", regex: /sk_test_[0-9A-Za-z]{10,}/ },
  {
    name: "supabase_service_role_jwt",
    regex: /service_role[^\n]{0,20}eyJ[A-Za-z0-9_-]{10,}/,
  },
  { name: "private_key_block", regex: /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/ },
  { name: "aws_access_key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "ollama_key_assignment", regex: /OLLAMA_API_KEY\s*=\s*\S{8,}/ },
  { name: "jwt_literal", regex: /eyJhbGciOi[A-Za-z0-9_-]{10,}/ },
  { name: "webhook_secret_assignment", regex: /STRIPE_WEBHOOK_SECRET\s*=\s*\S{8,}/ },
];

const ALLOW = [
  /^\.env\.example$/,
  /^package-lock\.json$/,
  /^README\.md$/,
  /^OPERATIONS\.md$/,
  /^scripts\/release-check\.mjs$/,
  /^scripts\/secrets-check\.mjs$/,
];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => !ALLOW.some((pattern) => pattern.test(file)));

const findings = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;

  text.split("\n").forEach((line, index) => {
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({ file, line: index + 1, name: pattern.name });
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`Secret scan found ${findings.length} suspicious line(s):`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} — ${finding.name}`);
  }
  console.error("\nValues were not printed. Remove the value, rotate it, and update the environment.");
  process.exit(1);
}

console.log(`Secret scan passed: ${files.length} tracked files, no key patterns found.`);
console.log("This is an automated pattern check, not a security audit.");
