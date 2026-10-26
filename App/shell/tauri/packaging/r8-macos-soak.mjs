#!/usr/bin/env node
/**
 * R8 isolated native supervisor soak. Does NOT use the user's live profile.
 * Every cycle launches packaged Rust --smoke-native-runtime, which starts and
 * stops Memory, Local API and Gateway in its own temporary directory.
 * PASS is emitted only after the entire requested wall-clock duration.
 *
 * Usage: node r8-macos-soak.mjs /absolute/path/to/memmy-turbo-tauri [hours]
 * Default 24 hours. Optional environment: MEMMY_R8_SOAK_INTERVAL_SECONDS=60.
 */
import { spawn, execFileSync } from "node:child_process";
import { readdir, writeFile, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const executable = process.argv[2];
const hours = Number(process.argv[3] ?? "24");
const intervalSeconds = Number(process.env.MEMMY_R8_SOAK_INTERVAL_SECONDS ?? "60");
if (process.platform !== "darwin" || !executable || !isAbsolute(executable) ||
    !Number.isFinite(hours) || hours <= 0 || hours > 48 ||
    !Number.isFinite(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 3600) {
  console.error("Usage on macOS: node r8-macos-soak.mjs /absolute/path/to/installed/binary [0.01..48 hours]");
  process.exit(2);
}
const endAt = Date.now() + hours * 3600_000;
const startedAt = Date.now();
const reportDir = resolve(process.env.MEMMY_R8_REPORT_DIR ?? join(tmpdir(), "memmy-r8-soak-report"));
await mkdir(reportDir, { recursive: true, mode: 0o700 });
const reportFile = join(reportDir, "native-soak.json");
const runtimeNode = resolve(dirname(executable), "../Resources/runtime/node");
const ownPids = () => {
  const listing = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  return new Set(listing.split("\n").flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    return match && (match[2] === executable || match[2].startsWith(executable + " ") ||
      match[2].startsWith(runtimeNode + " ")) ? [Number(match[1])] : [];
  }));
};
const baselinePids = ownPids();
const tempNames = async () => new Set((await readdir(tmpdir())).filter(x => x.startsWith("memmy-standalone-smoke-")));
const baselineDirs = await tempNames();
let cycles = 0;
let failures = 0;
let interrupted = false;
let activeChild = null;
const durations = [];
let lastFailure = null;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    activeChild?.kill("SIGTERM");
  });
}
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const save = async (completed) => {
  const sorted = [...durations].sort((a, b) => a - b);
  const percentile = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? null;
  const report = {
    suite: "isolated-native-restart-soak", completed,
    elapsedHours: Number(((Date.now() - startedAt) / 3600_000).toFixed(4)),
    requestedHours: hours, cycles, failures,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) ?? null,
    interruption: interrupted, lastFailure,
    pass: completed && !interrupted && failures === 0 && cycles > 0
  };
  const temp = reportFile + ".tmp";
  await writeFile(temp, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, reportFile);
  return report;
};
while (!interrupted && Date.now() < endAt) {
  const began = Date.now();
  const outcome = await new Promise(resolveOutcome => {
    const child = spawn(executable, ["--smoke-native-runtime"], {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        // Allowlist environment; no model keys or active user profile.
        PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8",
        HOME: tmpdir(), TMPDIR: tmpdir()
      }
    });
    activeChild = child;
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 90_000);
    child.stderr.on("data", chunk => { output = (output + String(chunk)).slice(-4000); });
    child.once("error", error => {
      clearTimeout(timer);
      activeChild = null;
      resolveOutcome({ ok: false, reason: error.code ?? "spawn-error" });
    });
    child.once("close", code => {
      clearTimeout(timer);
      activeChild = null;
      resolveOutcome({
        ok: !timedOut && code === 0 && output.includes("PASS: packaged Memory + Local API + Agent Gateway start/stop"),
        reason: timedOut ? "timeout" : code === 0 ? "readiness-marker-missing" : "nonzero-exit"
      });
    });
  });
  cycles += 1;
  durations.push(Date.now() - began);
  let freshPids = [];
  let freshDirs = [];
  // Children and directories can be reaped shortly *after* the parent closes.
  // Settle for up to two seconds before calling it a leak.
  for (let retry = 0; retry < 9; retry++) {
    freshPids = [...ownPids()].filter(pid => !baselinePids.has(pid));
    freshDirs = [...await tempNames()].filter(name => !baselineDirs.has(name));
    if (!freshPids.length && !freshDirs.length) break;
    await sleep(250);
  }
  if (!outcome.ok || freshPids.length || freshDirs.length) {
    failures += 1;
    lastFailure = {
      cycle: cycles, reason: outcome.reason,
      leakedProcesses: freshPids.length, leakedTempProfiles: freshDirs.length
    };
  }
  const report = await save(false);
  console.log(JSON.stringify({
    cycle: cycles, result: failures ? "FAIL" : "OK", durationMs: durations.at(-1),
    elapsedHours: report.elapsedHours
  }));
  if (failures) break;
  if (!interrupted && Date.now() < endAt) {
    await sleep(Math.min(intervalSeconds * 1000, endAt - Date.now()));
  }
}
const finalReport = await save(Date.now() >= endAt && !interrupted);
console.log(JSON.stringify(finalReport));
if (!finalReport.pass) process.exitCode = 1;
