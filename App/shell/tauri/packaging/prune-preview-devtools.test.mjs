import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planPrune } from './prune-preview-devtools.mjs';
test('fail closed for missing runtime, never prune installed app', () => {
  const root = mkdtempSync(join(tmpdir(), 'memmy-prune-test-'));
  try {
    assert.throws(() => planPrune(root, root), /installed/);
    assert.throws(() => planPrune(root, join(tmpdir(), 'memmy-installed-other.app')), /incomplete/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('only choose explicit dev tooling, preserving runtime dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'memmy-prune-test-'));
  try {
    const rt = join(root,'Contents/Resources/runtime');
    for(const file of ['Memory/dist/src/server/index.js','App/memmy-agent/dist/main.js']) {
      mkdirSync(join(rt,file,'..'),{recursive:true}); writeFileSync(join(rt,file),'');
    }
    for(const dep of ['typescript','vitest','better-sqlite3','openai']) mkdirSync(join(rt,'node_modules',dep),{recursive:true});
    const selected=planPrune(root,join(tmpdir(),'memmy-installed-separate.app'));
    assert.equal(selected.length,1);
    assert.match(selected[0], /vitest$/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
