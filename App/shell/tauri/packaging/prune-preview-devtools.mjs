/** Remove known build/test-only top-level packages from a copied Preview runtime.
 * Do not prune typescript: Memory manifest-parsers imports it at runtime.
 * This intentionally avoids transitive dependency pruning and NEVER targets the installed app.
 */
import { existsSync, lstatSync, rmSync, statSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';

export const DEV_ONLY_NAMES = Object.freeze([
  'vitest', '@vitest', 'happy-dom', 'electron-winstaller',
  'electron-builder', 'electron', '@electron',
  'eslint', '@eslint', '@eslint-community', 'prettier',
  '@vitest', 'tsx', 'ts-node',
]);

export function planPrune(stage, installedApp, names = DEV_ONLY_NAMES) {
  const root = resolve(stage);
  const installed = installedApp ? resolve(installedApp) : null;
  if (installed && (root === installed || root.startsWith(installed + sep) || installed.startsWith(root + sep))) {
    throw new Error('refusing to modify installed application');
  }
  const runtime = join(root, 'Contents/Resources/runtime');
  if (!existsSync(join(runtime, 'App/memmy-agent/dist/main.js')) ||
      !existsSync(join(runtime, 'Memory/dist/src/server/index.js'))) {
    throw new Error('refusing to prune incomplete runtime');
  }
  const result = [];
  for (const modules of ['node_modules', 'App/memmy-agent/node_modules']) {
    for (const name of names) {
      const dest = join(runtime, modules, name);
      if (existsSync(dest) && lstatSync(dest).isDirectory() && !lstatSync(dest).isSymbolicLink()) result.push(dest);
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const [stage, installed, ...options] = process.argv.slice(2);
  if (!stage || !installed) throw Error('Usage: prune-preview-devtools.mjs STAGED_APP INSTALLED_APP [--apply]');
  const plan = planPrune(stage, installed);
  for (const path of plan) console.log((options.includes('--apply') ? 'REMOVE ' : 'PLAN ')+path);
  if (options.includes('--apply')) {
    for (const path of plan) rmSync(path, { recursive: true, force: true });
  }
  console.log(`Pruned: ${options.includes('--apply') ? 'yes' : 'no'}; candidates: ${plan.length}`);
}
