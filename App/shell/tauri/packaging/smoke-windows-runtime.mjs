/** Windows x64 staged/installed bundled Memory+Agent Runtime smoke.
 * Use genuine Windows Node and native .node addons; no developer checkout fallback.
 */
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export function smokeWindowsRuntime(root) {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw Error('Real Windows x64 host required for native-addon ABI test');
  const base = resolve(root);
  const exe = join(base,'node.exe');
  for (const name of ['node.exe','Memory/dist/src/cli/index.js',
    'App/shell/tauri/sidecar/memory.mjs','App/shell/tauri/sidecar/backend.mjs',
    'App/shell/tauri/sidecar/gateway.mjs','App/memmy-agent/dist/main.js',
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'App/memmy-agent/node_modules/@anthropic-ai/sdk/package.json',
    'node_modules/@memmy/agent-source-core/package.json']) {
    if(!existsSync(join(base,name))||!statSync(join(base,name)).isFile())
      throw Error('Incomplete installed Windows native Runtime: '+name);
  }
  const home=mkdtempSync(join(tmpdir(),'memmy-win11-native-runtime-'));
  const options={cwd:base,encoding:'utf8',timeout:90000,
    env:{SystemRoot:process.env.SystemRoot,windir:process.env.windir,
      PATH:process.env.PATH,HOMEDRIVE:process.env.HOMEDRIVE,HOMEPATH:home,
      TEMP:home,TMP:home,APPDATA:join(home,'Roaming'),
      LOCALAPPDATA:join(home,'Local'),USERPROFILE:home,
      MEMMY_HOME:home,MEMMY_CLOUD_SERVICE:'https://api.memmy.cn',
      NODE_OPTIONS:'--no-experimental-webstorage'}};
  try {
    const version=spawnSync(exe,['--version'],options);
    if(version.status!==0||!version.stdout.trim().startsWith('v26.8.2'))
      throw Error('Windows bundled Node 26.8.2 version failed: '+version.stderr);
    const native=spawnSync(exe,['-e',
      "const sqlite=require('better-sqlite3'); const db=new sqlite(':memory:'); db.prepare('select 1').get(); db.close();"
    ],options);
    if(native.status!==0) throw Error('Windows native SQLite ABI failed: '+native.stderr);
    const help=spawnSync(exe,['Memory/dist/src/cli/index.js','--help'],options);
    if(help.status!==0) throw Error('Windows packaged Memory CLI failed: '+
      (help.stderr??'').slice(-1400));
    return {ok:true,platform:'win32',architecture:'x64',node:'v26.8.2',
      nativeSqlite:true,compiledMemoryCli:true,isolatedHome:true};
  } finally {rmSync(home,{recursive:true,force:true});}
}
const invoked=process.argv[2]??'App/shell/tauri/packaging/runtime';
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=smokeWindowsRuntime(invoked);
  console.log(JSON.stringify(result,null,2));
  if(!result.ok) process.exitCode=1;
}
