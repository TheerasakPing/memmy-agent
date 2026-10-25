# T5 — Packaged Debug .app must run bundled Rust-managed Runtime

## Checklist planner and team verification

- [x] **A1 source audit:** `desktop_runtime_config` previously forced `bundled_root=None` whenever Rust compiled with debug_assertions, even when the executable was delivered in a real macOS `.app` containing Node, Memory, Backend, Agent Gateway and all compiled runtime files. The native runtime therefore fell back to developer checkout scripts and required `MEMMY_TAURI_DEV_BACKEND=1` for a debug preview, making the unsigned `.app` nonportable despite successful Bundle Audit.
- [x] **A6 Native runtime selection:** new `select_native_runtime_root(resources,allow_source_fallback)` probes the installed application's Resources/runtime directory. When a real folder exists it requires every original first-party compiled entrypoint to be a regular non-symlink file, then uses it for the normal Rust supervisor, regardless of the Rust optimization mode. Debug source-tree development uses old explicit workspace fallback *only* when the bundled Runtime folder is genuinely absent. Release builds fail closed on missing bundle. Unsafe symlinks and partial staging never fall back to arbitrary developer checkout paths.
- [x] **A3 Original React parity:** `desktop_app_info.isPackaged` reflects whether the validated bundled Runtime exists (rather than inferring from debug_assertions). React UI, 14 routes, existing Electron app and Tauri IPC shape remain unchanged.
- [x] **A4 security tests:** new Rust source-vs-bundle detection test covers missing bundle in dev and release, incomplete bundle, fully populated bundle, symlinked compiled entrypoint, and symlinked root directory. Never starts services in a real user HOME.
- [x] **A5 Rust checks:** `cargo test --locked --lib` **76/76 PASS**, `cargo check --locked` PASS, `cargo fmt --check` PASS.
- [x] **A5 original React renderer smoke:** **3/3 PASS**. Packaging audit fixture tests **6/6 PASS**. API scanner **84/85** methods with 5 marked PARTIAL, 1 NOT_MIGRATED and original 14 routes unchanged.
- [x] **A5 Actual rebuilt macOS ARM64 unsigned .app:** latest Tauri Debug app Build exit 0; generated real 1.01 GiB Mac arm64 bundle. Actual release-style Bundle Audit `ok:true`, `errors:[]` PASS; real packaged `memmy-memory --help` smoke via bundled Node and temporary HOME `ok:true`, exit 0. This rebuilt executable includes bundled-runtime path selection.
- [ ] **A5 Native interactive GUI smoke:** launch the rebuilt `.app` under a disposable HOME, verify actual window/Memory+Local API+Agent local services, shutdown gracefully; missing user GUI/Accessibility/permission gates must be reported honestly.
- [ ] **A5 Windows 11 x64 / Linux production bundle:** run their platform-specific release resource layout and installed E2E; signed installer validation remains open.
- [ ] **A4 Independent human review:** bundle path resolution and symlink TOCTOU, dev/release fallback policy, app code signing/notarization.
- [ ] **LEAD production acceptance:** blocked on original native extension folder drag, signed Updater real publisher feed test, WebKit/Agent Playwright same-session Computer Use, Browser selective cookie/cache delete, signed cross-platform GUI E2E; releaseReady=false.

## Why the fix matters

The Tauri Debug `.app` was structurally complete and passed shell/CLI smoke, yet the native Rust app chose source-checkout runtime solely based on compile mode. This fix makes debug packaging choose its genuine Resources/runtime consistently, and reports isPackaged truthfully. It does not rebrand the debug `.app` as signed Production installer.

## Reproduce

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib` (76/76 PASS)
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml` (PASS)
- `NODE_OPTIONS=--no-experimental-webstorage npm run test:renderer:smoke -w @memmy/tauri-shell` (3/3 PASS)
- `NODE_OPTIONS=--no-experimental-webstorage npm run bundle:audit:test -w @memmy/tauri-shell` (6/6 PASS)
- `node scripts/engineering/tauri-parity.mjs --check` (84/85 wired, 5 partial, 14 routes)

## Rollback

Stacked Draft PR atop #65; no Electron UI/fallback changes or user profile file modifications. Keep `main` protected pending native GUI E2E, security review and signed cross-platform packages.
