import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBundle } from './audit-bundle.mjs';

/** Execute the existing full Memory -> Local API -> Agent Gateway E2E using
 * ONLY sidecars and Node physically shipped in the audited .app bundle.
 * Never writes to the developer's real HOME; does not launch the GUI.
 */
export async function smokeMacBundledServices(bundle, options = {}) {
  const app = resolve(bundle);
  const audit = auditBundle(app, 'darwin');
  if (!audit.ok) return { ok: false, reason: 'bundle-audit-failed', errors: audit.errors };
  const runtime = realpathSync(join(app, 'Contents/Resources/runtime'));
  const disposableHome = mkdtempSync(join(tmpdir(), 'memmy-bundled-services-'));
  const testFile = fileURLToPath(new URL('../sidecar/gateway.test.mjs', import.meta.url));
  const maxDurationMs = options.timeoutMs ?? 135000;
  let child;
  let timedOut = false;
  let output = '';
  let errorOutput = '';
  const terminateGroup = () => {
    if (!child?.pid) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
  };
  try {
    child = spawn(process.execPath, ['--test', '--test-concurrency=1', testFile], {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        // Explicitly allowlist the child environment: no user API keys,
        // cloud logins, local profile paths or background tooling secrets.
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        HOME: disposableHome,
        TMPDIR: disposableHome,
        MEMMY_HOME: disposableHome,
        XDG_DATA_HOME: join(disposableHome, '.local/share'),
        XDG_CONFIG_HOME: join(disposableHome, '.config'),
        XDG_CACHE_HOME: join(disposableHome, '.cache'),
        MEMMY_TAURI_BUNDLED_RUNTIME: runtime,
        NODE_OPTIONS: '--no-experimental-webstorage',
      },
    });
    child.stdout.on('data', bytes => { output = (output + String(bytes)).slice(-16000); });
    child.stderr.on('data', bytes => { errorOutput = (errorOutput + String(bytes)).slice(-6000); });
    const timeout = setTimeout(() => { timedOut = true; terminateGroup(); }, maxDurationMs);
    timeout.unref();
    const result = await new Promise(resolveResult => {
      child.once('error', error => resolveResult({ error: String(error), exitCode: null }));
      child.once('exit', (exitCode, signal) => resolveResult({ exitCode, signal }));
    });
    clearTimeout(timeout);
    const ok = !timedOut && result.exitCode === 0 &&
      /\bpass\s+1\b/u.test(output) && /\bfail\s+0\b/u.test(output);
    return { ok, app, sidecars: 'bundled-node-memory-local-api-agent-gateway',
      isolatedHome: true, authenticatedGateway: ok, exitCode: result.exitCode,
      timedOut, outputTail: output.slice(-3200),
      ...(ok ? {} : { stderrTail: errorOutput.slice(-2500), error: result.error }) };
  } finally {
    terminateGroup();
    rmSync(disposableHome, { recursive: true, force: true });
  }
}

const target = process.argv[2] ?? 'src-tauri/target/debug/bundle/macos/Memmy Turbo Preview.app';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await smokeMacBundledServices(target);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
