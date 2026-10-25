# T2 — Real Native Browser History & user-navigation provenance (77/85)

## Checklist Planner / team lanes

- [x] **A1 Source Audit** — original Electron `markEmbeddedBrowserUserNavigation(tabId)` requires a live host-owned guest and explicitly marks address-bar/toolbar navigation as a user visit. Original browser history is persisted with `visitSource` as `agent` or `other`. Before this tranche, Tauri native WebKit emitted load/title events but did not persist new native browsing visits; the Tauri history store only contained imported legacy entries.
- [x] **A6 Rust implementation** — the Rust NativeBrowsers UUID registry now associates each genuinely created child WebView with bounded title and a temporary user-navigation signal. Only the trusted main WebView can call `desktop_native_browser_mark_user_navigation(id)`; UUID must still be registered. On page-load completion Rust records its actual verified HTTP(S) URL/title into the bounded native history store with provenance `other`. Malformed, credential-bearing, non-HTTP and oversized URLs are rejected. The user mark is consumed by the subsequent finished load; no Agent-owned visits are invented.
- [x] **A3 Frontend** — original React `markEmbeddedBrowserUserNavigation(tabId)` resolves a real live renderer-scoped native UI handle to the private Rust UUID associated with that specific WebView. It rejects forged, expired, zero, negative or other non-live handles; native adapter and existing React BrowserPanel navigation behavior remain unchanged.
- [x] **A4 Security review/test** — new Rust History unit test checks genuine native visits, deduplicated URLs, latest title and recorded timestamp, invalid schemes/credentials, prohibition of forged `agent` source and deletion. Existing Rust history file validation/size caps, atomic writes, symlink refusal and browser-tab registry checks retained. All History mutations are serialized under one local Rust Mutex so native page loads cannot race the user history edit/delete APIs.
- [x] **A5 Rust automated** — `cargo test --locked --lib`: **57/57 PASS** after this change; `cargo check --locked` PASS, `cargo fmt --check` PASS.
- [x] **A5 React targeted** — **33/33 PASS** covering Tauri bridge, browser panel and native tab adapter (including live/expired/invalid navigation marks). `tsc --noEmit --incremental` PASS.
- [x] **A5 Smoke/packaging** — original React Chromium renderer smoke **3/3 PASS**, packaging bundle audit fixtures **3/3 PASS**, parity script **77/85** with **14 unchanged React routes**.
- [ ] **A5 installed native WebKit GUI E2E** — validate browser navigation, durable history, title timing and deleting history while page loads arrive; Windows 11 x64 WebView2 and Linux WebKitGTK installed GUI E2E pending.
- [ ] **A4 independent human security review** — browser history privacy/retention policy, timestamp precision, route authorization, history file TOCTOU, race between page load and title update.
- [ ] **LEAD final production acceptance** — BLOCKED; remaining 8 preload methods include updater download/progress/installer, selective browser data clear, extension drag, Agent external tool handoff, CLI install, and browser tab mention. Native WebKit and Agent Playwright are STILL separate browser contexts; native GUI E2E and signed cross-platform installers unverified. `releaseReady=false`.

## Native provenance limitation

A Tauri WebKit native tab is not magically the Agent Playwright session. Its page loads are therefore always recorded as real `other` visits; even when the user mark is absent, no `agent` provenance is fabricated. The tab handle is renderer-only and resolves to the UUID registered by Rust. This release does NOT yet implement direct Agent click/scroll on that same native tab; only the separate Agent-owned browser preview can receive the previously guarded Computer Use actions.

## Test commands

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib` — 57 PASS
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml` — PASS
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/tests/native-browser-adapter.test.ts src/pages/tests/browser-panel.interaction.test.tsx` — 33 PASS
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r50.tsbuildinfo` — PASS
- `npm run test:renderer:smoke -w @memmy/tauri-shell` — 3 PASS
- `npm run bundle:audit:test -w @memmy/tauri-shell` — 3 PASS
- `node scripts/engineering/tauri-parity.mjs --check` — 77/85, 14 routes

## Rollback

Stacked Draft PR on #58, original Electron preload and existing React appearance untouched. Keep production main unchanged until native WebKit multi-window E2E and independent review.
