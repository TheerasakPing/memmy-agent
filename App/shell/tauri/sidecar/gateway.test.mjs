/** Full real service smoke, isolated temp dir; no cloud/API keys required. */
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// Run all three sidecars from the audited .app runtime when requested.
const bundledRoot=process.env.MEMMY_TAURI_BUNDLED_RUNTIME || null;
const nodeExecutable=bundledRoot ? join(bundledRoot,'node') : process.execPath;
const script=(name)=>bundledRoot ? join(bundledRoot,'App/shell/tauri/sidecar',name+'.mjs')
  : fileURLToPath(new URL('./'+name+'.mjs',import.meta.url));
async function port(){const s=createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p;}
async function stop(child){if(!child||child.exitCode!==null)return; const wait=new Promise(r=>child.once('exit',r));child.stdin.end();await Promise.race([wait,new Promise((_,rej)=>setTimeout(()=>rej(Error('child stop timeout')),7000).unref())]);}
async function waitMemory(child,url){const deadline=Date.now()+30000;while(Date.now()<deadline){if(child.exitCode!==null)throw Error('memory exited');const r=await fetch(url+'/api/v1/health',{signal:AbortSignal.timeout(1100)}).catch(()=>null);if(r?.ok && (await r.json()).storage?.ready)return;await new Promise(r=>setTimeout(r,120));}throw Error('memory health readiness timeout');}
async function ready(child,marker){let err='';child.stderr.on('data',d=>{err=(err+String(d)).slice(-4000)});return Promise.race([new Promise((resolve,reject)=>{createInterface({input:child.stdout}).on('line',l=>{if(l.startsWith(marker))resolve(JSON.parse(l.slice(marker.length)))});child.once('exit',c=>reject(Error(`${marker} exit ${c}: ${err}`)))}),new Promise((_,reject)=>setTimeout(()=>reject(Error(`${marker} timeout: ${err}`)),51000).unref())]);}

test('real Agent Gateway with managed Browser IPC starts after Memory+Local API and serves WebUI bootstrap', {timeout:110000},async()=>{
 const home=await mkdtemp(join(tmpdir(),'memmy-tauri-gateway-'));
 const memPort=await port(),wsPort=await port(),healthPort=await port();
 const memUrl=`http://127.0.0.1:${memPort}`, token=randomBytes(32).toString('hex');
 const config=join(home,'config.yaml');
 await writeFile(config,JSON.stringify({memmyMemory:{agentAccess:{autoScanKnownAgents:false,watchFileChanges:false,autoInjectSkill:false}}}),{mode:0o600});
 let mem,backend,gateway;
 try{
 mem=spawn(nodeExecutable,[script('memory')],{env:{...process.env,MEMMY_TAURI_DATA_DIR:home,MEMMY_TAURI_MEMORY_PORT:String(memPort),MEMMY_TAURI_DEV_BACKEND:'1',MEMMY_MEMORY_TOKEN:token,MEMMY_MEMORY_MODE:'local',MEMMY_MEMORY_BACKEND:'sqlite',MEMMY_MEMORY_DB:join(home,'memory.sqlite'),MEMMY_MEMORY_URL:memUrl,MEMMY_CONFIG:config},stdio:['pipe','ignore','pipe']});
 let memError='';mem.stderr.on('data',d=>memError=(memError+String(d)).slice(-2400));
 await waitMemory(mem,memUrl).catch(e=>{throw Error(`${e.message}: ${memError}`)});
 backend=spawn(nodeExecutable,[script('backend')],{env:{...process.env,MEMMY_TAURI_DATA_DIR:home,MEMMY_TAURI_DEV_BACKEND:'1',MEMMY_MEMORY_LAYER_URL:memUrl,MEMMY_MEMORY_LAYER_TOKEN:token,MEMMY_CLOUD_URL:memUrl},stdio:['pipe','pipe','pipe']});
 const backendCfg=await ready(backend,'MEMMY_TAURI_READY ');
 assert.ok(backendCfg.baseUrl);
 gateway=spawn(nodeExecutable,[script('gateway')],{env:{...process.env,MEMMY_TAURI_DATA_DIR:home,MEMMY_TAURI_DEV_GATEWAY:'1',MEMMY_TAURI_BROWSER_SURFACE_RELAY:'1',MEMMY_TAURI_GATEWAY_WS_PORT:String(wsPort),MEMMY_TAURI_GATEWAY_HEALTH_PORT:String(healthPort),MEMMY_MEMORY_URL:memUrl,MEMMY_MEMORY_TOKEN:token,MEMMY_CLOUD_URL:memUrl},stdio:['pipe','pipe','pipe']});
 const agentCfg=await ready(gateway,'MEMMY_TAURI_GATEWAY_READY ');
 if (bundledRoot) {
   for (const child of [mem,backend,gateway]) {
     assert.equal(child.spawnfile,nodeExecutable);
     assert.ok(child.spawnargs[1].startsWith(bundledRoot+'/App/shell/tauri/sidecar/'));
   }
 }
 assert.equal(agentCfg.baseUrl,`http://127.0.0.1:${wsPort}`);
 const saved=YAML.parse(await readFile(config,'utf8'));
 assert.equal(saved.channels.websocket.host,'127.0.0.1');
 assert.equal(saved.channels.websocket.websocketRequiresToken,true);
 assert.deepEqual(saved.channels.websocket.allowFrom,['*']);
 const denied=await fetch(agentCfg.baseUrl+'/webui/bootstrap');assert.equal(denied.status,401);
 const ok=await fetch(agentCfg.baseUrl+'/webui/bootstrap',{headers:{'x-memmy-agent-auth':agentCfg.bootstrapSecret}});assert.equal(ok.status,200);
 await stop(gateway);gateway=null;await stop(backend);backend=null;await stop(mem);mem=null;
 }finally{
   await Promise.allSettled([stop(gateway),stop(backend),stop(mem)]);
   gateway?.kill();backend?.kill();mem?.kill();
   await rm(home,{recursive:true,force:true});
 }
});
