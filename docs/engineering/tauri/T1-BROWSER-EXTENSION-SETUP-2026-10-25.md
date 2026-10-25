# T1 — Native Browser Extension setup in Tauri v2 (65/85)

## Checklist Planner / designated lanes

- [x] A1 Source Audit — compared Electron `prepareBrowserExtension(browser, revealFolder)` with original React settings, statuses, supported browsers and fixed Chrome/Edge extension-manager URLs.
- [x] A6 Rust implementation — added `desktop_prepare_browser_extension` to Tauri's native extension module. Validates first-party `main` WebView, accepts only `chrome`/`edge`, checks bundled MV3 extension contents, opens native extension-management page via fixed OS commands and optionally opens the bundled source folder.
- [x] A4 Security negative tests — fixed commands only (`/usr/bin/open -a Google Chrome|Microsoft Edge` and Windows fixed Chrome/Edge executables from OS application directories). No arbitrary executable path, shell interpolation, renderer-driven URL or custom scheme permitted. Invalid browser inputs and unknown platforms are rejected/unsupported.
- [x] A3 Original React compatibility — wired existing `prepareBrowserExtension()` API and kept original Computer Use settings page, buttons, styles and all 14 routes unchanged.
- [x] A5 Rust `cargo test --locked --lib` — **40/40 PASS** including launcher allowlist test. `cargo check --locked` and `cargo fmt --check` PASS.
- [x] A5 React bridge plus Browser enhancement integration tests — **32/32 PASS**; direct project `tsc --noEmit --incremental` returns **exit 0**.
- [x] A5 Parity scanner — **65/85 native methods, 20 still unmigrated**. Original UI hash/route gate unchanged.
- [x] A5 Earlier stacked Gateway native IPC Sidecar full suite — **12/12 PASS** on PR #50; not rerun for this limited Browser Extension setup change.
- [ ] A5 Native installed macOS/Windows 11 x64/Linux GUI E2E: actual Chrome/Edge presence, Load Unpacked, Finder/Explorer folder reveal and browser-profile extension activation.
- [ ] A4 Independent security reviewer: OS process launching and packaged MV3 integrity, Windows path/reparse point handling, alternative Chromium channels.
- [ ] LEAD production approval: BLOCKED until all native Browser + Computer Use methods, review and signed installers pass; releaseReady=false.

## Behavior and differences from the original

The same React Computer Use settings button now has a real native Tauri action for browser setup. It **does not install the extension, modify Chrome or Edge profiles, grant debugger permissions, or claim that an extension is already installed**. User must still install/enable the extension through the browser. Linux currently returns `browser-not-found` to match Electron's unsupported manager launch. A desktop-open action uses the OS opener rather than implementing Electron's Finder show-item behavior pixel-for-pixel.

## Regression commands

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib` — 40 PASS
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml` — PASS
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/computer-history-browser-enhancement.interaction.test.tsx src/pages/tests/browser-panel.interaction.test.tsx` — 32 PASS
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r50.tsbuildinfo` — exit 0
- `node scripts/engineering/tauri-parity.mjs --check` — 65/85, 14 original routes

## Rollback

Draft PR stacked on #50, no stable Electron runtime modifications or automatic extension installation. Marked as working API integration, not production GUI acceptance.
