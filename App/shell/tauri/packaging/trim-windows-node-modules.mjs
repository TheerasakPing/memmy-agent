// Remove non-runtime source maps and TypeScript declaration metadata that can
// overflow the legacy Win32 MAX_PATH limit in the nested Agent dependencies.
// Never delete .js/.cjs/.mjs or package.json: runtime behavior must be retained.
import { lstat, readdir, unlink } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? 'App/shell/tauri/packaging/runtime');
const expected = process.argv[3] ?? 'C:\\Users\\Administrator\\AppData\\Local\\Memmy';
if (!expected.toLowerCase().includes('\\memmy')) throw Error('Expected a dedicated per-user Memmy install path');
const scopes = [join(root, 'node_modules'), join(root, 'App/memmy-agent/node_modules')];
let deleted = 0, retained = 0, longest = 0;
let offender = '';
const prune = name => /(?:\.d\.(?:ts|cts|mts)|\.map)$/iu.test(name);
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filename = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error('Unsafe node_modules symlink: '+filename);
    if (entry.isDirectory()) { await walk(filename); continue; }
    if (!entry.isFile()) continue;
    if (prune(entry.name)) { await unlink(filename); deleted++; continue; }
    const sub=relative(root,filename);
    if (sub.startsWith('..')||isAbsolute(sub)) throw Error('path escaped runtime: '+filename);
    const winpath = expected + '\\runtime\\' + sub.replaceAll('/', '\\');
    if (winpath.length > longest) { longest = winpath.length; offender = sub; }
    retained++;
  }
}
for (const dir of scopes) {
  if (!(await lstat(dir)).isDirectory()) throw Error('Missing installed Windows native dependency tree: '+dir);
  await walk(dir);
}
// Leave room below Win32 MAX_PATH and account for NSIS/Win32 internal buffers.
if (longest > 248) throw Error('Windows path too long after pruning ('+longest+'): '+offender);
console.log(JSON.stringify({ ok:true, deletedNonRuntimeMetadata:deleted,
  retainedRuntimeFiles:retained, longestWindowsPath:longest,
  maxPermittedWindowsPath:248, longestRelativePath:offender, installDir:expected }));
