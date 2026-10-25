# T2 — Native authenticated Memory export (72/85) · 2026-10-25

## Checklist planner / source audit / delegated verification

- [x] **A1 Audit:** original Electron `exportMemoryDatabase()` uses native Save Dialog followed by the Memory service's GET `/api/v1/admin/export` and authenticated bearer token. It exports a JSON bundle (not an unsafe direct SQLite copy). Managed Tauri Memory is privately launched with a Rust-generated random token and only listens on `127.0.0.1`.
- [x] **A2 Rust lifecycle:** `NativeRuntime` retains a *private* clone of the Memory loopback origin and random bearer token only when all managed services start successfully. `memory_export_auth()` checks the child process is still running and that the supervisor has not been stopped. Token never returned to webview or logged.
- [x] **A6 Native export:** user triggers the original React Memory Export button; the native Save Dialog chooses an absolute JSON file and only the Rust-owned Memory service gets queried. A blocking Rust worker sends authenticated HTTP, rejects redirects and proxy use, enforces connect/read total timeouts, caps response at 128 MiB, rejects non-200/invalid JSON/foreign service manifest and atomically commits bytes via an exclusive temporary file.
- [x] **A3 React/contract:** original `exportMemoryDatabase()` Promise returns `{canceled:true}` or `{canceled:false, exportPath, bytes}`, original Memory Sources UI, messages and 14 routes unchanged. No Electron change and no 'successful export' stub.
- [x] **A4 security regression:** denies non-loopback HTTP(S), credential-bearing URLs, query strings, invalid bearer format, symlinked output destinations and unsafe file suffix; user does not control service URL or token.
- [x] **A5 Unit tests:** `cargo test --locked ... --lib` 53/53 PASS after optional real E2E added; pure integration covers local HTTP request headers, bearer token, response content and persisted bytes.
- [x] **A5 Actual Memory service integration:** `MEMMY_CLOUD_SERVICE=https://api.memmy.cn MEMMY_TAURI_TEST_FULL_RUNTIME=1 MEMMY_TAURI_DEV_BACKEND=1 MEMMY_TAURI_DEV_MEMORY=1 cargo test --locked ... --lib real_managed_memory_export_when_opted_in -- --nocapture` PASS with real managed Memory + Local API, isolated temp user data, real authenticated JSON export, atomic file compare and supervised shutdown. The cloud service setting selects the existing backend startup configuration; export request itself goes only to the managed loopback Memory service.
- [x] **A5 React/TypeScript:** Tauri bridge + Memory Sources Health tests 17/17 PASS; `tsc --noEmit` PASS; parity manifest 72/85 native methods; original React routes unchanged (14).
- [ ] **A5 installed native GUI E2E:** macOS Tauri `.app` Save Dialog choose/cancel/overwrite and real export with a nonempty production Memory DB, Windows 11 x64/Linux installed GUI and signed artifact tests.
- [ ] **A4 independent reviewer:** check local service authentication, native dialog thread, filesystem symlink/TOCTOU and export contents that might carry private user information.
- [ ] **LEAD release readiness:** BLOCKED. 13 existing preload API methods remain (Updater, Browser, CLI setup, Memory restart, embedded tab coordination). Same Browser tab vs Agent Playwright session remains to be verified. `releaseReady=false`.

## Sidecar health test investigation

Initial opt-in full-runtime test failed `sidecar exited or never became ready` because the managed Local API requires explicit `MEMMY_CLOUD_SERVICE` or `MEMMY_CLOUD_URL` even for an offline Memory export session. Re-running with the existing supported cloud configuration env resolved the startup issue; real authenticated Memory export passed. No product startup constraint was weakened and no user profile was touched.

## Local QA commands

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib`
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/memory/tests/sources-sub-page-health.interaction.test.tsx`
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r50.tsbuildinfo`
- `node scripts/engineering/tauri-parity.mjs --check`

## Rollback

One stacked Draft PR atop #54; all UI/Electron behavior preserved. No production merge or claim of complete native functionality before review and genuine macOS, Windows and Linux GUI acceptance.
