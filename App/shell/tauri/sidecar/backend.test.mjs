import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = new URL("./backend.mjs", import.meta.url);
const timeout = 35_000;

async function startBackend(directory, memoryUrl) {
  const child = spawn(process.execPath, [fileURLToPath(script)], {
    env: { ...process.env, MEMMY_TAURI_DATA_DIR: directory, MEMMY_TAURI_DEV_BACKEND: "1", MEMMY_MEMORY_LAYER_URL: memoryUrl, MEMMY_CLOUD_URL: memoryUrl },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let errors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-4096); });
  const startup = new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (!line.startsWith("MEMMY_TAURI_READY ")) return;
      resolve(JSON.parse(line.slice("MEMMY_TAURI_READY ".length)));
    });
    child.once("exit", (code) => reject(new Error(`Local API exited ${code}: ${errors}`)));
  });
  try {
    return { child, config: await Promise.race([
      startup,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Local API timed out: ${errors}`)), timeout).unref())
    ]) };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function stopBackend(child) {
  const done = new Promise((resolve) => child.once("exit", resolve));
  child.stdin.end();
  await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("Local API would not stop")), 5000).unref())]);
}

test("Tauri-owned Local API starts on loopback, validates origins/auth and closes cleanly", { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "memmy-tauri-sidecar-e2e-"));
  let owned;
  // Isolated local Memory health fixture. This smoke validates the Local API
  // boundary, not native Memory feature parity or Agent gateway readiness.
  const memory = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: req.url === "/api/v1/health" }));
  });
  await new Promise((resolve) => memory.listen(0, "127.0.0.1", resolve));
  const memoryUrl = `http://127.0.0.1:${memory.address().port}`;
  try {
    const first = await startBackend(directory, memoryUrl);
    owned = first.child;
    assert.match(first.config.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(first.config.localToken.length >= 32);
    const configPath = join(directory, "runtime-config.json");
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    const health = await fetch(`${first.config.baseUrl}/api/health`, { headers: { Origin: "tauri://localhost" } });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    const forbidden = await fetch(`${first.config.baseUrl}/api/health`, { headers: { Origin: "https://evil.example" } });
    assert.equal(forbidden.status, 403);
    const noToken = await fetch(`${first.config.baseUrl}/api/app/bootstrap`, { headers: { Origin: "tauri://localhost" } });
    assert.equal(noToken.status, 401);
    await stopBackend(first.child);
    owned = undefined;
    await assert.rejects(readFile(configPath));
    const second = await startBackend(directory, memoryUrl);
    owned = second.child;
    assert.notEqual(second.config.localToken, first.config.localToken, "session credential must rotate");
    const staleToken = await fetch(`${second.config.baseUrl}/api/app/bootstrap`, {
      headers: { Origin: "tauri://localhost", "x-memmy-local-token": first.config.localToken }
    });
    assert.equal(staleToken.status, 401);
    await stopBackend(second.child);
    owned = undefined;
  } finally {
    owned?.kill();
    await new Promise((resolve) => memory.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});


test("Tauri development sidecar rejects remote Memory endpoints before API bootstrap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memmy-tauri-sidecar-deny-"));
  try {
    await assert.rejects(
      startBackend(directory, "https://evil.example/"),
      /Memory endpoint must be an explicit loopback HTTP origin/
    );
    await assert.rejects(readFile(join(directory, "runtime-config.json")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
