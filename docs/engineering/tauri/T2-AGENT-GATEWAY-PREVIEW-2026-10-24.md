# Memmy Turbo Tauri v1.2.5-alpha.2 — Agent Gateway development preview

**State:** incremental source/developer preview; original Electron v1.2.4 remains the stable fallback. `releaseReady=false`. No signed standalone installers. GUI screenshot/E2E is not certified.

## Actual integration

The Tauri Rust supervisor now owns the lifecycle of the real Memory SQLite service, the existing Backend Local API, and the real Agent Gateway through a controlled Node child. It checks Gateway `/webui/bootstrap` authentication before returning the runtime configuration to the original React renderer, and stops Gateway before Local API and Memory. On an unexpected Gateway process exit, the supervisor rejects stale runtime references. New files are isolated to the Tauri application data area.

The Gateway retains the original Agent CLI implementation rather than replacing tools with mocks. Only **16/85** Electron native bridge methods are ported; Browser/Pet/Tray/UI complete feature parity and the ability to execute all Agent tools remain unverified. Do not use production data.

## Quick start on the developer Mac

Install required dependencies (including `npm --prefix App/memmy-agent ci --ignore-scripts`) and build-compatible `better-sqlite3` native binding, then run from the repository root:

```sh
MEMMY_CLOUD_SERVICE=https://api.memmy.cn npm run preview:dev -w @memmy/tauri-shell
```

The cloud URL is an example; configure the real regional endpoint matching the account. The new command builds Memory, Backend and Agent, then launches the Tauri developer window with managed Memory/Agent enabled. There is no need to manually start the services. **This is not an installer**. Installing from GitHub's unbundled unsigned `.app` will not start these dependencies outside the developer workspace.

## Local QA checkpoints

- Real Node child E2E: Memory → Backend → Gateway authenticated `/webui/bootstrap`: PASS.
- Rust-owned end-to-end start and stop with `MEMMY_TAURI_DEV_BACKEND=1 MEMMY_TAURI_DEV_MEMORY=1 MEMMY_TAURI_DEV_GATEWAY=1 MEMMY_TAURI_TEST_FULL_RUNTIME=1`: PASS on Mac arm64.
- WebUI origin CORS regression (44 tests including exact Tauri origins and negative cases): PASS.
- Tauri Rust 9 tests; Node sidecar 4 tests: PASS on Mac arm64.
- Signed macOS/Windows/Linux installers and real GUI screenshot E2E: NOT VERIFIED; CI issue #26 still blocks remote checks.
- User data migration, Agent tool permissions, R1/R2 isolation, CSP hardening and browser permissions: require independent security + QA signoff.

## Planner assignments / acceptance

T2.01 owned A2 (implementation), A1 (security review), A5 (full E2E), LEAD (delivery gate). T1.01 69 API bridge methods remain with A3, A1, A5, LEAD. No independent reviewer has signed off and **neither should be marked DONE**.

Rollback by reverting the additive Tauri branch; existing Electron desktop is unchanged. Changes to the Agent WebSocket CORS allow only exact native Tauri WebView origins and still require a configured token secret.
