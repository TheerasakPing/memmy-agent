/**
 * Development-only Node Local API for the Tauri migration.
 * Rust owns this process; this script never searches for or imports Electron
 * user data. Production requires a signed, bundled runtime replacement.
 */
import { createLocalBackend } from "../../../backend/dist/src/index.js";
import { chmod, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const dataDir = process.env.MEMMY_TAURI_DATA_DIR;
if (!dataDir || !isAbsolute(dataDir)) {
  throw new Error("Tauri backend data directory is required");
}
if (process.env.MEMMY_TAURI_DEV_BACKEND !== "1") {
  throw new Error("Tauri development backend must be explicitly enabled");
}
const safeDirectory = resolve(dataDir);
await mkdir(safeDirectory, { recursive: true, mode: 0o700 });
const directoryMetadata = await lstat(safeDirectory);
if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
  throw new Error("Tauri backend data directory must be a real directory");
}
if (process.platform !== "win32") await chmod(safeDirectory, 0o700);
const runtimeConfigPath = join(safeDirectory, "runtime-config.json");
// Never trust a credential left by an earlier process after a crash.
await rm(runtimeConfigPath, { force: true });
process.env.MEMMY_HOME = safeDirectory;
process.env.MEMMY_CONFIG = join(safeDirectory, "config.yaml");

// Do not quietly connect a new installation to an old Electron Memory DB.
// Until the Rust Memory supervisor is ported, the developer must explicitly
// provide an independently managed, authenticated loopback Memory service.
if (!process.env.MEMMY_CLOUD_URL && !process.env.MEMMY_CLOUD_SERVICE) {
  throw new Error("Tauri development backend needs an explicit MEMMY_CLOUD_URL or MEMMY_CLOUD_SERVICE");
}
const memoryUrl = process.env.MEMMY_MEMORY_LAYER_URL;
if (!memoryUrl) throw new Error("MEMMY_MEMORY_LAYER_URL is required for the Tauri development backend");
const parsedMemoryUrl = new URL(memoryUrl);
if (parsedMemoryUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsedMemoryUrl.hostname) ||
    !parsedMemoryUrl.port || parsedMemoryUrl.pathname !== "/" ||
    parsedMemoryUrl.search || parsedMemoryUrl.hash || parsedMemoryUrl.username || parsedMemoryUrl.password) {
  throw new Error("Memory endpoint must be an explicit loopback HTTP origin");
}
// Large native profiles can briefly starve the Memory HTTP event loop after
// Rust's first successful readiness probe. A single 3-second fetch made the
// Backend exit and caused the supervisor to take down all three services.
// Retry within a bounded deadline; never bypass authenticated Memory health.
const memoryHealthDeadline = Date.now() + 15_000;
let memoryHealthStatus = "unreachable";
let memoryHealthy = false;
while (Date.now() < memoryHealthDeadline) {
  try {
    const response = await fetch(`${parsedMemoryUrl.origin}/api/v1/health`, {
      headers: process.env.MEMMY_MEMORY_LAYER_TOKEN
        ? { authorization: `Bearer ${process.env.MEMMY_MEMORY_LAYER_TOKEN}` }
        : {},
      signal: AbortSignal.timeout(2500)
    });
    memoryHealthStatus = `HTTP ${response.status}`;
    if (response.ok) {
      memoryHealthy = true;
      break;
    }
  } catch (error) {
    memoryHealthStatus = error?.name === "TimeoutError" ? "timeout" : "connection unavailable";
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
}
if (!memoryHealthy) {
  throw new Error(`configured Memory service is not healthy (${memoryHealthStatus})`);
}

let backend;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await backend?.close();
  } finally {
    // A previous instance must not delete a newer instance's credential.
    // Its shutdown may finish after Finder has already launched the new app.
    try {
      const current = JSON.parse(await readFile(runtimeConfigPath, "utf8"));
      if (backend?.runtimeConfig?.localToken &&
          current.localToken === backend.runtimeConfig.localToken &&
          current.baseUrl === backend.runtimeConfig.baseUrl) {
        await rm(runtimeConfigPath, { force: true });
      }
    } catch {
      // Missing/invalid file is not ours to remove; a new launch will rotate it.
    }
    process.exit(0);
  }
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
// Rust closes or kills this process when the owner window exits.
process.stdin.resume();
process.stdin.once("end", () => { void shutdown(); });

try {
  backend = await createLocalBackend({
    databasePath: join(safeDirectory, "app-state.sqlite"),
    memmyConfigPath: process.env.MEMMY_CONFIG,
    runtimeConfigPath,
    memoryBaseUrl: parsedMemoryUrl.origin,
    skipAgentMcpReload: true,
    // Never add arbitrary remote web origins to the native Local API.
    allowedOrigins: [
      "tauri://localhost",
      "http://tauri.localhost",
      "https://tauri.localhost",
      "http://127.0.0.1:19000"
    ]
  });
  // Reserved single-line readiness marker. Rust consumes this private pipe;
  // it is never forwarded to renderer logs or to a public URL.
  process.stdout.write(`MEMMY_TAURI_READY ${JSON.stringify(backend.runtimeConfig)}\n`);
} catch (error) {
  console.error("Tauri Local API bootstrap failed:", error instanceof Error ? error.message : "unknown error");
  await rm(runtimeConfigPath, { force: true });
  process.exitCode = 1;
  process.stdin.pause();
}
