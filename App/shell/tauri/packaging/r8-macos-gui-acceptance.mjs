#!/usr/bin/env node
/**
 * Interactive NATIVE macOS WKWebView GUI acceptance. Not a browser mock.
 * Requires Screen Recording permission and a human reviewer on the Mac.
 * Screenshots remain local and may contain user content: do NOT upload them.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

if (process.platform !== "darwin") {
  console.error("Native macOS GUI verification requires macOS");
  process.exit(2);
}
const routes = [
  ["welcome", "Welcome and language selector"],
  ["token-detail", "Token details and language selector"],
  ["login", "Login route (local-only mode must not demand cloud login)"],
  ["api-key", "BYOK provider setup"],
  ["api-key-models", "BYOK model choices"],
  ["api-key-optional", "Optional BYOK options"],
  ["onboarding", "Onboarding route"],
  ["main", "Chat send/composer/hover/animations"],
  ["pet", "Pet overlay and controls"],
  ["tools", "Tools, MCP and Skills controls"],
  ["memory", "Memory overview"],
  ["knowledge", "Knowledge pages"],
  ["memory-sources", "Memory sources and scans"],
  ["settings", "Thai language and dark mode persisted after app restart"]
];
const screenshotDir = await mkdtemp(join(tmpdir(), "memmy-r8-native-gui-"));
const prompt = createInterface({ input: process.stdin, output: process.stdout });
const records = [];
function windowId() {
  const swift = [
    "import CoreGraphics",
    "let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String:Any]] ?? []",
    "for w in windows {",
    "let owner = w[kCGWindowOwnerName as String] as? String ?? \"\"",
    "if owner.contains(\"Memmy Turbo\") { print(w[kCGWindowNumber as String] ?? \"\") }",
    "}"
  ].join("; ");
  const output = execFileSync("swift", ["-e", swift], { encoding: "utf8", timeout: 15_000 });
  const id = output.trim().split("\n")[0];
  if (!/^\d+$/.test(id ?? "")) throw Error("Memmy main window was not found");
  return id;
}
try {
  console.log("Native GUI QA: screenshots stay on this Mac only. Do not enter passwords or show tokens.");
  console.log("Ensure Screen Recording access is granted to the terminal before starting.");
  for (const [route, label] of routes) {
    const action = (await prompt.question(`Navigate to ${route} (${label}), inspect buttons and Thai text, then type 'capture' or 'abort': `)).trim();
    if (action !== "capture") throw Error("Reviewer aborted before " + route);
    const shot = join(screenshotDir, route + ".png");
    execFileSync("screencapture", ["-x", "-l", windowId(), shot], { timeout: 20_000 });
    const info = await stat(shot);
    if (info.size < 4000) throw Error("Screenshot empty or suspiciously small: " + route);
    const dimensions = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", shot], { encoding: "utf8" });
    const width = Number(dimensions.match(/pixelWidth: (\d+)/)?.[1] ?? 0);
    const height = Number(dimensions.match(/pixelHeight: (\d+)/)?.[1] ?? 0);
    if (width < 600 || height < 400) throw Error("Main window capture invalid: " + route);
    const accepted = (await prompt.question(`Review the screenshot locally; is ${route} correct and interactive? type 'PASS' only if verified: `)).trim();
    if (accepted !== "PASS") throw Error("Route not accepted: " + route);
    records.push({ route, approved: true, width, height });
    console.log(`PASS ${route} (${records.length}/${routes.length})`);
  }
  const report = { suite: "native-macos-wkwebview-human-review", reviewerConfirmed: true,
    completed: records.length === routes.length, required: routes.length, routes: records,
    screenshotDirectory: screenshotDir, screenshotsUploaded: false };
  await writeFile(join(screenshotDir, "acceptance.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ result: "PASS", reviewed: records.length, screenshotDirectory: screenshotDir }));
} catch (error) {
  await writeFile(join(screenshotDir, "acceptance.json"), JSON.stringify({
    suite: "native-macos-wkwebview-human-review", completed: false,
    reviewed: records.length, required: routes.length, failureCategory: error.message
  }, null, 2), { mode: 0o600 });
  console.error("NOT_ACCEPTED: " + error.message);
  process.exitCode = 1;
} finally {
  prompt.close();
}
