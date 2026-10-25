# T2 — Native Browser new-tab popup event integration (74/85)

## Checklist planner — source audit, delegated implementation, QA, LEAD gate

- [x] A1 Source Audit: Electron preload `onEmbeddedBrowserOpen` listens for `memmy:browser:open-url`, and the existing React router calls `requestBrowserNewTab(url,owner)` to open a separate browser tab. Previous native Tauri `WebviewBuilder::on_new_window` unconditionally denied all `window.open` requests.
- [x] A2 Native Rust browser: fixed main-owned child WebView `.on_new_window` callback now validates the requested URL as HTTP(S), no embedded credentials or unsafe scheme, bounded 8192 characters, and emits a dedicated first-party `memmy:browser:open-url` event. Browser still receives `NewWindowResponse::Deny`; it never acquires a native window handle, IPC, local file access or permission grant. Only original React main creates a tab.
- [x] A3 React compatibility: existing optional `onEmbeddedBrowserOpen(callback)` now subscribes to that named event through Tauri, validates URL again, calls the original callback with its normalized URL, and removes listeners on unmount. Original Browser/Agent UI and all 14 routes unchanged.
- [x] A4 Negative security tests: invalid schemes, `about:blank`, local files, credential-bearing URLs rejected; exactly 8 browser-authored popups allowed per guest WebView, with malformed URLs not consuming the quota. Event callback ignores invalid payloads and unsubscribes correctly.
- [x] A5 Automated Rust: 56/56 library unit tests PASS after popup rate-limit regression. `cargo check --locked` and formatter checks planned in final QA.
- [x] A5 React: 28/28 targeted Tauri bridge + BrowserPanel + native adapter tests PASS, including valid event, invalid/injected URLs, and cleanup.
- [x] A5 Native bridge scanner: 74/85 supported Electron preload methods, 11 left; 14 React routes preserved.
- [ ] A5 Installed macOS native WebKit E2E: click `target=_blank` or `window.open` in genuine guest browser and validate real React tab creation/focus; Windows 11 x64 and Linux installed GUI not certified.
- [ ] A4 Independent human security review: popup flood/abuse rate limit policy, redirects to private network endpoints, navigation ownership and SPA session visibility.
- [ ] LEAD full production signoff: BLOCKED until 11 remaining Electron APIs, native Computer Use same-tab parity, cross-platform tests and code-signing. `releaseReady=false`.

## Behavioral boundary

This is REAL browser guest `window.open` → Rust validation → React new-tab dispatch. It is NOT a claim that the Agent's Playwright browser session and the separate Tauri WebKit tab have become the same context, nor that Electron source guest numeric IDs are available in Tauri. Callbacks receive only `url` from native popup (no forged `sourceGuestId`). Child WebViews keep their existing explicit app-side registry and original HTTP(S) navigation constraints.

## Reproduce

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib` — 56/56 PASS
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/browser-panel.interaction.test.tsx src/tests/native-browser-adapter.test.ts` — 28/28 PASS
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r50.tsbuildinfo` — PASS
- `node scripts/engineering/tauri-parity.mjs --check` — 74/85, 14 routes

## Rollback

Stacked Draft PR atop #56; Electron preload and existing React styles unchanged. Keep production main unchanged pending native installed GUI E2E and independent security approval.
