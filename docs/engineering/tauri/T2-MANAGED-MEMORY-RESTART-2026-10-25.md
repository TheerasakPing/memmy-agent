# T2 — Managed Memory service restart with stable endpoint (73/85)

## Checklist planner and lead review

- [x] **A1 Source Audit** — original Electron restartMemoryService returns `{ok:true,baseUrl}` after restarting the Memory service while retaining the original running Local API / Agent endpoints. The React Memory Sources health monitor aborts stale probes and checks the same original base URL after restart.
- [x] **A2 Rust lifecycle** — `NativeRuntime` keeps a private path to the managed Memory data root and validated runtime sidecar entrypoint, along with the loopback URL and bearer token. A real restart stops only the Memory process, reuses its exact port/token/config, waits for authenticated Memory health before returning success. The managed Local API and Agent Gateway retain their original connection settings.
- [x] **A4 failure handling** — first-party `main` WebView only, no user supplied process arguments, executable or port; serialized restart under supervisor Mutex, background blocking worker away from Tauri UI thread, no fake success when Memory is absent or process startup fails. Failure shuts down dependent backend/Gateway and marks supervisor unavailable so the app must restart.
- [x] **A3 React** — real `restartMemoryService()` Promise mapped to a named Tauri command with exact legacy result type. React health/status UI, styling, buttons, routes and Electron fallback untouched.
- [x] **A5 Rust automated tests** — 54/54 Rust unit tests including uninitialized/stopped runtime refusal. `cargo check --locked`, `cargo fmt --check` PASS.
- [x] **A5 real managed Memory integration** — opt-in test starts Memory+Local API services with isolated temporary data, restarts native-managed Memory preserving identical URL/Token, downloads a new authorized JSON export, verifies saved bytes and cleans up children. Local backend startup requires existing `MEMMY_CLOUD_SERVICE` configuration; no remote network fetch is made for Memory export.
- [x] **A5 targeted React tests** — 17/17 PASS for Tauri bridge and Memory health UI, TypeScript compiler exit 0. Original React browser routes 14 unchanged.
- [x] **A5 parity scanner** — 73/85 existing Electron preload methods, 12 remaining. This is API method coverage, not production completion.
- [ ] **A5 installed GUI E2E** — test restart from a packaged macOS app while the Agent is active, measure local session reconnect, data durability and user health UI. Windows 11 x64 and Linux signed installer E2E not yet run.
- [ ] **A4 independent security review** — examine concurrent CLI reads/writes around Memory shutdown, sqlite durability, restart timeouts/failed cleanup and fixed-session credential reuse.
- [ ] **LEAD release signoff** — BLOCKED until 12 other contract methods, native WebView/Computer Use same-session control and cross-platform installed GUI + signing are ready. `releaseReady=false`.

## Behavioral boundaries

Memory restart does not restart the React WebView or the other managed sidecars. It does not create new credentials or invalidate the originally authenticated Local API connection. If the Memory sidecar cannot resume its previous port, it fails closed and prevents a misleading green success state. API parity does not imply full installed native GUI reliability.

## Local regression commands

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib`
- `MEMMY_CLOUD_SERVICE=https://api.memmy.cn MEMMY_TAURI_TEST_FULL_RUNTIME=1 MEMMY_TAURI_DEV_BACKEND=1 MEMMY_TAURI_DEV_MEMORY=1 cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib real_managed_memory_export_when_opted_in -- --nocapture`
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/memory/tests/sources-sub-page-health.interaction.test.tsx`
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r50.tsbuildinfo`
- `node scripts/engineering/tauri-parity.mjs --check`

## Rollback

Stacked Draft PR atop #55, no production main merge and original Electron production remains unaffected. Human review and native installed GUI E2E required for release.
