/** Fail-closed release gate: do not publish a UI-only Tauri app. */
import { existsSync, lstatSync, statSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reject broken/external npm workspace symlinks in the packaged runtime.
 * Allow links ONLY if realpath resolves inside this app, never in a checkout.
 * Do not follow symlink directories during this walk.
 */
export function auditBundleSymlinks(root, relativePaths) {
  const errors = [];
  let visited = 0;
  const canonicalRoot = realpathSync(root);
  const withinRoot = (destination) => {
    const rest = relative(canonicalRoot, destination);
    return rest === '' || (rest !== '..' && !rest.startsWith('..' + sep) && !isAbsolute(rest));
  };
  const stack = relativePaths.map(name => join(root, name));
  while (stack.length) {
    if (++visited > 250_000) {
      errors.push('bundle dependency tree exceeds 250000 entries');
      break;
    }
    const path = stack.pop();
    let metadata;
    try {
      metadata = lstatSync(path);
    } catch {
      errors.push('bundle dependency directory missing/unreadable: ' + relative(root,path));
      continue;
    }
    if (metadata.isSymbolicLink()) {
      try {
        const target = realpathSync(path);
        if (!withinRoot(target)) {
          errors.push('bundle symlink escapes app: ' + relative(root,path));
        }
      } catch {
        errors.push('bundle symlink is broken: ' + relative(root,path));
      }
      continue;
    }
    if (!metadata.isDirectory()) continue;
    let children;
    try {
      children = readdirSync(path);
    } catch {
      errors.push('bundle dependency directory unreadable: ' + relative(root,path));
      continue;
    }
    for (const name of children) stack.push(join(path,name));
    if (errors.length >= 24) break;
  }
  return errors;
}

export function auditBundle(bundle, platform = process.platform) {
  const root = resolve(bundle);
  const errors = [];
  const requireFile = (relative, label) => {
    const path = join(root, relative);
    let valid = false;
    try { valid = existsSync(path) && statSync(path).isFile(); } catch { valid = false; }
    if (!valid) errors.push(`${label} missing: ${relative}`);
  };
  if (platform === 'darwin') {
    requireFile('Contents/MacOS/memmy-turbo-tauri', 'Tauri GUI executable');
    requireFile('Contents/Info.plist', 'macOS bundle metadata');
  } else if (platform === 'win32') {
    if (!existsSync(root) || !readdirSync(root).some((name) => name.endsWith('.exe'))) errors.push('Windows GUI executable missing');
  } else {
    if (!existsSync(root)) errors.push('Linux package root missing');
  }
  // Browser Computer Use must ship the genuine MV3 extension, never a GUI-only stub.
  const extensionDir = platform === 'darwin' ? 'Contents/Resources/browser-extension' : 'browser-extension';
  for (const name of ['manifest.json', 'background.js', 'history-content.js', 'history-sensor.js']) {
    requireFile(join(extensionDir, name), 'bundled Browser Extension');
  }
  if (existsSync(join(root, extensionDir, 'manifest.json'))) {
    try {
      const manifest = JSON.parse(readFileSync(join(root, extensionDir, 'manifest.json'), 'utf8'));
      if (manifest.manifest_version !== 3 || manifest.background?.service_worker !== 'background.js') {
        errors.push('bundled Browser Extension is not an expected MV3 service-worker extension');
      }
    } catch { errors.push('bundled Browser Extension manifest is invalid'); }
  }
  // Runtime must live INSIDE the actual app/bundle, not in the developer checkout.
  const resources = platform === 'darwin' ? 'Contents/Resources/runtime' : 'runtime';
  for (const [part, label] of [
    ['node', 'bundled Node runtime'],
    ['App/shell/tauri/sidecar/memory.mjs', 'Memory startup shim'],
    ['App/shell/tauri/sidecar/backend.mjs', 'Local API startup shim'],
    ['App/shell/tauri/sidecar/gateway.mjs', 'Agent startup shim'],
    ['Memory/dist/src/server/index.js', 'compiled Memory Service'],
    ['Memory/dist/src/cli/index.js', 'bundled Memory CLI entrypoint'],
    ['App/backend/dist/src/index.js', 'compiled Local API'],
    ['App/memmy-agent/dist/main.js', 'compiled Agent Gateway'],
    ['node_modules/better-sqlite3/build/Release/better_sqlite3.node', 'SQLite native addon']
  ]) requireFile(join(resources, part), label);
  // Release fail-closed: a relocated app cannot reference the build host.
  const scanPaths = [resources, extensionDir].filter(path => existsSync(join(root,path)));
  if (existsSync(root)) errors.push(...auditBundleSymlinks(root, scanPaths));
  if (platform === 'darwin') {
    const nodePath = join(root, resources, 'node');
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
