#!/usr/bin/env node
// Keeps a machine-readable 1:1 inventory of the original bridge contract,
// all visible application routes and the implementation status of each method.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const source = readFileSync(resolve(root, "App/shell/desktop/src/preload/preload.cts"), "utf8");
const bridgeSource = readFileSync(resolve(root, "App/frontend/desktop/src/tauri-bridge.ts"), "utf8");
const routeSource = readFileSync(resolve(root, "App/frontend/desktop/src/app/routes.ts"), "utf8");
const start = source.indexOf("interface MemmyPreloadApi {");
const end = source.indexOf("\n}\n\n/**", start);
if (start < 0 || end < 0) throw new Error("Electron interface block not found");
const contract = source.slice(start, end);
const methods = [...contract.matchAll(/^  ([A-Za-z][A-Za-z0-9_]*)\??\(/gm)].map((match) => match[1]);
const match = bridgeSource.match(/export const TAURI_NATIVE_BRIDGE_METHODS = \[([\s\S]*?)\] as const;/);
if (!match) throw new Error("Tauri methods marker not found");
const native = [...match[1].matchAll(/"([A-Za-z][A-Za-z0-9_]*)"/g)].map((match) => match[1]);
const routeType = routeSource.match(/export type AppRoutePath =([\s\S]*?);/);
if (!routeType) throw new Error("route union missing");
const routes = [...routeType[1].matchAll(/"(\/[A-Za-z0-9/-]+)"/g)].map((match) => match[1]);
const unique = (xs) => xs.length === new Set(xs).size;
if (!unique(methods) || !unique(native) || !unique(routes)) throw new Error("duplicate names in parity source");
for (const name of native) if (!methods.includes(name)) throw new Error("Tauri method not present in Electron: " + name);
const uiFiles = [
  "App/frontend/desktop/src/app.tsx",
  "App/frontend/desktop/src/app/routes.ts",
  "App/frontend/desktop/src/styles.css",
  "App/frontend/desktop/src/pages/app-frame.tsx"
];
const uiHashes = Object.fromEntries(uiFiles.map((path) => [
  path, createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")
]));
const originalWindowSource = readFileSync(resolve(root, "App/shell/desktop/src/main/window-mode.ts"), "utf8");
const originalWindow = originalWindowSource.match(/export const fullWindowOptions = \{([\s\S]*?)\} as const;/);
if (!originalWindow) throw new Error("original window baseline missing");
const tauriConfig = JSON.parse(readFileSync(resolve(root, "App/shell/tauri/src-tauri/tauri.conf.json"), "utf8"));
for (const name of ["width", "height", "minWidth", "minHeight"]) {
  const value = originalWindow[1].match(new RegExp(String.raw`\b${name}: (\d+)`));
  if (!value || Number(value[1]) !== tauriConfig.app.windows[0][name]) {
    throw new Error(`native Tauri ${name} diverged from original Electron UI window`);
  }
}
const manifest = {
  schemaVersion: 1,
  source: "App/shell/desktop/src/preload/preload.cts:MemmyPreloadApi",
  frontend: "App/frontend/desktop/src/main.tsx",
  uiPolicy: "reuse original React entrypoint, CSS, pages, routes, tabs and components",
  immutableUiSha256: uiHashes,
  fullFeatureParity: native.length === methods.length,
  counts: { legacyMethods: methods.length, nativeMethods: native.length, remainingMethods: methods.length - native.length, routes: routes.length },
  routes: routes.map((path) => ({ path, status: "original-react-reused" })),
  methods: methods.map((name) => ({
    name,
    status: native.includes(name) ? "native-tauri-command-or-local-noop" : "NOT_MIGRATED",
    acceptance: native.includes(name) ? "requires native E2E proof" : "must port and run original behavior E2E"
  }))
};
const target = resolve(root, "docs/engineering/tauri/tauri-parity-manifest.json");
const serialized = JSON.stringify(manifest, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const old = readFileSync(target, "utf8");
  if (old !== serialized) throw new Error("Tauri parity manifest is stale; regenerate it");
  console.log(`Tauri bridge coverage: ${native.length}/${methods.length}; original React routes: ${routes.length}; manifest up to date`);
  if (process.argv.includes("--strict") && !manifest.fullFeatureParity) process.exitCode = 1;
} else {
  writeFileSync(target, serialized);
  console.log(`Generated Tauri coverage: ${native.length}/${methods.length}; routes: ${routes.length}`);
}
