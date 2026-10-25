import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBundle } from './audit-bundle.mjs';
import { smokeMacApp } from './smoke-macos-app.mjs';
import { smokeMacBundledServices } from './smoke-macos-services.mjs';

/** Prove an app works OUTSIDE the source checkout. An app tested only under
 * target/debug/bundle can resolve missing modules from ancestor node_modules.
 * macOS APFS clone copies to an isolated directory on the same volume.
 */
export async function smokeRelocatedMacApp(source) {
  const app = resolve(source);
  const sourceAudit = auditBundle(app, 'darwin');
  if (!sourceAudit.ok) return { ok: false, reason: 'invalid-source-app', errors: sourceAudit.errors };
  const match = app.match(/^\/Volumes\/[^/]+\//u);
  const volumeRoot = match ? match[0].slice(0, -1) : tmpdir();
  const temp = mkdtempSync(join(volumeRoot, 'memmy-relocated-dev-'));
  const copy = join(temp, 'Memmy Turbo Preview.app');
  try {
    const cloned = spawnSync('/bin/cp', ['-cR', app, copy], {
      encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024
    });
    if (cloned.status !== 0) return { ok: false, reason: 'relocation-copy-failed',
      exitCode: cloned.status, error: cloned.error?.code ?? cloned.stderr.slice(-800) };
    const checked = auditBundle(copy, 'darwin');
    if (!checked.ok) return { ok: false, reason: 'relocated-bundle-invalid', errors: checked.errors };
    const cli = smokeMacApp(copy);
    if (!cli.ok) return { ok: false, reason: 'relocated-cli-failed', cli };
    const services = await smokeMacBundledServices(copy);
    return { ok: services.ok, relocated: true, isolatedHome: true,
      originalUiPreserved: true, cliOk: true, authenticatedGateway: services.authenticatedGateway,
      ...(services.ok ? {} : { reason: 'relocated-services-failed', services }) };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

const target = process.argv[2] ?? 'src-tauri/target/debug/bundle/macos/Memmy Turbo Preview.app';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await smokeRelocatedMacApp(target);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
