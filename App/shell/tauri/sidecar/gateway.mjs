/** Development-only Agent Gateway startup. A fixed, child-owned CLI and a
 * separately initialized Tauri directory; no renderer command execution. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutateRuntimeConfig } from '@memmy/migrations';

const home = process.env.MEMMY_TAURI_DATA_DIR;
const memoryUrl = process.env.MEMMY_MEMORY_URL;
const memoryToken = process.env.MEMMY_MEMORY_TOKEN;
const wsPort = Number(process.env.MEMMY_TAURI_GATEWAY_WS_PORT);
const healthPort = Number(process.env.MEMMY_TAURI_GATEWAY_HEALTH_PORT);
const validPort = (p) => Number.isInteger(p) && p > 1023 && p <= 65535;
if (process.env.MEMMY_TAURI_DEV_GATEWAY !== '1' || !home || !isAbsolute(home)
    || !validPort(wsPort) || !validPort(healthPort) || wsPort === healthPort
    || !memoryToken || !memoryUrl) {
  throw new Error('invalid native development Agent Gateway launch contract');
}
const memUrl = new URL(memoryUrl);
if (memUrl.protocol !== 'http:' || memUrl.hostname !== '127.0.0.1'
    || !memUrl.port || memUrl.pathname !== '/' || memUrl.search || memUrl.hash) {
  throw new Error('Gateway memory endpoint must be a loopback-only origin');
}
const directory = resolve(home);
const stat = await lstat(directory);
if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe native runtime data directory');
const workspace = join(directory, 'workspace');
await mkdir(workspace, { recursive: true, mode: 0o700 });
const secret = randomBytes(32).toString('hex');
const configPath = join(directory, 'config.yaml');
await mutateRuntimeConfig(configPath, (config) => {
  const channels = config.channels && typeof config.channels === 'object' ? config.channels : {};
  const websocket = channels.websocket && typeof channels.websocket === 'object' ? channels.websocket : {};
  channels.websocket = {
    ...websocket, enabled: true, host: '127.0.0.1', port: wsPort,
    tokenIssueSecret: secret, websocketRequiresToken: true, tokenTtlS: 3600,
    // This list filters sender IDs, NOT HTTP Origins. WebSocket auth still
    // requires a issued token; the listener is bound to 127.0.0.1 only.
    allowFrom: ['*'],
  };
  config.channels = channels;
  const gateway = config.gateway && typeof config.gateway === 'object' ? config.gateway : {};
  config.gateway = { ...gateway, host: '127.0.0.1', port: healthPort };
  const agents = config.agents && typeof config.agents === 'object' ? config.agents : {};
  const defaults = agents.defaults && typeof agents.defaults === 'object' ? agents.defaults : {};
  agents.defaults = { ...defaults, workspace };
  config.agents = agents;
  return config;
}, { createIfMissing: false });

const agentScript = fileURLToPath(new URL('../../../../App/memmy-agent/dist/main.js', import.meta.url));
const child = spawn(process.execPath, [agentScript, 'gateway', '--config', configPath,
  '--workspace', workspace, '--host', '127.0.0.1', '--port', String(healthPort)], {
  env: {
    ...process.env,
    MEMMY_HOME: directory,
    MEMMY_CONFIG: configPath,
    MEMMY_AGENT_DATA_DIR: directory,
    // Always derive the inherited global approval path from the managed data root.
    MEMMY_NATIVE_APP_ALLOW_ALL_FILE: join(directory, 'computer-use', 'allow-all-apps.json'),
    MEMMY_AGENT_WORKSPACE: workspace,
    MEMMY_MEMORY_URL: memoryUrl,
    MEMMY_MEMORY_TOKEN: memoryToken,
    MEMORY_SERVICE_URL: memoryUrl,
    MEMORY_SERVICE_TOKEN: memoryToken,
    MEMMY_DESKTOP_MANAGED_GATEWAY: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let tail = '';
let settled = false;
child.stdout.on('data', (chunk) => { tail = (tail + String(chunk)).slice(-4096); });
child.stderr.on('data', (chunk) => { tail = (tail + String(chunk)).slice(-4096); });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 4000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdin.resume();
process.stdin.once('end', stop);
child.on('exit', (code) => {
  if (!stopping && !settled) console.error(`native Agent Gateway exited before readiness (exit ${code}): ${tail.slice(-1200)}`);
  process.exitCode = code === 0 && stopping ? 0 : 1;
  process.stdin.pause();
});
const agentUrl = `http://127.0.0.1:${wsPort}`;
const deadline = Date.now() + 45000;
while (Date.now() < deadline && !stopping && child.exitCode === null) {
  const response = await fetch(`${agentUrl}/webui/bootstrap`, {
    headers: { 'x-memmy-agent-auth': secret }, signal: AbortSignal.timeout(1500)
  }).catch(() => null);
  if (response?.ok) {
    settled = true;
    process.stdout.write(`MEMMY_TAURI_GATEWAY_READY ${JSON.stringify({ baseUrl: agentUrl, bootstrapSecret: secret })}\n`);
    break;
  }
  await new Promise((r) => setTimeout(r, 250));
}
if (!settled) {
  console.error(`native Agent Gateway not ready: ${tail.slice(-1500)}`);
  stop();
  process.exitCode = 1;
}
