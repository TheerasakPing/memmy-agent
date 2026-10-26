/** Snapshot installed Preview process-tree memory and packaged frontend assets. */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const appPath=process.argv[2];const assetsPath=process.argv[3];const out=process.argv[4];
if(!appPath || !assetsPath || !out)throw Error('Usage: node capture-idle.mjs APP ASSETS REPORT.json');
const appRoot=resolve(appPath),assets=resolve(assetsPath);
if(!existsSync(join(appRoot,'Contents/MacOS/memmy-turbo-tauri')) || !existsSync(assets)) throw Error('missing app or assets');
const rows=execFileSync('ps',['-axo','pid=,ppid=,rss=,%cpu=,args='],{encoding:'utf8'}).trim().split('\n');
const processes=rows.map(row=>{const m=row.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);return m?{pid:Number(m[1]),ppid:Number(m[2]),rssKiB:Number(m[3]),cpuPct:Number(m[4]),cmd:m[5]}:null}).filter(Boolean);
const owned=processes.filter(p=>p.cmd.startsWith(appRoot+'/Contents/'));
const bundles=readdirSync(assets).filter(name=>/\.(js|css)$/.test(name)).map(name=>({file:name,bytes:statSync(join(assets,name)).size})).sort((a,b)=>b.bytes-a.bytes);
const report={note:'sum RSS double-counts shared memory; NOT resident unique or allocated heap. Idle point-in-time sample only.',appProcessCount:owned.length,aggregatedRssMiB:Math.round(owned.reduce((sum,p)=>sum+p.rssKiB,0)/1024*10)/10,aggregatedCpuPercent:Math.round(owned.reduce((sum,p)=>sum+p.cpuPct,0)*10)/10,processRoles:owned.map(p=>({role:p.cmd.includes('/MacOS/')?'tauri-ui':p.cmd.includes('/node')?'node-sidecar':'other',rssMiB:Math.round(p.rssKiB/1024*10)/10})),bundles:{count:bundles.length,jsTotalMiB:Math.round(bundles.filter(x=>x.file.endsWith('.js')).reduce((s,x)=>s+x.bytes,0)/1048576*100)/100,top:bundles.slice(0,8)}};
writeFileSync(resolve(out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
