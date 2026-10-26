import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tauriManagedMemoryWorkerPolicy } from "../src/server/tauri-startup-policy.js";

const temporaryDirs: string[] = [];
afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Tauri Memory worker startup policy", () => {
  it("leaves Original Electron and normal Memory server unchanged", () => {
    expect(tauriManagedMemoryWorkerPolicy("/users/test/.memmy/config.yaml", {})).toEqual({});
    expect(tauriManagedMemoryWorkerPolicy("/data/preview/config.yaml", {
      MEMMY_TAURI_DATA_DIR: "/data/preview"
    })).toEqual({});
  });

  it("keeps small native profiles in normal auto-worker mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "memmy-worker-policy-small-"));
    temporaryDirs.push(dir);
    writeFileSync(join(dir, "memory.sqlite"), "small");
    expect(tauriManagedMemoryWorkerPolicy(join(dir, "config.yaml"), {
      MEMMY_TAURI_DATA_DIR: dir,
      MEMMY_TAURI_DEV_BACKEND: "1"
    })).toEqual({
      workerStartupFallbackMs: 180_000,
      workerPostHealthDelayMs: 30_000,
      pauseBackgroundWorkers: false
    });
  });

  it("pauses only automatic workers for a large native profile", () => {
    const dir = mkdtempSync(join(tmpdir(), "memmy-worker-policy-large-"));
    temporaryDirs.push(dir);
    const file = join(dir, "memory.sqlite");
    writeFileSync(file, "x");
    truncateSync(file, 512 * 1024 * 1024);
    const env = { MEMMY_TAURI_DATA_DIR: dir, MEMMY_TAURI_DEV_BACKEND: "1" };
    expect(tauriManagedMemoryWorkerPolicy(join(dir, "config.yaml"), env)).toMatchObject({
      pauseBackgroundWorkers: true
    });
    expect(tauriManagedMemoryWorkerPolicy(join(dir, "elsewhere", "config.yaml"), env)).toEqual({});
    expect(tauriManagedMemoryWorkerPolicy(join(dir, "config.yaml"), {
      ...env,
      MEMMY_TAURI_DEV_BACKEND: "0"
    })).toEqual({});
  });
});
