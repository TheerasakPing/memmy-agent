import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditBundle } from './audit-bundle.mjs';

test('gate rejects GUI-only .app even if the GUI executable exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memmy-tauri-gate-'));
  try {
    const gui = join(dir, 'Contents/MacOS/memmy-turbo-tauri');
    mkdirSync(dirname(gui), { recursive: true });
    writeFileSync(gui, 'bin');
    writeFileSync(join(dir, 'Contents/Info.plist'), 'plist');
    const result = auditBundle(dir, 'darwin');
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((err) => err.includes('bundled Node runtime')));
    assert.ok(result.errors.some((err) => err.includes('compiled Agent Gateway')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gate accepts a structurally complete isolated runtime fixture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memmy-tauri-gate-'));
  try {
    const names = [
      'Contents/MacOS/memmy-turbo-tauri', 'Contents/Info.plist',
      ...['node', 'App/shell/tauri/sidecar/memory.mjs', 'App/shell/tauri/sidecar/backend.mjs', 'App/shell/tauri/sidecar/gateway.mjs',
         'Memory/dist/src/server/index.js','App/backend/dist/src/index.js',
         'App/memmy-agent/dist/main.js','node_modules/better-sqlite3/build/Release/better_sqlite3.node']
         .map((x) => join('Contents/Resources/runtime', x))
    ];
    for (const name of names) {
      const path = join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'fixture', { mode: 0o755 });
    }
    assert.deepEqual(auditBundle(dir, 'darwin').errors, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
