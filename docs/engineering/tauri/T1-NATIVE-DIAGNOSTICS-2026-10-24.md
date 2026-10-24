# T1 — Native diagnostics API increment (40/85)

Scope: add three native Rust-backed functions to the **same** React bridge: `getLogLevel`, `setLogLevel`, `openLogsDirectory`. Each operation has a dedicated Tauri command; no arbitrary renderer shell paths. Production Electron remains unchanged.

- A3 implementation: fixed four allowlisted log-level values, app-local isolated persistent state, unique temporary file followed by atomic rename; rejects existing symlink or non-regular log-level file. The logs directory is owned by the Tauri app; renderer cannot choose or inject another filesystem path.
- A1 security cases: invalid values (`trace`), corrupt persisted level, symlink to `/etc/hosts`, and restricted paths all explicitly rejected. Log-level setting is currently app-side persistence; configuring the log emission of every child process is **not** yet certified.
- A5 unit/contract evidence: `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml` **17/17 PASS**. `npm run typecheck -w @memmy/frontend-desktop` **PASS**. `npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts` **6/6 PASS**. Parity generated and checked **40/85**. This evidence is from the implementer environment; it does **not** constitute an independent QA signoff.
- LEAD release gate: outstanding 45 API methods, computer-use/browser embedding parity, Pet/Tray GUI interaction E2E, full feature screenshots, independent QA approval. `releaseReady=false`. No stable release claim.
