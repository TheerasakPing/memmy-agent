import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBundle } from './audit-bundle.mjs';

/** Test the actual packaged RUST NativeRuntime supervisor. Unlike testing
 * three Node sidecars alone, this validates the same owned Rust service
 * startup / readiness / stop lifecycle that the first-party Tauri window uses.
 * The CLI flag intentionally does NOT initialize NSApplication or user data.
 */
export async function smokeMacNativeSupervisor(bundle, options = {}) {
  const app = resolve(bundle);
  const audit = auditBundle(app, 'darwin');
  if (!audit.ok) return { ok: false, reason: 'bundle-audit-failed', errors: audit.errors };
  const exe = join(app, 'Contents/MacOS/memmy-turbo-tauri');
  const metadata = lstatSync(exe);
  if (metadata.isSymbolicLink() || !metadata.isFile())
    return { ok: false, reason: 'unsafe-native-executable' };
  const home = mkdtempSync(join(tmpdir(), 'memmy-native-supervisor-'));
  let child;
  let timedOut = false;
  let stdout = '';
  let stderr = '';
  let timer;
  const terminateGroup = () => {
    if (!child?.pid) return;
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch { try { child.kill('SIGTERM'); } catch {} }
  };
  try {
    child = spawn(exe, ['--smoke-native-runtime'], {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8',
        HOME: home, TMPDIR: home, MEMMY_HOME: home,
        XDG_CONFIG_HOME: join(home, 'config'),
        XDG_DATA_HOME: join(home, 'data'),
        XDG_CACHE_HOME: join(home, 'cache'),
        // Do not inherit any user credentials, Node overrides or external
        // config: Rust config() itself creates per-run temporary credentials.
        MEMMY_CLOUD_SERVICE: 'https://api.memmy.cn',
      },
    });
    child.stdout.on('data', data => { stdout = (stdout + String(data)).slice(-4000); });
    child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-4000); });
    timer = setTimeout(() => { timedOut = true; terminateGroup(); },
      options.timeoutMs ?? 120000);
    timer.unref();
    const result = await new Promise(res => {
      child.once('error', error => res({ exitCode: null, error: error.code ?? 'spawn-failed' }));
      child.once('exit', exitCode => res({ exitCode }));
    });
    const ready = stderr.includes('PASS: packaged Memory + Local API + Agent Gateway start/stop');
    const ok = !timedOut && result.exitCode === 0 && ready;
    return { ok, app, isolatedHome: true,
      runtime: 'actual-rust-native-supervisor',
      nativeStartedAndStopped: ready, exitCode: result.exitCode, timedOut,
      ...(ok ? {} : { reason: result.error ?? 'native-supervisor-failed',
        stderrTail: stderr.slice(-1200), stdoutTail: stdout.slice(-600) }) };
  } finally {
    if (timer) clearTimeout(timer);
    terminateGroup();
    rmSync(home, { recursive: true, force: true });
  }
}

const target = process.argv[2] ?? 'src-tauri/target/debug/bundle/macos/Memmy Turbo Preview.app';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await smokeMacNativeSupervisor(target);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
