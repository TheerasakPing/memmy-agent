# T2 — Tauri Native Browser Tab selection + close lifecycle (76/85)

## Checklist Planner — lead delegation and verification

- [x] **A1 Source Audit** — Electron selects guest webContents IDs and emits `memmy:browser:close-tab`, while original React `BrowserPanel` passes `getWebContentsId()` to `AgentThreadPanel` and uses `selectEmbeddedBrowserTab`. Tauri adapter previously returned zero, disabling selection and close UI. Native Tauri child WebViews are Rust-created with UUIDs; they must never be confused with the separate Agent Playwright Browser session IDs.
- [x] **A3 Frontend implementation** — added a bounded per-renderer native UI tab registry that allocates monotonic positive safe-integer handles only after a native Rust WebView is created. Each handle selects that exact native adapter; nonselected WebViews are hidden by the existing real `nativeBrowserBounds()` Rust invocation. A new WebView cannot flash over another selected tab while it is being created. Existing React layout, browser tabs, buttons and 14 routes unchanged.
- [x] **A6 lifecycle** — `onEmbeddedBrowserClose` subscribes to real tab-close notifications only after `nativeBrowserDestroy` succeeds; native close failures are not misreported. Registry resources are cleaned even on native destroy error; initial creation races and registry saturation fail closed. `selectEmbeddedBrowserTab(null)` hides tab views. Invalid handles or unsafe numeric values cannot select tabs.
- [x] **A4 security boundary** — native UI handles exist solely in the original trusted React WebView and are never passed to Agent IPC as Electron guest webContents IDs or as Agent session/target identity. No remote origin is given Tauri IPC permissions. Each guest stays limited by the existing Rust UUID registry and origin/navigation protections.
- [x] **A5 React tests** — 32/32 PASS across native adapter, original BrowserPanel and Tauri bridge, including multiple tabs, selection isolation, rejected unknown handles, confirmed-close vs failed-close, listener unsubscription, and no selected-tab overlay during a new native guest creation.
- [x] **A5 native/parity** — Rust 56/56 library tests PASS, `cargo check --locked` PASS, `cargo fmt --check` PASS; TypeScript project incremental `tsc --noEmit` PASS; renderer Chromium smoke 3/3 PASS; packaging structural audit 3/3 PASS; Tauri native method parity **76/85** and 14 original routes unchanged.
- [ ] **A5 native installed GUI E2E** — verify selection and guest close with real macOS WebKit child WebViews and Agent-thread tabs, Windows 11 x64 WebView2 and Linux WebKitGTK installed GUI sessions. Chromium renderer smoke does not count as native GUI E2E.
- [ ] **A4 independent human security review** — analyze UI-handle reuse/lifecycle, cross-tab focus/visibility, process restarts and possible race conditions.
- [ ] **LEAD Production release** — BLOCKED; 9 Electron bridge methods remain, notably Update download/install, browser-data categories, direct Computer Use tab/Agent context, CLI installer and external agent launches. ReleaseReady=false. Original Electron fallback is untouched.

## Behavioral distinction

`getWebContentsId()` now returns a trusted renderer-scoped *native UI handle*, not an Electron webContents ID. It is designed for selecting and closing the matching Rust-owned child WebView only. `copyEmbeddedBrowserTabMention` and `markEmbeddedBrowserUserNavigation` remain unported, so this PR does **not** grant the Agent access to that native tab or imply that Tauri WebKit and Agent Playwright share a browser context. A native close notification is not sent unless the underlying Rust close action succeeds.

## Reproduce

- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/tests/native-browser-adapter.test.ts src/pages/tests/browser-panel.interaction.test.tsx` — 32/32 PASS
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r50.tsbuildinfo` — PASS
- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib` — 56/56 PASS
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml` — PASS
- `npm run test:renderer:smoke -w @memmy/tauri-shell` — 3/3 PASS
- `npm run bundle:audit:test -w @memmy/tauri-shell` — 3/3 PASS
- `node scripts/engineering/tauri-parity.mjs --check` — 76/85, 14 routes

## Rollback

Stacked Draft PR atop #57. No Electron preload or existing React styling changes. Keep production main unchanged pending installed native GUI E2E and independent human review.
