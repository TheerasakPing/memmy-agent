# T1 — Native Browser Extension packaging + WebKit microphone access (61/85)

## Planner / task ownership

- [x] **A1 source audit (contract mapping)** — mapped Electron `revealBrowserExtension`, `getBrowserExtensionDirectory`, `getMicrophoneAccessStatus` and `requestMicrophoneAccess` to original React callers. No CSS/pages/routes changed.
- [x] **A6 implementation** — two Tauri/Rust commands check an existing MV3 extension and open its folder using native OS opener; two WebKit permission bridges query the browser permission state and request a real microphone stream, shutting all tracks after probing.
- [x] **A4 defensive tests authored** — extension must be a real non-symlink directory with required regular assets, bounded manifest and MV3 declaration; mic query does not initiate capture; only actual getUserMedia success reports granted; denied / unavailable / transient states distinguished.
- [x] **A5 automated QA** — Rust unit 34/34; React targeted 39/39; TypeScript typecheck PASS; bundle audit 3/3; original React Chromium renderer smoke 3/3; Tauri parity inventory 61/85; isolated Local API / Memory / Agent Gateway sidecar smoke 4/4 PASS. Browser extension original-source hash comparison PASS in temp-copy check.
- [x] **A5 packaging controls** — `tauri.conf.json` bundles `../../desktop/extensions/memmy-browser` to `browser-extension`; Tauri macOS Info.plist declares `NSMicrophoneUsageDescription`; mac custom bundler fails unless declaration and original MV3 file content exist.
- [ ] **A4 independent human/security review** — not obtained. Permissions and extension packaging require external reviewer before release.
- [ ] **A5 real installed Tauri GUI E2E** — not run. Verify native macOS mic prompt/revocation, user-gesture microphone capture, Chrome/Edge Load Unpacked, real extension authentication, and resource path on macOS/Windows/Linux.
- [ ] **LEAD final signoff** — BLOCKED. Keep `releaseReady=false` and preserve working Electron rollback until UI feature parity & signed installers pass.

## Safety, scope and remaining blockers

**61/85 methods wired; 24 outstanding; 14 original React routes retained.** Coverage is API wiring, not a completed cross-platform application.

The Tauri microphone path uses the native WebView's `navigator.permissions.query` when supported. A missing permission-query API returns `not-determined`, *not* granted. `requestMicrophoneAccess` invokes `getUserMedia({audio:true,video:false})` and stops every track; only capture success returns granted. WebKit's actual OS consent prompt has not been manually certified and must be tested in a bundled `.app`.

The browser extension is **not installed, authorized or remotely controlled** by merely revealing a folder. Rust does not accept renderer-supplied filesystem paths. Installed bundled app's extension source must pass the source-hash verification at packaging, with the original MV3 manifest and resources. User still needs to load it into Chrome/Edge and explicitly approve requested broad website/debugger permissions.

The original React browser panel uses Electron's `<webview>`. Tauri does not implement that element automatically. Native embedded browsing, per-category data deletion, sidebar interactive Computer Use, and browser automation remain **incomplete**; do not claim full feature parity or release readiness.

## Test evidence and reproducibility

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib` — 34 PASS
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml` — PASS
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/tests/native-microphone-permissions.test.ts src/pages/tests/asr-recorder.test.ts src/pages/tests/computer-history-browser-enhancement.interaction.test.tsx src/pages/tests/computer-history-wechat-permission-state.test.ts` — 39 PASS
- `npm run typecheck -w @memmy/frontend-desktop` — PASS
- `npm run sidecar:test -w @memmy/tauri-shell` (isolated) — 4 PASS; previous concurrent run on PR #45 had resource-related failure, this isolated pass does not certify bundled production.
- `npm run test:renderer:smoke -w @memmy/tauri-shell` — PASS, Chromium renderer only.
- `node --test App/shell/tauri/packaging/audit-bundle.test.mjs` — 3 PASS
- `plutil -lint App/shell/tauri/src-tauri/Info.plist`, `cargo fmt --check`, `git diff --check`, `node scripts/engineering/tauri-parity.mjs --check` — PASS

Rollback: PR stacked on #45. No Electron runtime source modifications, user data migrations, or automatically installed browser extension.