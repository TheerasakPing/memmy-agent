# T1 Computer History native permission and Markdown bridge — 57/85 staged

## Checklist Planner / assignments

- [x] A1 Source audit: compared Electron `getComputerHistoryPermissionSessionId`, `getFullDiskAccessStatus`, and `openComputerHistoryMarkdown` against unchanged React and source contracts.
- [x] A6 Rust implementation: creates per-process UUID v4 in Tauri managed state; retains identical Electron restart detection semantics without persisting the ID; checks original macOS Full Disk Access protected locations in order.
- [x] A4 Security design/negative tests: reject webviews other than `main`, untrusted Markdown paths, symlinks, traversal, non-`.md` files, oversized files, and unreadable destinations. Only direct children under the Agent-owned isolated Tauri `computer-history/histories` directory can open.
- [x] A5 Unit/contract tests: 3 new Rust tests, 32/32 Rust tests pass; React bridge and Computer History interaction tests 52/52 pass with Node 26 Web Storage disabled in test-only process.
- [x] A5 Parity inventory: Tauri `57/85` native methods, original React routes `14`, no frontend route/CSS/page modifications.
- [ ] A4 Human independent security review: address path TOCTOU, portable canonical directory handling, protected-file probes, and genuine macOS privacy state.
- [ ] A5 Installed Native GUI E2E: verify a real current-process restart, Full Disk Access permissions after consent and revocation, and Markdown opening under a managed Agent run; Windows and Linux QA not complete.
- [ ] LEAD release signoff: **blocked**. Browser embedded WebView/Computer Use actions and remaining 28 methods, app signing, production release gates incomplete.

## Source-specific behavior

The Full Disk Access probe intentionally matches Electron's heuristic: first readable `~/Library/Application Support/com.apple.TCC/TCC.db`, then Safari bookmarks, then Mail; missing paths are inconclusive, other I/O failures deny. It is **not** a macOS TCC entitlement API or user-consent request. On Windows/Linux, return `true` to retain the original Electron contract. The process UUID is not an OS permission grant; it only helps React distinguish a page reload from an app restart.

The Markdown opener does **not** accept arbitrary filesystem paths and never imports the Electron user's original `~/.memmy` data. It opens only existing, bounded regular Markdown files within Tauri's isolated Agent data folder. The native opener is not production E2E certified.

## Local verification — macOS ARM64

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib`: **32/32 PASS**
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/computer-history-permission-guide.interaction.test.tsx src/pages/tests/computer-history-wechat-permission-state.test.ts src/pages/tests/computer-history-wechat-confirmation.interaction.test.tsx`: **52/52 PASS**
- Node 26 default experimental global Web Storage caused unrelated test-fixture initialization failures; disabling that feature for tests restored the existing Happy DOM environment without changes to product code.
- Typecheck, parity, sidecar, and renderer smoke results are separate acceptance gates; only mark them PASS when actually rerun on this branch.

**Rollback:** stacked on PR #44; original Electron runtime and React renderer files untouched. Keep `releaseReady=false`.
