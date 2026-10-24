/** Real Memory + Local API smoke; this is not complete native Agent parity. */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const done = new Promise((resolve) => child.once("exit", resolve));
  child.stdin.end();
  await Promise.race([
    done,
    new Promise((_, reject) => setTimeout(() => reject(new Error("sidecar failed to stop")), 7000).unref())
  ]);
}

async function health(url, token) {
  const response = await fetch(`${url}/api/v1/health`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body.ok && body.storage?.ready && typeof body.serviceVersion === "string" ? body : null;
}

async function waitForMemory(child, url, token) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Memory child exited ${child.exitCode}`);
    try {
      const status = await health(url, token);
      if (status) return status;
    } catch { /* service is still booting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Memory readiness timed out");
}

test("real Memory server and Local API share isolated native config and terminate cleanly", { timeout: 100_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "memmy-tauri-real-memory-"));
  const port = await freePort();
  const token = randomBytes(32).toString("hex");
  const url = `http://127.0.0.1:${port}`;
  const configPath = join(directory, "config.yaml");
  await writeFile(configPath, JSON.stringify({ memmyMemory: {
    agentAccess: { autoScanKnownAgents: false, watchFileChanges: false, autoInjectSkill: false }
  } }), { mode: 0o600 });
  const memory = spawn(process.execPath, [fileURLToPath(new URL("./memory.mjs", import.meta.url))], {
    env: {
      ...process.env, MEMMY_TAURI_DEV_BACKEND: "1", MEMMY_TAURI_DATA_DIR: directory,
      MEMMY_TAURI_MEMORY_PORT: String(port), MEMMY_MEMORY_TOKEN: token,
      MEMMY_MEMORY_LAYER_TOKEN: token, MEMMY_MEMORY_MODE: "local", MEMMY_MEMORY_BACKEND: "sqlite",
      MEMMY_MEMORY_DB: join(directory, "memory.sqlite"), MEMMY_MEMORY_URL: url,
      MEMMY_CONFIG: configPath
    },
    stdio: ["pipe", "ignore", "pipe"]
  });
  let memoryErrors = "";
  memory.stderr.on("data", (bytes) => { memoryErrors = (memoryErrors + bytes).slice(-1600); });
  let backend;
  try {
    const status = await waitForMemory(memory, url, token).catch((err) => {
      throw new Error(`${err.message}; logs: ${memoryErrors}`);
    });
    assert.equal(status.storage.ready, true);
    assert.ok(status.capabilities.routes.includes("GET /api/v1/health"));
    const unauthorizedMemory = await fetch(`${url}/api/v1/memory/search`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    });
    assert.equal(unauthorizedMemory.status, 401, "Memory must enforce service token");
    const authorizedMemory = await fetch(`${url}/api/v1/memory/search`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}"
    });
    assert.notEqual(authorizedMemory.status, 401, "Memory must accept the real service token");
    const backendProcess = spawn(process.execPath, [fileURLToPath(new URL("./backend.mjs", import.meta.url))], {
      env: {
        ...process.env, MEMMY_TAURI_DEV_BACKEND: "1", MEMMY_TAURI_DATA_DIR: directory,
        MEMMY_MEMORY_LAYER_URL: url, MEMMY_MEMORY_LAYER_TOKEN: token, MEMMY_CLOUD_URL: url
      }, stdio: ["pipe", "pipe", "pipe"]
    });
    backend = backendProcess;
    const logs = [];
    backend.stderr.on("data", (bytes) => logs.push(String(bytes)));
    const config = await Promise.race([
      new Promise((resolve, reject) => {
        const lines = createInterface({ input: backend.stdout });
        lines.on("line", (line) => {
          if (line.startsWith("MEMMY_TAURI_READY ")) resolve(JSON.parse(line.slice(18)));
        });
        backend.once("exit", (code) => reject(new Error(`Backend exited ${code}: ${logs.join("")}`)));
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Backend startup timed out")), 25_000).unref())
    ]);
    assert.equal(config.memory.baseUrl, url);
    assert.match(config.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    const unauthorizedBackend = await fetch(`${config.baseUrl}/api/app/bootstrap`);
    assert.equal(unauthorizedBackend.status, 401);
    const authorizedBackend = await fetch(`${config.baseUrl}/api/app/bootstrap`, {
      headers: { "x-memmy-local-token": config.localToken }
    });
    assert.equal(authorizedBackend.status, 200);
    assert.equal((await stat(join(directory, "memory.sqlite"))).isFile(), true);
    assert.equal((await stat(join(directory, "runtime-config.json"))).mode & 0o777, 0o600);
    await stop(backend); backend = undefined;
    await assert.rejects(readFile(join(directory, "runtime-config.json")));
    await stop(memory);
    await assert.rejects(fetch(`${url}/api/v1/health`, { signal: AbortSignal.timeout(500) }));
  } finally {
    backend?.kill(); memory.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
