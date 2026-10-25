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

// Prevent counting a listed method that was never implemented in the actual
// React bridge. Each Rust IPC target must exist and be registered in Tauri.
const bridgeStart = bridgeSource.indexOf("  const bridge = {");
const bridgeEnd = bridgeSource.indexOf("  } as unknown", bridgeStart);
if (bridgeStart < 0 || bridgeEnd < 0) throw new Error("Tauri renderer bridge object not found");
const bridgeObject = bridgeSource.slice(bridgeStart, bridgeEnd);
const bridgedNames = [...bridgeObject.matchAll(/^    ([A-Za-z][A-Za-z0-9_]*)(?::|\()/gm)].map((match) => match[1]);
if (!unique(bridgedNames)) throw new Error("duplicate methods in actual Tauri renderer bridge");
for (const name of native) if (!bridgedNames.includes(name)) {
  throw new Error("listed Tauri method not implemented in renderer bridge: " + name);
}
const rustHost = readFileSync(resolve(root, "App/shell/tauri/src-tauri/src/lib.rs"), "utf8");
const nativeModule = ["native_os.rs", "native_workspace.rs", "native_pet.rs", "native_tray.rs", "native_browser_store.rs", "native_analytics.rs", "native_cli_install.rs", "native_agent_tool.rs", "native_signed_updater.rs", "native_memory_export.rs", "native_diagnostics.rs", "native_file_export.rs", "native_permissions.rs", "native_browser_extension.rs", "native_browser_inventory.rs", "native_browser.rs", "native_browser_surface.rs", "native_site_policy.rs", "native_approvals.rs"].map((name) =>
  readFileSync(resolve(root, `App/shell/tauri/src-tauri/src/${name}`), "utf8")
).join("\n");
for (const [, command] of bridgeObject.matchAll(/"(desktop_[a-z0-9_]+)"/g)) {
  if (!(rustHost + nativeModule).includes(`fn ${command}(`)) {
    throw new Error(`renderer references non-existent Rust command: ${command}`);
  }
  if (!rustHost.includes(command)) {
    throw new Error(`Rust command is not registered in invoke_handler: ${command}`);
  }
}
if (native.includes("onMainWindowFullScreenChanged")
  && !rustHost.includes("memmy:window-fullscreen-changed")) {
  throw new Error("fullscreen event is not emitted by the Rust host");
}
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
// Native child WebViews render untrusted remote pages in the same main OS Window.
 // A window-scoped Tauri capability would grant those pages first-party IPC rights.
const capability = JSON.parse(readFileSync(resolve(root, "App/shell/tauri/src-tauri/capabilities/default.json"), "utf8"));
if (capability.windows?.includes("main") || !capability.webviews?.includes("main") || !capability.webviews?.includes("pet")) {
  throw new Error("native Browser requires first-party-webview-only IPC capability; never grant by parent window");
}
const childHost = readFileSync(resolve(root, "App/shell/tauri/src-tauri/src/native_browser.rs"), "utf8");
if (!childHost.includes("on_navigation") || !childHost.includes("NewWindowResponse::Deny")
  || !childHost.includes("native browser commands require main application window")) {
  throw new Error("native Browser navigation/popups/source guards missing");
}
const tauriConfig = JSON.parse(readFileSync(resolve(root, "App/shell/tauri/src-tauri/tauri.conf.json"), "utf8"));
for (const name of ["width", "height", "minWidth", "minHeight"]) {
  const value = originalWindow[1].match(new RegExp(String.raw`\b${name}: (\d+)`));
  if (!value || Number(value[1]) !== tauriConfig.app.windows[0][name]) {
    throw new Error(`native Tauri ${name} diverged from original Electron UI window`);
  }
}
// Real Rust IPC exists, but the original Electron method supports five data
// categories. Tauri currently preserves safety by implementing only the
// native browsingHistory subset; cookies/cache/siteData/downloadHistory reject.
const PARTIAL_NATIVE_METHODS = new Map([
  ["clearBrowserData", "Only browsingHistory is implemented; four remaining selective categories fail closed"],
  ["downloadUpdate", "Signature-verified native downloader is wired; production signer public key and signed update feed are not yet provisioned"],
  ["onUpdateDownloadProgress", "Live signed-download progress is wired but needs real production signed release E2E"],
  ["openUpdateInstaller", "Installs only signature-verified in-process staged artifacts; cross-restart/cross-platform acceptance not yet verified"],
]);
for (const name of PARTIAL_NATIVE_METHODS.keys()) {
  if (!native.includes(name)) throw new Error("Partial-method marker must have real native bridge: " + name);
}
const manifest = {
  schemaVersion: 1,
  source: "App/shell/desktop/src/preload/preload.cts:MemmyPreloadApi",
  frontend: "App/frontend/desktop/src/main.tsx",
  uiPolicy: "reuse original React entrypoint, CSS, pages, routes, tabs and components",
  immutableUiSha256: uiHashes,
  fullFeatureParity: native.length === methods.length && PARTIAL_NATIVE_METHODS.size === 0,
  counts: {
    legacyMethods: methods.length,
    nativeMethods: native.length,
    remainingMethods: methods.length - native.length,
    partialNativeMethods: PARTIAL_NATIVE_METHODS.size,
    remainingFullBehaviorMethods: methods.length - native.length + PARTIAL_NATIVE_METHODS.size,
    routes: routes.length
  },
  routes: routes.map((path) => ({ path, status: "original-react-reused" })),
  methods: methods.map((name) => ({
    name,
    status: PARTIAL_NATIVE_METHODS.has(name) ? "PARTIAL_NATIVE_FUNCTIONALITY" :
      native.includes(name) ? "native-tauri-command-or-local-noop" : "NOT_MIGRATED",
    acceptance: PARTIAL_NATIVE_METHODS.get(name) ??
      (native.includes(name) ? "requires native E2E proof" : "must port and run original behavior E2E")
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
