# T2 milestone: Rust-supervised REAL Memory + Local API (development-only)

**Status:** Functional native service bootstrap proof, **not production ready**. This is stacked on Draft PR #31 and does not change the existing Electron production app or the React UI pages/styles.

## What now runs

The Tauri Rust `NativeRuntime` supervisor starts two child processes only in debug opt-in mode:

1. A compiled **real** Memory HTTP service (`Memory/dist/src/server/index.js`, via `sidecar/memory.mjs`) with its own SQLite database, random loopback port and approximately 244-bit UUIDv4-derived session token.
2. The original `@memmy/backend` Local API (`App/backend/dist`, via `sidecar/backend.mjs`). It receives the Rust-owned Memory URL and token, opens its own SQLite app DB and creates a fresh UI token.
3. Both share a **new Tauri-specific application-data directory**. New config starts with agent-source auto-scan / watch / skill injection disabled. No implicit import of old Electron databases or secrets.
4. Rust checks a **real HTTP `/api/v1/health` response**, including Memory schema readiness and protocol/service metadata, before starting Local API; when either owned child exits unexpectedly it fails closed, and main window destruction closes processes.
5. `desktop_runtime_config` returns validated loopback Local API details to the unchanged React renderer; output is not a release-ready full-Agent contract.

## Verified evidence (macOS arm64)

- `npm run memory:build`: PASS (compiled production JS for real Memory service)
- `npm run build -w @memmy/backend`: PASS
- `npm rebuild better-sqlite3`: PASS (required on the testing Mac after install scripts were disabled; native addons must be bundled for end users)
- `npm run sidecar:test -w @memmy/tauri-shell`: **3/3 PASS**, including real Memory SQLite + Local API boot, API authentication boundary, stop and isolated data.
- `MEMMY_TAURI_REAL_MEMORY_TEST=1 cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml rust_supervises_real_memory_when_explicitly_requested`: PASS; actual Rust Memory start/health/stop on Mac.
- `MEMMY_TAURI_TEST_FULL_RUNTIME=1 MEMMY_TAURI_DEV_BACKEND=1 MEMMY_TAURI_DEV_MEMORY=1 MEMMY_CLOUD_SERVICE=https://api.memmy.cn cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml real_backend_and_memory_rust_owner_smoke_when_opted_in -- --nocapture`: PASS (Rust manages the real combined Memory/Local API start + stop).
- Default `cargo test --locked`: 8/8 PASS (opt-in integration tests require explicit flags).
- `npm run typecheck -w @memmy/frontend-desktop`: PASS.
- `MEMMY_TAURI_TEST_FULL_RUNTIME=1 MEMMY_TAURI_DEV_BACKEND=1 MEMMY_TAURI_DEV_MEMORY=1 MEMMY_CLOUD_URL=http://127.0.0.1:1 cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml real_backend_and_memory_rust_owner_smoke_when_opted_in`: PASS (the dummy Cloud URL is test-only; no Cloud functionality is claimed).
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`: PASS.
- `MEMMY_LEGAL_CN_BASE_URL=https://memmy.cn MEMMY_LEGAL_INTL_BASE_URL=https://memmy.bot npm run tauri:build -w @memmy/tauri-shell -- --debug --bundles app`: PASS; unsigned macOS arm64 39.65 MiB debug `.app`. **No signed installer or GUI E2E**.
- Native packaged/signed GUI E2E, full Browser/Pet/Agent/Tray functionality, Windows 11, Linux: **NOT YET VERIFIED**.

## Quick start (developer terminal, not a distributable installer)

Prerequisites: Node with working native `better-sqlite3`, Rust/Tauri v2 toolchain, built Memory and Backend, proper cloud endpoint setting. From repo root:

```sh
npm ci
npm run memory:build
npm run build -w @memmy/backend
MEMMY_TAURI_DEV_BACKEND=1 \
MEMMY_TAURI_DEV_MEMORY=1 \
MEMMY_CLOUD_SERVICE=https://api.memmy.cn \
MEMMY_LEGAL_CN_BASE_URL=https://memmy.cn \
MEMMY_LEGAL_INTL_BASE_URL=https://memmy.bot \
npm run tauri:dev -w @memmy/tauri-shell
```

The cloud service setting above is a **configuration example, not a claim of cloud availability**. Use the correct edition/endpoint for your account. In debug, the application will start its own real Memory and Local API on `127.0.0.1` using private session tokens; **Agent Gateway and 69 remaining native bridge methods are NOT yet migrated**. Do not use this debug build to migrate important personal data.

## Security and remaining release gates

- A1 Security: independent code review, threat-model native IPC/origin boundaries and optional launch-at-login, harden `csp: null` (P0).
- A2 Memory: Agent Gateway startup/heartbeat/crash handling; data import and rollback; release-sidecar identity and token lifecycle. Current Memory socket port is chosen by briefly binding/releasing port 0 before child bind, leaving a narrow port-allocation race that needs hardening before release.
- A3 Integrations: finish 69/85 native bridge methods without deleting old controls or changing existing React pages.
- A5 QA: full independent native macOS/Windows/Linux E2E/screenshot parity and original Memory functional regression.
- A6 Release: Node/Memory/Agent as signed packaged binaries and installers on all three OSes; avoid dev Node PATH dependency.
- LEAD: final approval after QA/Security and CI (Actions issue #26 still unresolved).

The checklist retains **5 IN_PROGRESS, 7 BACKLOG, 0 signoff-complete** main tasks. Subtasks T2.01.A/B have automated local smoke evidence but neither has an independent A1 security signoff nor A5 QA approval. Do not mark them release DONE.

**Rollback:** Drop this stacked branch; Electron is unchanged, no legacy database copied. New Tauri runtime files are namespaced under the new bundle ID and must not be migrated automatically.
