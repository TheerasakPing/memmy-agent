#!/usr/bin/env node
/**
 * R7: repeated launch/exit smoke of the actual packaged Rust supervisor.
 * Never uses ~/.memmy or a production data directory: --smoke-native-runtime
 * allocates a unique temporary profile each run.
 */
import { spawn, execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

const executable = resolve(process.argv[2] ?? '');
const cycles = Number(process.argv[3] ?? 3);
if (!process.argv[2] || !Number.isInteger(cycles) || cycles < 1 || cycles > 20) {
  console.error('Usage: node smoke-native-runtime-restarts.mjs /path/to/installed/app/binary [1..20]');
  process.exit(2);
}
const listSmokeProfiles = async () => new Set((await readdir(tmpdir())).filter(name => name.startsWith('memmy-standalone-smoke-')));
// Check for survivors by absolute packaged command path; do not accidentally
// count/kill an Original Electron or another user's Node process.
const nativeRuntimeNode = join(dirname(executable), '../Resources/runtime/node');
function bundledProcessIds() {
  if (process.platform !== 'darwin') return new Set();
  const output = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return new Set(output.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) return [];
    const cmd = match[2];
    if (cmd === executable || cmd.startsWith(executable + ' ') ||
        cmd.startsWith(nativeRuntimeNode + ' ')) return [Number(match[1])];
    return [];
  }));
}
const beforeProcesses = bundledProcessIds();
const before = await listSmokeProfiles();
const samples = [];
for (let i = 0; i < cycles; i++) {
  const started = performance.now();
  const result = await new Promise(resolve => {
    const child = spawn(executable, ['--smoke-native-runtime'], {
      stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MEMMY_PROFILE_STARTUP: '1' }
    });
    let tail = '';
    let didTimeout = false;
    const watchdog = setTimeout(() => { didTimeout = true; child.kill('SIGTERM'); }, 90000);
    child.stderr.on('data', chunk => { tail = (tail + String(chunk)).slice(-2400); });
    child.on('error', error => {
      clearTimeout(watchdog);
      resolve({ code: null, signal: null, tail, error: error.message, didTimeout });
    });
    child.on('close', (code, signal) => {
      clearTimeout(watchdog);
      resolve({ code, signal, tail, didTimeout });
    });
  });
  const elapsedMs = Math.round(performance.now() - started);
  const leakedProfiles = [...(await listSmokeProfiles())].filter(name => !before.has(name));
  // A bounded grace period handles asynchronous OS process reaping.
  let leakedProcessIds = [];
  for (let check = 0; check < 8; check++) {
    leakedProcessIds = [...bundledProcessIds()].filter(pid => !beforeProcesses.has(pid));
    if (leakedProcessIds.length === 0) break;
    await new Promise(r => setTimeout(r, 250));
  }
  samples.push({ cycle: i + 1, elapsedMs,
    ok: result.code === 0 && result.tail.includes('PASS: packaged Memory + Local API + Agent Gateway start/stop') && leakedProfiles.length === 0 && leakedProcessIds.length === 0,
    leakedProfiles: leakedProfiles.length, leakedProcessCount: leakedProcessIds.length });
  if (!samples.at(-1).ok) {
    console.error(JSON.stringify({ result: 'FAIL', samples, lastError: result.tail.slice(-800), code: result.code, signal: result.signal, didTimeout: result.didTimeout, error: result.error ?? null }));
    process.exit(1);
  }
  console.log(`PASS restart smoke ${i + 1}/${cycles} (${elapsedMs} ms)`);
}
const times = samples.map(row => row.elapsedMs).sort((a, b) => a - b);
const summary = { result: 'PASS', cycles, medianMs: times[Math.floor(times.length / 2)], maxMs: times.at(-1), minMs: times[0], noTemporaryProfilesLeaked: true, noNewBundledProcessesSurvived: true, samples };
console.log(JSON.stringify(summary));
