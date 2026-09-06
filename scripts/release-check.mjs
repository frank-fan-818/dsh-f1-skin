// release-check.mjs — audit the exact npm tarball without publishing it.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "dsh-f1-release-"));
const npmExecPath = process.env.npm_execpath;
// Cockpit photographs are staged into lib/ by the build (HTTP-served), so the
// tarball budget covers the full-resolution photos.
const MAX_PACKED_BYTES = 4_600_000;
const MAX_UNPACKED_BYTES = 5_200_000;
const required = new Set([
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "cordis.patch.yml",
  "lib/client.js",
  "lib/index.js",
  "package.json"
]);
const forbiddenPrefixes = ["assets/", "docs/", "scripts/", "src/", "tests/", ".github/"];

let failures = 0;
const fail = (message) => { console.error(`✗ ${message}`); failures += 1; };
const ok = (message) => console.log(`✓ ${message}`);

try {
  const npmArgs = ["pack", "--dry-run", "--json", "--ignore-scripts", "--cache", join(temp, "cache")];
  const result = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, ...npmArgs], { cwd: root, encoding: "utf8", shell: false })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, { cwd: root, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    fail(`npm pack failed: ${result.error?.message || String(result.stderr || result.stdout || "unknown error").trim()}`);
  } else {
    let report;
    try {
      report = JSON.parse(result.stdout)[0];
    } catch {
      fail("npm pack did not return parseable JSON");
    }
    if (report) {
      const paths = new Set(report.files.map((file) => file.path.replaceAll("\\", "/")));
      for (const path of required) {
        if (!paths.has(path)) fail(`package is missing ${path}`);
      }
      if ([...required].every((path) => paths.has(path))) ok("package contains runtime, README, license, and third-party notices");

      const leaked = [...paths].filter((path) => forbiddenPrefixes.some((prefix) => path.startsWith(prefix)));
      if (leaked.length > 0) fail(`package leaks development files: ${leaked.join(", ")}`);
      else ok("package excludes source, tests, workflows, and raw assets");

      if (report.size > MAX_PACKED_BYTES) fail(`packed tarball exceeds ${MAX_PACKED_BYTES} bytes (${report.size})`);
      else ok(`packed tarball is ${report.size} bytes (budget ${MAX_PACKED_BYTES})`);
      if (report.unpackedSize > MAX_UNPACKED_BYTES) fail(`unpacked package exceeds ${MAX_UNPACKED_BYTES} bytes (${report.unpackedSize})`);
      else ok(`unpacked package is ${report.unpackedSize} bytes (budget ${MAX_UNPACKED_BYTES})`);

      const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      if (report.name !== metadata.name || report.version !== metadata.version) {
        fail(`pack identity ${report.name}@${report.version} differs from package.json`);
      } else ok(`pack identity is ${report.name}@${report.version}`);
    }
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} release check(s) FAILED`);
  process.exit(1);
}
console.log("\nrelease package checks passed ✓");
