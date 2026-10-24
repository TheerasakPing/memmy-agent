/** Fail-closed release gate: do not publish a UI-only Tauri app. */
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function auditBundle(bundle, platform = process.platform) {
  const root = resolve(bundle);
  const errors = [];
  const requireFile = (relative, label) => {
    const path = join(root, relative);
    if (!existsSync(path) || !statSync(path).isFile()) errors.push(`${label} missing: ${relative}`);
  };
  if (platform === 'darwin') {
    requireFile('Contents/MacOS/memmy-turbo-tauri', 'Tauri GUI executable');
    requireFile('Contents/Info.plist', 'macOS bundle metadata');
  } else if (platform === 'win32') {
    if (!existsSync(root) || !readdirSync(root).some((name) => name.endsWith('.exe'))) errors.push('Windows GUI executable missing');
  } else {
    if (!existsSync(root)) errors.push('Linux package root missing');
  }
  // Runtime must live INSIDE the actual app/bundle, not in the developer checkout.
  const resources = platform === 'darwin' ? 'Contents/Resources/memmy-runtime' : 'memmy-runtime';
  for (const [part, label] of [
    ['bin/node', 'bundled Node runtime'],
    ['sidecar/memory.mjs', 'Memory startup shim'],
    ['sidecar/backend.mjs', 'Local API startup shim'],
    ['sidecar/gateway.mjs', 'Agent startup shim'],
    ['Memory/dist/src/server/index.js', 'compiled Memory Service'],
    ['App/backend/dist/src/index.js', 'compiled Local API'],
    ['App/memmy-agent/dist/main.js', 'compiled Agent Gateway'],
    ['node_modules/better-sqlite3/build/Release/better_sqlite3.node', 'SQLite native addon']
  ]) requireFile(join(resources, part), label);
  if (platform === 'darwin') {
    const nodePath = join(root, resources, 'bin/node');
    if (existsSync(nodePath) && (statSync(nodePath).mode & 0o111) === 0) errors.push('bundled Node is not executable');
  }
  return { ok: errors.length === 0, errors, checked: root };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node packaging/audit-bundle.mjs /path/to/Memmy\ Turbo\ Preview.app');
    process.exitCode = 2;
  } else {
    const result = auditBundle(target);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
}
