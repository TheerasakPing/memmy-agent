import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli=fileURLToPath(new URL('./trim-windows-node-modules.mjs',import.meta.url));
function fixture(fn){
  const home=mkdtempSync(join(tmpdir(),'memmy-win-maxpath-test-'));
  try {
    const base=join(home,'runtime');
    const one=join(base,'node_modules','pkg');
    const two=join(base,'App','memmy-agent','node_modules','pkg');
    mkdirSync(one,{recursive:true});mkdirSync(two,{recursive:true});
    return fn({base,one,two});
  } finally {rmSync(home,{recursive:true,force:true});}
}
test('nonruntime maps and declarations removed, valid module JS and TS retained',()=>fixture(({base,one,two})=>{
  for (const folder of [one,two]){
    writeFileSync(join(folder,'index.js'),'module.exports=123');
    writeFileSync(join(folder,'index.js.map'),'{}');
    writeFileSync(join(folder,'index.d.ts'),'export {};');
    writeFileSync(join(folder,'index.d.cts'),'export {};');
    writeFileSync(join(folder,'source.ts'),'// retained if runtime loader requires source');
  }
  const result=spawnSync(process.execPath,[cli,base],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const info=JSON.parse(result.stdout);
  assert.equal(info.deletedNonRuntimeMetadata,6);
  for(const folder of [one,two]){
    assert.ok(existsSync(join(folder,'index.js')));
    assert.ok(existsSync(join(folder,'source.ts')));
    assert.ok(!existsSync(join(folder,'index.js.map')));
    assert.ok(!existsSync(join(folder,'index.d.ts')));
  }
}));
test('reject long executable module JS path rather than deleting it',()=>fixture(({base,two})=>{
  const segment='a'.repeat(220);
  const deep=join(two,segment);mkdirSync(deep,{recursive:true});
  const exe=join(deep,'agent-entrypoint.js');writeFileSync(exe,'export {}');
  const result=spawnSync(process.execPath,[cli,base],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Windows path too long/);
  assert.ok(existsSync(exe));
}));
