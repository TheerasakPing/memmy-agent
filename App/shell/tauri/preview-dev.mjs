/** One-command Tauri Agent preview on a developer workstation.
 * Requires Node, Rust/Tauri, compatible SQLite native modules and an explicitly
 * configured cloud origin. Never downloads tools or changes legacy user data. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=resolve(fileURLToPath(new URL('../../..', import.meta.url)));
if (!process.env.MEMMY_CLOUD_SERVICE && !process.env.MEMMY_CLOUD_URL) {
 console.error('Configure MEMMY_CLOUD_SERVICE or MEMMY_CLOUD_URL for your edition before launching the preview.');
 process.exit(2);
}
function run(command,args,env=process.env){return new Promise((ok,reject)=>{
 const child=spawn(command,args,{cwd:root,env,stdio:'inherit'});
 child.once('error',reject);
 child.once('exit',code=>code===0?ok():reject(Error(`${command} failed (${code})`)));
});}
const npm=process.platform==='win32'?'npm.cmd':'npm';
try {
 if(!existsSync(resolve(root,'node_modules'))){throw Error('Install project dependencies first using npm ci');}
 await run(npm,['run','memory:build']);
 await run(npm,['run','build','-w','@memmy/backend']);
 await run(npm,['--prefix','App/memmy-agent','run','build']);
 const env={...process.env,MEMMY_TAURI_DEV_BACKEND:'1',MEMMY_TAURI_DEV_MEMORY:'1',MEMMY_TAURI_DEV_GATEWAY:'1'};
 await run(npm,['run','tauri:dev','-w','@memmy/tauri-shell'],env);
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
