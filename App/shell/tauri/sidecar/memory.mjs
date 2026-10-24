/**
 * Debug-only managed Memory entry. The Rust owner selects the data directory,
 * loopback listener, session token and config. No arbitrary renderer command.
 * Packaged native binaries remain blocked pending signed sidecar distribution.
 */
import { main } from "../../../../Memory/dist/src/server/index.js";
import { isAbsolute, join, resolve } from "node:path";
import { lstat } from "node:fs/promises";

const directory = process.env.MEMMY_TAURI_DATA_DIR;
const port = Number(process.env.MEMMY_TAURI_MEMORY_PORT);
const token = process.env.MEMMY_MEMORY_TOKEN;
if (!directory || !isAbsolute(directory) || !Number.isInteger(port) || port < 1024 || port > 65535 ||
    !token || !/^[a-f0-9]{64}$/.test(token) || process.env.MEMMY_TAURI_DEV_BACKEND !== "1") {
  throw new Error("invalid Rust-managed Memory startup contract");
}
const path = resolve(directory);
const metadata = await lstat(path);
if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
  throw new Error("Memory data directory must be a real directory");
}
// Memory's SIGTERM handler gracefully stops its HTTP server and SQLite store.
// Rust first closes stdin, waits for shutdown, and force-kills only as fallback.
process.stdin.resume();
process.stdin.once("end", () => {
  process.kill(process.pid, "SIGTERM");
});
await main([
  "--config", join(path, "config.yaml"),
  "--db", join(path, "memory.sqlite"),
  "--host", "127.0.0.1",
  "--port", String(port)
]);
