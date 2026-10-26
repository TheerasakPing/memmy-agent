import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const requireAgent = createRequire(fileURLToPath(new URL("../../../memmy-agent/package.json", import.meta.url)));
const { WebSocketServer } = requireAgent("ws");
const script = fileURLToPath(new URL("./r8-live-model-matrix.mjs", import.meta.url));

async function withMockGateway(fn) {
  const sessions = [];
  const secret = "fixture-only-secret";
  const server = createServer((req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.url === "/webui/bootstrap") {
      return req.headers["x-memmy-agent-auth"] === secret
        ? send(200, { token: "fixture-token", ws_path: "/ws", expires_in: 600, model_name: "fixture" })
        : send(401, {});
    }
    if (req.headers.authorization !== "Bearer fixture-token") return send(401, {});
    if (req.url === "/api/settings") return send(200, {
      agent: { model_preset: null },
      model_presets: ["alpha", "beta"].map(name => ({
        name, provider: "fixture", model: name, is_default: name === "alpha", available: true
      }))
    });
    if (req.url === "/api/sessions") return send(200, { sessions: sessions.map(key => ({ key })) });
    return send(404, {});
  });
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", socket => {
    socket.send(JSON.stringify({ event: "ready" }));
    socket.on("message", payload => {
      const frame = JSON.parse(String(payload));
      if (frame.type === "new_chat") {
        const chatId = randomUUID();
        sessions.push("websocket:" + chatId);
        socket.send(JSON.stringify({
          event: "attached", chat_id: chatId, client_request_id: frame.client_request_id,
          model_selection: {
            preset_id: frame.model_preset, provider: "fixture", endpoint_id: "fixture",
            protocol: "openai", model: frame.model_preset, source: "byok", capabilities: []
          }
        }));
      } else if (frame.type === "message") {
        socket.send(JSON.stringify({ event: "message", chat_id: frame.chat_id,
          kind: "assistant", content: "Fixture response" }));
        socket.send(JSON.stringify({ event: "turn_end", chat_id: frame.chat_id }));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await fn({ port: server.address().port, secret });
  } finally {
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
}

async function runMatrix({ port, secret, presets }) {
  return await new Promise(resolve => {
    const child = spawn(process.execPath, [script], {
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        MEMMY_R8_REAL_MODELS: "YES",
        MEMMY_R8_GATEWAY_URL: `http://127.0.0.1:${port}`,
        MEMMY_R8_GATEWAY_SECRET: secret,
        MEMMY_R8_PRESETS: presets
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 18_000);
    child.stdout.on("data", b => { output += String(b); });
    child.stderr.on("data", b => { output += String(b); });
    child.once("close", code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

test("R8 WebUI model matrix protocol tests each available preset and session persistence", { timeout: 25000 }, async () => {
  await withMockGateway(async ({ port, secret }) => {
    const result = await runMatrix({ port, secret, presets: "alpha,beta" });
    assert.equal(result.code, 0, result.output.slice(-1000));
    assert.match(result.output, /"completed":2/);
    assert.match(result.output, /"status":"PASS"/);
  });
});

test("R8 model-matrix refuses to certify a skipped available model", { timeout: 25000 }, async () => {
  await withMockGateway(async ({ port, secret }) => {
    const result = await runMatrix({ port, secret, presets: "alpha" });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /model-matrix-incomplete/);
  });
});
