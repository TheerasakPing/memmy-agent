/** Build a relocated offline-only bundled Tauri runtime on macOS arm64.
 * Native addons are ABI-bound to Node 26.8.2; do not redistribute Homebrew binaries.
 * The stage is never committed. This is a preview build, not a signed installer.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const stage = join(root, 'App/shell/tauri/packaging/runtime');
const nodeVersion = '26.8.2';
const officialSha256 = 'f58e5044b938a3174184de4aaf1d2bbfcfff812e88220ff08e9221c09f5c8677';
function run(command, args) {
  const done = spawnSync(command, args, { stdio: 'inherit' });
  if (done.status !== 0) throw Error(`${command} failed: ${done.status ?? done.error}`);
}
async function copy(relative, destination = relative) {
  const src = join(root, relative), dst = join(stage, destination);
  await mkdir(dirname(dst), { recursive: true });
  run('rsync', ['-a', '--exclude=.env', '--exclude=.env.*', '--exclude=.npmrc', src.endsWith('node_modules') || src.endsWith('/dist') || src.endsWith('/sidecar') ? `${src}/` : src, dst]);
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('This preview packager supports macOS arm64 only');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
const cache = join(tmpdir(), `memmy-node-v${nodeVersion}-darwin-arm64.tar.xz`);
run('curl', ['-fL', '--retry', '2', '--output', cache, `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-darwin-arm64.tar.xz`]);
const digest = createHash('sha256').update(await readFile(cache)).digest('hex');
if (digest !== officialSha256) throw Error('Official Node binary archive SHA-256 mismatch; aborting');
const temp = await mkdtemp(join(tmpdir(), 'memmy-packager-node-'));
try {
  run('tar', ['-xJf', cache, '-C', temp]);
  await copyFile(join(temp, `node-v${nodeVersion}-darwin-arm64`, 'bin/node'), join(stage, 'node'));
  await chmod(join(stage, 'node'), 0o755);
} finally { await rm(temp, { recursive: true, force: true }); }
run(join(stage, 'node'), ['--version']);
for (const relative of [
  'node_modules',
  'App/memmy-agent/node_modules',
  'App/memmy-agent/dist',
  'Memory/dist',
  'App/backend/dist',
  'Migrations/dist',
  'Knowledge/dist',
  'AgentSourceCore/dist',
  'App/backend/local-api-contracts/dist',
  'App/shell/desktop/interface/dist',
  'App/shell/tauri/sidecar',
  'App/frontend/desktop/package.json',
  'App/memmy-agent/package.json',
  'Memory/package.json',
  'App/backend/package.json',
  'Migrations/package.json',
  'Knowledge/package.json',
  'AgentSourceCore/package.json',
  'App/backend/local-api-contracts/package.json',
  'App/shell/desktop/interface/package.json',
  'package.json',
]) {
  console.log(`Bundling ${relative}`);
  await copy(relative);
}
console.log('Completed Tauri local runtime stage: ' + stage);
