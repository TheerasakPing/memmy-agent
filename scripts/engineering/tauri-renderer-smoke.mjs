#!/usr/bin/env node
// Real Chromium smoke for original React preview screens + installed Tauri
// JS IPC surface. Does not claim to replace native WebKit GUI E2E.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const agentRequire = createRequire(join(root, 'App/memmy-agent/package.json'));
const { chromium } = agentRequire('playwright');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (process.platform !== 'darwin' || !existsSync(chrome)) {
  console.error('This GUI smoke is macOS Chrome-specific, not a cross-platform E2E certification');
  process.exit(2);
}
const port = 19173;
const url = `http://127.0.0.1:${port}`;
const artifacts = join(tmpdir(), 'memmy-tauri-renderer-smoke');
mkdirSync(artifacts, { recursive: true });
const vite = spawn('node', [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: join(root, 'App/frontend/desktop'),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, MEMMY_LEGAL_CN_BASE_URL: 'https://memmy.cn', MEMMY_LEGAL_INTL_BASE_URL: 'https://memmy.bot' }
});
let stderr = '';
vite.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-3000); });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (vite.exitCode !== null) throw Error(`Vite exited: ${stderr}`);
    if ((await fetch(url, { signal: AbortSignal.timeout(1500) }).catch(() => null))?.ok) { ready = true; break; }
    await delay(200);
  }
  if (!ready) throw Error(`Vite did not start: ${stderr}`);
  browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--no-first-run'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 780 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__tauriCalls = [];
    window.__TAURI__ = {
      core: { invoke: async (command, args) => {
        window.__tauriCalls.push({ command, args });
        if (command === 'desktop_app_info') return { name:'Memmy',version:'1.2.5-alpha.3',platform:'darwin',arch:'arm64',isPackaged:true,isWindowsStore:false };
        if (command === 'desktop_runtime_config') return {baseUrl:'http://127.0.0.1:19999',localToken:'mock-for-ui-smoke-not-backend'};
        if (command === 'desktop_set_menu_bar_icon') return { enabled: true };
        return undefined;
      }},
      event: {listen: async () => () => {}}
    };
  });
  const screens = ['startup', 'nickname', 'memory-plugin-conflict'];
  for (const screen of screens) {
    await page.goto(`${url}/?preview=${screen}`, { waitUntil:'domcontentloaded', timeout:45000 });
    await page.locator('#root > *').first().waitFor({ state:'visible', timeout:30000 });
    await page.screenshot({path:join(artifacts, `tauri-react-${screen}.png`), fullPage:false});
    const view = await page.locator('body').innerText();
    if (view.trim().length < 12) throw Error(`${screen}: React page was blank`);
    console.log(`PASS original React ${screen} (${view.trim().length} text chars)`);
  }
  const calls = await page.evaluate(async () => {
    if (!window.memmy || typeof window.memmy.setPetWindow !== 'function') throw Error('Tauri bridge did not install');
    await window.memmy.getAppInfo();
    await window.memmy.setPetWindow(true);
    await window.memmy.setMenuBarIcon(true);
    return window.__tauriCalls;
  });
  for (const command of ['desktop_app_info','desktop_set_pet_window','desktop_set_menu_bar_icon']) {
    if (!calls.some((value) => value.command === command)) throw Error(`missing frontend/native IPC mapping: ${command}`);
  }
  if (errors.length) throw Error(`React page errors: ${errors.join(' | ')}`);
  console.log(`PASS Tauri JS IPC mapping + 3 React preview screens; screenshots at ${artifacts}`);
} finally {
  await browser?.close();
  vite.kill('SIGTERM');
}
