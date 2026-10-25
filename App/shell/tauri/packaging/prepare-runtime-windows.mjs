/** Stage REAL Windows x64 native Tauri runtime, isolated from checkout.
 * Run only on Windows x64 after npm ci, native-addon rebuild and compiled JS.
 */
import { cp, copyFile, lstat, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBundleSymlinks } from './audit-bundle.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const stage=join(root,'App/shell/tauri/packaging/runtime');
const expectedVersion='v26.8.2';
if(process.platform!=='win32'||process.arch!=='x64')
  throw Error('Windows x64 runner required; never stage Apple/Linux native addons');
if(process.version!==expectedVersion) throw Error(`Expected pinned Node ${expectedVersion} got ${process.version}`);
if(process.execPath.toLowerCase().startsWith(stage.toLowerCase())) throw Error('Node binary must be independent from stage');

async function copy(relative,destination=relative){
  const src=join(root,relative),dst=join(stage,destination);
  await mkdir(dirname(dst),{recursive:true});
  const sourceInfo=await lstat(src);
  if(sourceInfo.isSymbolicLink()) throw Error('Source path symlink forbidden: '+relative);
  await cp(src,dst,{recursive:true,force:false,errorOnExist:true,
    // Workspace links and .bin aliases must NOT be followed outside bundle.
    filter:async(source)=>{
      const info=await lstat(source);
      if(info.isSymbolicLink())return false;
      const leaf=source.replaceAll('\\','/');
      if(leaf.includes('/node_modules/.bin/'))return false;
      return !/(^|\/)\.env(?:\.|$)/u.test(leaf)&&!leaf.endsWith('/.npmrc');
    }
  });
}
await rm(stage,{recursive:true,force:true});
await mkdir(stage,{recursive:true});
await copyFile(process.execPath,join(stage,'node.exe'));
const nodeInfo=await stat(join(stage,'node.exe'));
if(!nodeInfo.isFile()||nodeInfo.size<5_000_000)throw Error('Bundled official Windows Node executable incomplete');
const rootList=[
  'node_modules','App/memmy-agent/node_modules',
  'App/memmy-agent/dist','Memory/dist','App/backend/dist',
  'Migrations/dist','Knowledge/dist','AgentSourceCore/dist',
  'App/backend/local-api-contracts/dist','App/shell/desktop/interface/dist',
  'App/shell/tauri/sidecar',
  'App/memmy-agent/package.json','Memory/package.json','App/backend/package.json',
  'Migrations/package.json','Knowledge/package.json','AgentSourceCore/package.json',
  'App/backend/local-api-contracts/package.json',
  'App/shell/desktop/interface/package.json','package.json',
];
for(const dir of rootList){console.log('Bundling Windows x64',dir);await copy(dir);}
// Restore compiled first-party workspace modules as REAL files. Windows Tauri
// installer must not depend on npm junctions/symlinks or root source folders.
for(const [name,src] of Object.entries({
  'agent-source-core':'AgentSourceCore',knowledge:'Knowledge',migrations:'Migrations',
  'local-api-contracts':'App/backend/local-api-contracts',
  'desktop-interface':'App/shell/desktop/interface',memory:'Memory',backend:'App/backend'
})){
  const dst=join(stage,'node_modules/@memmy',name);
  await rm(dst,{recursive:true,force:true});
  await mkdir(dst,{recursive:true});
  await copyFile(join(stage,src,'package.json'),join(dst,'package.json'));
  await cp(join(stage,src,'dist'),join(dst,'dist'),{recursive:true});
}
// At least these native binaries must have been BUILT on Windows x64.
for(const rel of ['node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'App/memmy-agent/node_modules/@anthropic-ai/sdk/package.json',
  'App/memmy-agent/node_modules/openai/package.json',
  'node_modules/@memmy/agent-source-core/package.json']){
  const info=await stat(join(stage,rel));
  if(!info.isFile())throw Error('Windows bundled runtime missing: '+rel);
}
const issues=auditBundleSymlinks(stage,['node_modules','App/memmy-agent/node_modules']);
if(issues.length)throw Error('Windows bundled runtime has unsafe symlinks: '+issues.slice(0,15).join('; '));
const checksum=createHash('sha256').update(await readFile(join(stage,'node.exe'))).digest('hex');
console.log(JSON.stringify({ok:true,platform:'win32',arch:'x64',node:process.version,
  bundledNodeSha256:checksum,source:'Windows-runner-native',runtime:stage}));
