# T1 — Native Chrome/Edge extension status + active process inventory (68/85)

## Checklist planner: audit → implementation → independent checks → lead gate

- [x] **A1 Source audit** — compared Electron `installedExternalBrowsers`, `probeExternalBrowserInstallation`, `runningExternalBrowsers`, required `null` vs `false` semantics, accepted Chromium profile locations, strict process names, and original Computer Use React UI.
- [x] **A6 Rust implementation** — `native_browser_inventory.rs` probes only read-only Local State, Default/Profile N Preferences and Secure Preferences, the exact Memmy extension ID, bounded Manifest V2/V3 and bundled public key for unpacked extension. Supports macOS, Windows 11 and Linux installed-profile paths. Added a read-only macOS current-user `ps` and fixed Windows session-bound CIM process inventory, returning unknown for unsupported or unavailable probes.
- [x] **A3 React** — wired `listInstalledBrowserExtensions`, `getBrowserExtensionInstallation`, `listRunningExternalBrowsers` into original Tauri bridge; original React CSS, buttons and all 14 routes unchanged.
- [x] **A4 defensive tests** — reject malformed preferences, symlinks, dangerous paths, oversized file metadata, mismatched extension public keys, forged process executable paths, renderer helper processes and unsafe browser/credential contents. Caller must be the `main` Tauri WebView; no native elevation or arbitrary shell commands.
- [x] **A5 verified locally** — Rust unit 46/46 PASS including oversized metadata and wrong-key refusal; React targeted 32/32 passed; Rust `cargo check --locked` passed; parity scanner 68/85; renderer Chromium smoke 3/3 and bundle audit 3/3 passed.
- [x] **A5 latest Rust negative test** — extended wrong-public-key and oversized Preferences fixture, 46/46 Rust tests PASS with exit code 0.
- [ ] **A5 full frontend TypeScript** — compile attempted on busy Mac; verification using prior incremental build metadata remains in progress, require exit 0.
- [ ] **A5 native installed GUI** — macOS Tauri app profile reads + Chrome/Edge running detection and permission UX; Windows 11 x64, Linux app installation/E2E not verified.
- [ ] **A4 independent human security review** — Chromium profile symlink/TOCTOU hardening, Windows fixed shell command path, metadata accuracy and app sandbox behavior.
- [ ] **LEAD release signoff** — BLOCKED. 17 original bridge methods remain; Native WebView vs Playwright context, CI, notarization, packaging acceptance incomplete; `releaseReady=false`.

## Behavioral safety

Browser installed/enabled probes are tri-state: verified `true`, reliably absent `false`, unreadable/inconsistent `null`. An absent browser root may return false; corrupt or oversized Preferences, untrusted extension paths and restricted profile data return null rather than a forged success. The browser process check is read-only and returns null on execution failure, never 'closed'. No passwords, cookies, browsing history, tab contents or browser profiles are changed. The Browser Extension may require explicit user installation and permission acceptance.

Chrome/Edge on Windows are checked through a fixed system PowerShell executable and literal OS CIM request scoped to the current session; Linux process inventory is unknown to preserve the original unsupported state. These paths still require real installed Windows/Linux E2E.

## Local commands

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib`
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/computer-history-browser-enhancement.interaction.test.tsx src/pages/tests/browser-panel.interaction.test.tsx` — 32 PASS
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r52.tsbuildinfo`
- `npm run test:renderer:smoke -w @memmy/tauri-shell` — 3 PASS (Chromium, not native WebKit)
- `npm run bundle:audit:test -w @memmy/tauri-shell` — 3 PASS (fixture only)
- `node scripts/engineering/tauri-parity.mjs --check` — 68/85, 14 routes

## Rollback

Stacked Draft PR on #51. Original Electron fallback and React renderer unchanged. Do not merge to production main before installed native GUI E2E and independent review.
