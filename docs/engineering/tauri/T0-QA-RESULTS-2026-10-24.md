# T0 Validation Evidence — Rust/Tauri v2 + React

**Source base:** `74b26fc78ebd14a784981ba8e83bebf878c20865` (fork main)
**Platform:** macOS arm64
**Rust:** 1.95.0 / Cargo 1.95.0
**Node:** 26.8.2 (local)
**UI:** Original React source, original styles, pages, navigation, icon. No replacement UI.

| Gate | Verified result | Scope / limitations |
|---|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS | source-only dependency install |
| `npm run version:check` | PASS | package v1.2.4 |
| `node scripts/engineering/tauri-parity.mjs --check` | PASS | 14 routes, 85 original bridge methods, 13 methods wired, 72 pending; SHA snapshot of 4 UI source files |
| `npm run typecheck -w @memmy/frontend-desktop` | PASS | original React renderer plus Tauri adapter |
| `npm exec -w @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts` | PASS 3/3 | Electron bridge remains unchanged; Tauri invoke and unsupported controls |
| `cargo check --manifest-path App/shell/tauri/src-tauri/Cargo.toml` | PASS | Rust Tauri host macOS arm64 |
| `cargo test --manifest-path App/shell/tauri/src-tauri/Cargo.toml` | PASS 1/1 | Rust loopback config token and origin validation |
| `MEMMY_LEGAL_CN_BASE_URL=https://memmy.cn MEMMY_LEGAL_INTL_BASE_URL=https://memmy.bot npm run build -w @memmy/frontend-desktop` | PASS | Original React UI built unchanged |
| `npm run tauri:build -w @memmy/tauri-shell -- --debug` | FAIL in macOS DMG packaging | Compiled app, but Finder AppleEvent timeout -1712 in `bundle_dmg.sh` |
| `npm run tauri:build -w @memmy/tauri-shell -- --debug --bundles app` | PASS | Tauri macOS Debug `.app` bundle 35.66 MiB (unsigned / not releasable) |
| Signed macOS DMG, Windows 11 x64 MSI/NSIS, Linux package | NOT RUN | No signed release evidence |
| Functional 85-method native E2E | NOT RUN | Only 13 bridge methods are currently wired; 73 remain |
| Screenshots of all 14 React routes vs original Electron | NOT RUN | UI source identity is NOT a pixel-parity test |
| Rust-owned Memory/Agent lifecycle, migration & rollback | NOT IMPLEMENTED | `getRuntimeConfig` requires valid native runtime provisioning |
| Independent Security/A5/LEAD review | NOT RECEIVED | Draft-only PR, do not merge |

## QA disposition

- This validates a source/build **migration scaffold**, not a feature-complete native application.
- Default Tauri config currently has `csp: null`, which must be hardened before release.
- Electron packaging tests from the upstream baseline may still run for compatibility but **do not count** as Tauri native E2E and cannot be used to ship Tauri.
- The original React routes/components have not been rewritten or removed; runtime parity remains blocked for 72 methods and native sidecar lifecycle.
- Keep this work isolated; do not replace installed Electron app or migrate user data yet.
