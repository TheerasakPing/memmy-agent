/** Immutable key UI-source guard for Memmy Agent Turbo (R1 onward).
 * Original UI remains unmodified; this is NOT a substitute for screenshot or GUI E2E. */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL("./ui-freeze-baseline.json", import.meta.url), "utf8"));
let failed = 0;
for (const [path, baselineBlob] of Object.entries(manifest.blobs)) {
  const fullPath = resolve(repoRoot, path);
  if (!existsSync(fullPath)) {
    console.error(`UI FREEZE VIOLATION: ${path} missing (baseline ${baselineBlob})`);
    failed++;
    continue;
  }
  let actual;
  try {
    actual = execFileSync("git", ["hash-object", "--", path], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch (error) {
    console.error(`UI FREEZE ERROR: cannot hash ${path}: ${String(error)}`);
    failed++;
    continue;
  }
  if (actual !== baselineBlob) {
    console.error(`UI FREEZE VIOLATION: ${path} expected ${baselineBlob}, observed ${actual}`);
    failed++;
  }
}
const total = Object.keys(manifest.blobs).length;
if (failed) {
  console.error(`UI freeze failed: ${failed}/${total} protected source files changed. Review against the original UI baseline and obtain explicit product approval before updating reference hashes.`);
  process.exitCode = 1;
} else {
  console.log(`UI source freeze PASS: ${total}/${total} original source blobs match ${manifest.baseline_commit}. Visual and feature-parity tests remain mandatory.`);
}
