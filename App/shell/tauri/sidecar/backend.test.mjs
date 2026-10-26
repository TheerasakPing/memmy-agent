import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

test("Backend retries transient Memory health failures before publishing readiness", { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "memmy-tauri-health-retry-"));
  let requests = 0;
  const memory = createServer((req, res) => {
    requests++;
    res.writeHead(requests <= 2 ? 503 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: requests > 2 }));
  });
  await new Promise((resolve) => memory.listen(0, "127.0.0.1", resolve));
  let owned;
  try {
    const { child } = await startBackend(directory, `http://127.0.0.1:${memory.address().port}`);
    owned = child;
    assert.ok(requests >= 3, "Backend must retry instead of failing the first health probe");
    await stopBackend(owned);
    owned = undefined;
  } finally {
    owned?.kill();
    await new Promise((resolve) => memory.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

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
    // Emulate a replacement app publishing its token while the previous
    // Backend is still draining. Old shutdown must not remove the new token.
    const replacement = { ...second.config, localToken: "new-owner-session-credential" };
    await writeFile(configPath, JSON.stringify(replacement), { mode: 0o600 });
    await stopBackend(second.child);
    owned = undefined;
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).localToken, replacement.localToken);
    await rm(configPath);
  } finally {
    owned?.kill();
    await new Promise((resolve) => memory.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});


test("Local API restores isolated SQLite and rotates credentials after SIGKILL", { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "memmy-tauri-crash-restart-"));
  let owned;
  const memory = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: req.url === "/api/v1/health" }));
  });
  await new Promise(resolve => memory.listen(0, "127.0.0.1", resolve));
  const memoryUrl = `http://127.0.0.1:${memory.address().port}`;
  const configPath = join(directory, "runtime-config.json");
  try {
    const first = await startBackend(directory, memoryUrl);
    owned = first.child;
    const before = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(before.localToken, first.config.localToken);
    const exited = new Promise(resolve => first.child.once("exit", resolve));
    assert.equal(first.child.kill("SIGKILL"), true);
    await exited;
    owned = undefined;
    // Crash leaves the prior credential; new startup must replace it safely.
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).localToken, first.config.localToken);
    const second = await startBackend(directory, memoryUrl);
    owned = second.child;
    assert.notEqual(second.config.localToken, first.config.localToken);
    const stale = await fetch(`${second.config.baseUrl}/api/app/bootstrap`, {
      headers: { Origin: "tauri://localhost", "x-memmy-local-token": first.config.localToken }
    });
    assert.equal(stale.status, 401);
    const current = await fetch(`${second.config.baseUrl}/api/app/bootstrap`, {
      headers: { Origin: "tauri://localhost", "x-memmy-local-token": second.config.localToken }
    });
    assert.equal(current.status, 200);
    await stopBackend(second.child);
    owned = undefined;
    await assert.rejects(readFile(configPath));
  } finally {
    owned?.kill();
    await new Promise(resolve => memory.close(resolve));
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
