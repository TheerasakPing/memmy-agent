import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { auditBundle } from './audit-bundle.mjs';

/** Run a genuine bundled Memory CLI without touching the actual user's HOME. */
export function smokeMacApp(bundle) {
  const app = resolve(bundle);
  const audit = auditBundle(app, 'darwin');
  if (!audit.ok) return { ok: false, errors: audit.errors };
  const runtime = join(app, 'Contents/Resources/runtime');
  const home = mkdtempSync(join(tmpdir(), 'memmy-tauri-smoke-'));
  try {
    const node = join(runtime, 'node');
    const cli = join(runtime, 'Memory/dist/src/cli/index.js');
    const result = spawnSync(node, [cli, '--help'], {
      encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
      env: { ...process.env, HOME: home, MEMMY_HOME: home,
        NODE_OPTIONS: '--no-experimental-webstorage' }
    });
    if (result.error || result.status !== 0) return {
      ok: false, errors: ['bundled Memory CLI process did not complete successfully'],
      exitCode: result.status
    };
    if (!result.stdout.includes('memmy-memory') || !result.stdout.includes('Commands:')) return {
      ok: false, errors: ['bundled Memory CLI did not provide the expected real command help']
    };
    return { ok: true, app, cli: 'memmy-memory', isolatedHome: true };
  } finally { rmSync(home, { recursive: true, force: true }); }
}

const target = process.argv[2] ?? 'src-tauri/target/debug/bundle/macos/Memmy Turbo Preview.app';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = smokeMacApp(target);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
