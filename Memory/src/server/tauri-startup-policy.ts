import { dirname, join, resolve } from "node:path";
import { lstatSync } from "node:fs";

/** Defer expensive replay/worker reconciliation until the native supervisor
 * has authenticated the Memory HTTP service and other sidecars can start.
 * Original Electron, CLI and all other servers retain their existing policy.
 */
export function tauriManagedMemoryWorkerPolicy(
  configPath: string,
  env: NodeJS.ProcessEnv = process.env
): { workerStartupFallbackMs?: number; workerPostHealthDelayMs?: number; pauseBackgroundWorkers?: boolean } {
  const dataDir = env.MEMMY_TAURI_DATA_DIR;
  if (env.MEMMY_TAURI_DEV_BACKEND !== "1" || !dataDir
      || resolve(dirname(configPath)) !== resolve(dataDir)) return {};
  // The legacy 1GB+ SQLite profiles can stall the primary Node event loop
  // for minutes in startup policy reconciliation. Never let that block health,
  // desktop UI, or on-demand Memory reads. Small profiles remain fully automatic.
  let pauseBackgroundWorkers = false;
  try {
    const db = lstatSync(join(dataDir, "memory.sqlite"));
    pauseBackgroundWorkers = db.isFile() && db.size >= 512 * 1024 * 1024;
  } catch { /* New user: database does not exist yet. */ }
  return {
    pauseBackgroundWorkers,
    // Longer than Rust's bounded Memory bootstrap budget, so the first
    // authenticated /api/v1/health isn't starved by synchronous DB replay.
    workerStartupFallbackMs: 180_000,
    workerPostHealthDelayMs: 30_000
  };
}
