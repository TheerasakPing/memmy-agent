/** Reproducible, profile-isolated bundled native supervisor startup benchmark. */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { smokeMacNativeSupervisor } from '../smoke-macos-native-supervisor.mjs';
const app = process.argv[2];
const rounds = Number(process.argv[3] ?? '5');
const report = process.argv[4];
if (!app || !Number.isInteger(rounds) || rounds < 1 || rounds > 30) {
  console.error('Usage: node benchmark-startup.mjs APP_PATH [1..30] [JSON_REPORT]');
  process.exit(2);
}
const measurements=[];
for(let i=0;i<rounds;i++) {
  const begin=performance.now();
  const result=await smokeMacNativeSupervisor(resolve(app));
  const durationMs=Math.round(performance.now()-begin);
  measurements.push({iteration:i+1, durationMs, passed:result.ok, reason:result.reason??null});
  console.log(`${i+1}/${rounds} ${durationMs}ms ${result.ok?'PASS':'FAIL'}`);
  if(!result.ok) break;
}
const values=measurements.filter(x=>x.passed).map(x=>x.durationMs).sort((a,b)=>a-b);
const percentile=p=>values.length?values[Math.ceil(values.length*p)-1]:null;
const summary={roundsRequested:rounds,roundsCompleted:measurements.length,passed:measurements.every(x=>x.passed),medianMs:percentile(0.5),p95Ms:percentile(0.95),minMs:values[0]??null,maxMs:values.at(-1)??null,measurements,scope:'isolated native supervisor with temporary HOME; excludes Finder/React TTI'};
console.log(JSON.stringify(summary,null,2));
if(report)writeFileSync(resolve(report),JSON.stringify(summary,null,2)+'\n');
if(!summary.passed)process.exitCode=1;
