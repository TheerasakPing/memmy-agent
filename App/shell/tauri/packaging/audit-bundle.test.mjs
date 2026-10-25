import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBundle, auditBundleSymlinks } from './audit-bundle.mjs';

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
      ...['manifest.json','background.js','history-content.js','history-sensor.js']
        .map(x => join('Contents/Resources/browser-extension', x)),
      ...['node', 'App/shell/tauri/sidecar/memory.mjs', 'App/shell/tauri/sidecar/backend.mjs', 'App/shell/tauri/sidecar/gateway.mjs',
         'Memory/dist/src/server/index.js','Memory/dist/src/cli/index.js','App/backend/dist/src/index.js',
         'App/memmy-agent/dist/main.js','node_modules/better-sqlite3/build/Release/better_sqlite3.node',
         ...['agent-source-core','knowledge','migrations','local-api-contracts',
             'desktop-interface','memory','backend'].map(name => 'node_modules/@memmy/'+name+'/package.json'),
         'App/memmy-agent/node_modules/@anthropic-ai/sdk/package.json',
         'App/memmy-agent/node_modules/openai/package.json',
         'App/memmy-agent/node_modules/@aws-sdk/client-bedrock-runtime/package.json']
         .map((x) => join('Contents/Resources/runtime', x))
    ];
    for (const name of names) {
      const path = join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'fixture', { mode: 0o755 });
    }
    writeFileSync(join(dir, 'Contents/Resources/browser-extension/manifest.json'),
      JSON.stringify({manifest_version: 3, background: {service_worker: 'background.js'}}));
    assert.deepEqual(auditBundle(dir, 'darwin').errors, []);
    const injected = join(dir,'Contents/Resources/runtime/node_modules/outside-checkout');
    mkdirSync(dirname(injected), {recursive:true});
    symlinkSync(tmpdir(),injected);
    assert.ok(auditBundle(dir,'darwin').errors.some(error => error.includes('bundle symlink escapes app')));
    rmSync(injected);
    assert.deepEqual(auditBundle(dir, 'darwin').errors, []);
    const workspace=join(dir,'Contents/Resources/runtime/node_modules/@memmy/agent-source-core/package.json');
    rmSync(workspace);
    assert.ok(auditBundle(dir,'darwin').errors.some(e=>e.includes('Compiled Agent Source workspace')));
    writeFileSync(workspace,'fixture');
    const sdk=join(dir,'Contents/Resources/runtime/App/memmy-agent/node_modules/@anthropic-ai/sdk/package.json');
    rmSync(sdk);
    assert.ok(auditBundle(dir,'darwin').errors.some(e => e.includes('Agent-private Anthropic SDK')));
    writeFileSync(sdk,'fixture');
    rmSync(join(dir, 'Contents/Resources/runtime/Memory/dist/src/cli/index.js'));
    assert.ok(auditBundle(dir, 'darwin').errors.some(e => e.includes('bundled Memory CLI entrypoint')));
    writeFileSync(join(dir, 'Contents/Resources/runtime/Memory/dist/src/cli/index.js'), 'fixture');
    rmSync(join(dir, 'Contents/Resources/browser-extension/background.js'));
    assert.ok(auditBundle(dir, 'darwin').errors.some(e => e.includes('bundled Browser Extension')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('release refuses a runtime symlink that points to a developer checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memmy-tauri-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'memmy-checkout-'));
  try {
    const runtime = join(dir, 'Contents/Resources/runtime');
    mkdirSync(join(runtime,'node_modules/@memmy'),{recursive:true});
    writeFileSync(join(outside,'private.env'),'NEVER SHIP');
    symlinkSync(outside,join(runtime,'node_modules/@memmy/backend'));
    const problems = auditBundleSymlinks(dir, ['Contents/Resources/runtime']);
    assert.ok(problems.some(line => line.includes('bundle symlink escapes app')));
  } finally {
    rmSync(dir,{recursive:true,force:true});
    rmSync(outside,{recursive:true,force:true});
  }
});
test('release refuses broken links but permits links to staged resources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memmy-tauri-link-'));
  try {
    const runtime = join(dir,'Contents/Resources/runtime');
    mkdirSync(join(runtime,'node_modules/@memmy'),{recursive:true});
    mkdirSync(join(runtime,'App/backend'),{recursive:true});
    symlinkSync('../../App/backend',join(runtime,'node_modules/@memmy/backend'));
    assert.deepEqual(auditBundleSymlinks(dir,['Contents/Resources/runtime']),[]);
    symlinkSync('../../../nonexistent',join(runtime,'node_modules/@memmy/deleted'));
    assert.ok(auditBundleSymlinks(dir,['Contents/Resources/runtime']).some(line =>
      line.includes('bundle symlink is broken')));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('packaging runtime must exist to pass symlink integrity gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memmy-tauri-link-'));
  try {
    assert.ok(auditBundleSymlinks(dir,['Contents/Resources/runtime']).some(line =>
      line.includes('bundle dependency directory missing')));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('native packaging declares mic consent purpose and includes exact MV3 source directory', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const config = JSON.parse(readFileSync(join(root, 'App/shell/tauri/src-tauri/tauri.conf.json'), 'utf8'));
  assert.equal(config.bundle.macOS.infoPlist, 'Info.plist');
  assert.equal(config.bundle.resources['../../desktop/extensions/memmy-browser'], 'browser-extension');
  const plist = readFileSync(join(root, 'App/shell/tauri/src-tauri/Info.plist'), 'utf8');
  assert.match(plist, /<key>NSMicrophoneUsageDescription<\/key>/u);
  assert.match(plist, /record or transcribe voice/u);
});
