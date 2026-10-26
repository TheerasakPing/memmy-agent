#!/usr/bin/env node
/**
 * R8 live (potentially billable) model matrix E2E. No mock provider is allowed.
 * MUST explicitly opt in; requires a local Gateway, a bootstrap secret and
 * a complete preset allowlist. Logs only state, never text, tokens or secrets.
 *
 * MEMMY_R8_REAL_MODELS=YES
 * MEMMY_R8_GATEWAY_URL=http://127.0.0.1:<gateway-port>
 * MEMMY_R8_GATEWAY_SECRET=<from isolated test gateway>
 * MEMMY_R8_PRESETS=presetA,presetB  (explicit names, ALL expected presets)
 */
import { randomUUID } from "node:crypto";

const base = process.env.MEMMY_R8_GATEWAY_URL;
const secret = process.env.MEMMY_R8_GATEWAY_SECRET;
const expected = (process.env.MEMMY_R8_PRESETS ?? "").split(",").map(x => x.trim()).filter(Boolean);
if (new Set(expected).size !== expected.length) {
  throw Error("model-matrix-has-duplicate-preset");
}
if (process.env.MEMMY_R8_REAL_MODELS !== "YES" || !base || !secret || !expected.length) {
  console.error("NOT_RUN: explicit live-model opt-in, local gateway, secret and preset matrix required");
  process.exit(2);
}
const origin = new URL(base);
if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
    origin.username || origin.password || origin.search || origin.hash) {
  throw Error("Refusing non-loopback or credential-bearing Gateway URL");
}
const timeout = ms => AbortSignal.timeout(ms);
const bootstrap = await fetch(new URL("/webui/bootstrap", origin), {
  headers: { "X-Memmy-Agent-Auth": secret },
  signal: timeout(10_000)
});
if (!bootstrap.ok) throw Error("gateway-bootstrap-" + bootstrap.status);
const boot = await bootstrap.json();
if (!boot.token || !boot.ws_path) throw Error("gateway bootstrap incomplete");
const settingsResponse = await fetch(new URL("/api/settings", origin), {
  headers: { Authorization: "Bearer " + boot.token },
  signal: timeout(10_000)
});
if (!settingsResponse.ok) throw Error("settings-" + settingsResponse.status);
const settings = await settingsResponse.json();
const available = new Set((settings.model_presets ?? []).filter(x => x.available).map(x => x.name));
for (const preset of expected) {
  if (!available.has(preset)) throw Error("requested-model-not-configured:" + preset);
}
// Strict completeness gate: no configured available preset may silently be skipped.
const omitted = [...available].filter(x => !expected.includes(x));
if (omitted.length) throw Error("model-matrix-incomplete: " + omitted.length + " available presets omitted");
const wsUrl = new URL(boot.ws_path, origin);
wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
wsUrl.searchParams.set("token", boot.token);
wsUrl.searchParams.set("client_id", "r8-e2e-" + randomUUID());
wsUrl.searchParams.set("client_surface", "gui");
const ws = new WebSocket(wsUrl);
const events = [];
ws.addEventListener("message", e => {
  try {
    const value = JSON.parse(String(e.data));
    if (value && typeof value === "object") events.push(value);
    if (events.length > 25_000) events.splice(0, 5_000);
  } catch { /* malformed frame will fail the next bounded wait */ }
});
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
async function waitFor(predicate, since, ms, label) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = events.slice(since).find(predicate);
    if (found) return found;
    if (ws.readyState >= 2) throw Error("socket-closed-during-" + label);
    await sleep(80);
  }
  throw Error("timeout-" + label);
}
const results = [];
try {
  await waitFor(e => e.event === "ready", 0, 15_000, "ready");
  for (const preset of expected) {
    const chatRequestId = randomUUID();
    const chatCursor = events.length;
    ws.send(JSON.stringify({ type: "new_chat", client_request_id: chatRequestId, model_preset: preset }));
    const attached = await waitFor(e => e.event === "attached" && e.client_request_id === chatRequestId &&
      typeof e.chat_id === "string" && e.model_selection, chatCursor, 30_000, "new-chat");
    if (attached.model_selection.preset_id !== preset) throw Error("wrong-preset-selected:" + preset);
    const chatId = attached.chat_id;
    const requestId = randomUUID();
    const prompt = "R8 E2E smoke: reply in one short sentence. Do not run tools or modify files.";
    const sentAt = Date.now();
    const cursor = events.length;
    ws.send(JSON.stringify({ type: "message", chat_id: chatId, content: prompt, webui: true, client_request_id: requestId }));
    await waitFor(e => e.event === "turn_end" && e.chat_id === chatId, cursor, 180_000, "model-turn-" + preset);
    const turnEvents = events.slice(cursor).filter(e => e.chat_id === chatId);
    const answerEvents = turnEvents.filter(e => e.event === "message" &&
      !["user", "tool_hint", "progress", "reasoning"].includes(e.kind) &&
      !e.metadata?.toolHint && !e.metadata?.agentProgress &&
      (typeof e.content === "string" || typeof e.text === "string"));
    const replyReceived = answerEvents.some(e => {
      const text = String(e.content ?? e.text).trim();
      return text.length > 0 && text !== prompt && !e.model_error;
    });
    const errors = turnEvents.filter(e => e.event === "error" ||
      e.event === "model_error" || e.model_error);
    if (errors.length || !replyReceived) throw Error("model-no-valid-reply:" + preset);
    // Session persistence may lag behind turn_end. Poll instead of racing
    // asynchronous disk writes and falsely declaring the model broken.
    let persisted = false;
    const persistenceDeadline = Date.now() + 20_000;
    while (!persisted && Date.now() < persistenceDeadline) {
      const sessionsResponse = await fetch(new URL("/api/sessions", origin), {
        headers: { Authorization: "Bearer " + boot.token }, signal: timeout(5_000)
      });
      if (!sessionsResponse.ok) throw Error("sessions-" + sessionsResponse.status);
      const snapshot = await sessionsResponse.json();
      persisted = Array.isArray(snapshot.sessions) && snapshot.sessions.some(s =>
        s.key === chatId || s.key === "websocket:" + chatId);
      if (!persisted) await sleep(250);
    }
    if (!persisted) throw Error("session-not-persisted:" + preset);
    results.push({ preset, replied: true, sessionPersisted: true, latencyMs: Date.now() - sentAt });
    console.log(JSON.stringify({ preset, modelReply: "PASS", sessionPersistence: "PASS" }));
  }
} finally {
  ws.close();
}
console.log(JSON.stringify({ gate: "live-model-matrix", completed: results.length, expected: expected.length,
  status: results.length === expected.length ? "PASS" : "FAIL", results }));
