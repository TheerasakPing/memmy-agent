# T2 — Selective native Browser Data Clearing: history-only safe subset (80/85 wired)

## Checklist planner, delegated review and acceptance

- [x] **A1 Electron source audit:** original `clearBrowserData(categories?)` validates exactly five categories (`cookies`, `siteData`, `cache`, `downloadHistory`, `browsingHistory`), defaults to all five, and clears only selected types in isolated `persist:memmy-browser` Electron session. Tauri 2.12.5 exposes `Webview::clear_all_browsing_data`, which erases cookies, IndexedDB, cache and storage simultaneously and can affect the shared application WKWebsiteDataStore if child WebView isolation is not explicit.
- [x] **A6 Rust secure partial implementation:** first-party main WebView only, `desktop_clear_browser_data` accepts only the explicit one-item `['browsingHistory']` selection. Clears actual native `browser-use/history.json` via the same serialization lock as page-load History writes, validates existing data and rejects symlinks and corrupt entries, atomically saves `[]`. It never touches download settings, browser access policies or any WebKit cookie/cache store.
- [x] **A4 negative tests:** refuse missing category/default-all request, invalid/unknown/duplicate categories, cookies, cache, siteData, downloadHistory, and mixed subsets *before modifying any data*. Confirm real History data is removed, other Browser settings remain unchanged, and symlinked History file is refused.
- [x] **A3 React:** `clearBrowserData(categories)` now invokes the actual native Rust command from original BrowserPanel UI without any React route, styles, buttons or Electron code changes. Unsupported categories reject explicitly, so the original UI reports a failure instead of silently clearing the wrong data.
- [x] **A5 Rust local:** `cargo test --locked --lib` **67/67 PASS** (two new native selective-clear negative/functional tests); `cargo check --locked`, Rust fmt check PASS.
- [x] **A5 React local:** Tauri Bridge + BrowserPanel interactions **24/24 PASS**, full TypeScript project check PASS, Chromium renderer smoke **3/3 PASS**, packaging audit **6/6 PASS**.
- [x] **A5 Parity scanner integrity:** Original 85 methods, 14 routes unchanged; 80/85 callable bridge methods with ONE specifically marked `PARTIAL_NATIVE_FUNCTIONALITY` (Browser clearing). Thus **5 still unported and 6 methods do not yet have full behavioral parity**. No false claim that five-category clearing works.
- [ ] **A6 remaining four data categories:** Need explicit browser-only WebKit/WebView2 data-store isolation (not shared with main authentication), precise cookie/cache/siteData deletion without overclearing, and a genuine native download history catalog before accepting other categories.
- [ ] **A5 Native GUI E2E:** Check selecting browsing history in installed macOS WebKit UI, verify no login-cookie loss, real browsing/clear/readback, Windows 11 x64 and Linux native category E2E.
- [ ] **A4 independent security review:** verify data store partitioning, filesystem symlink race, concurrent WebKit navigation, clear after pending page load, and Browser Download history isolation.
- [ ] **LEAD Production gate:** blocker. Five other original Electron methods are still not migrated: `downloadUpdate`, `onUpdateDownloadProgress`, `openUpdateInstaller`, `dragBrowserExtension`, `copyEmbeddedBrowserTabMention`. Full browser category semantics and native Agent/Browser same-session context, signed cross-platform installers and human approval still required. `releaseReady=false`.

## Why partial parity is intentional

Tauri's `clear_all_browsing_data()` does not support Electron's selective category behavior and may clear main-app login cookies when child WebKit views share the default data store. Calling it for `cookies` or `siteData` would overclear user data. Instead the command rejects unsupported categories with a specific error before modifying any stored browser data. The default no-argument request (meaning *all five* in Electron) also rejects. This is **safe subset implementation**, not complete production Browser Data Clearing.

## Reproduce

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib`: 67/67 PASS
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`: PASS
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/browser-panel.interaction.test.tsx`: 24/24 PASS
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r50.tsbuildinfo`: PASS
- `NODE_OPTIONS=--no-experimental-webstorage npm run test:renderer:smoke -w @memmy/tauri-shell`: 3/3 PASS
- `NODE_OPTIONS=--no-experimental-webstorage npm run bundle:audit:test -w @memmy/tauri-shell`: 6/6 PASS
- `node scripts/engineering/tauri-parity.mjs --check`: 80/85 callable, one partial, original React 14 routes

## Rollback

Stacked Draft PR atop #62. Original Electron preload and all existing React UI unchanged. Keep production main unchanged until independent Review/Native GUI E2E and full Browser/Agent context parity.
