# T1 Browser Data & Download Native Bridge — 2026-10-24

**State: IN_PROGRESS; not production feature-complete.** Scope: +10 named Electron-compatible bridge methods, stacked on Pet/Workspace/Tray PR #36. The new implementation is a real Rust-backed persistence layer and native folder picker, **not a simulated browser, CDP agent or Computer Use approval**.

## Checklist ownership (assignments, not approvals)

| Slice | Owner | Security review | E2E QA | Acceptance |
|---|---|---|---|---|
| History import, list, delete | A3 | A1 (pending) | A5 (contract PASS; browser visit GUI pending) | LEAD pending |
| Origin access allow/deny/ask | A4 | A1 (pending) | A5 (negative tests PASS; enforced live browser pending) | LEAD pending |
| Browser download folder/preferences | A3 | A1 (pending) | A5 (native folder picker UI pending) | LEAD pending |

## Implemented

- `getBrowserHistory`, `importLegacyBrowserHistory`, `removeBrowserHistory`, `removeSelectedBrowserHistory` read/write private Tauri `browser-use/history.json`, keeping per-visit IDs and timestamps, top 500 records and the legacy one-per-URL import semantics. No import from Electron's live user profile.
- `getBrowserAccessRules`, `setBrowserAccessRule` use private `browser-use/access.json`, validate exact `http(s)` URL origins, allow only `allow`, `deny`, `ask`, and cap to 200 origin decisions.
- `getBrowserDownloadSettings`, `chooseBrowserDownloadDirectory`, `resetBrowserDownloadDirectory`, `setBrowserAskBeforeDownload` use private `browser-use/download-settings.json`. New directories **must be selected using the native OS dialog**; approved directories limited to 20. Revoke active folder with Reset while preserving approvals consistent with the existing Electron flow.
- Atomic temp-file + rename storage, 0600 files / 0700 folder on Unix, size limits (4 MiB history, 128 KiB origin decisions, 64 KiB download settings). Symlink and oversized file negative tests. Original React routes, CSS, frames and pages unchanged.

## Evidence

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`: **16/16 PASS** (includes three browser store unit tests + download settings test and legacy Pet/Workspace tests).
- Native IPC frontend bridge tests: **5/5 PASS** with command argument/result assertions; no mock-only method counted when no Rust implementation exists.
- Frontend TypeScript `npm run typecheck -w @memmy/frontend-desktop`: **PASS**.
- Original browser UI regression + Tauri IPC bridge tests: **37/37 PASS** across four test files.
- Real Chromium original-React screenshot smoke: **3/3 PASS** (startup, nickname, memory-plugin-conflict) plus JS IPC mapping for Browser/Pet/Tray. This is not native WebKit E2E.
- `node scripts/engineering/tauri-parity.mjs --check`: **36/85 mapped, 49 unported**, original 14 routes and invariant React source hash preserved.

## Explicit gaps / non-approval

Browser sessions and navigation recording are **not yet implemented natively**. The history import/list/delete commands work on private data, but no new visits will appear solely from porting these stores. Access policies are stored persistently but **must not be represented as enforced browser sandbox policy** until real embedded WebView/CDP Browser+Computer Use integration has passed security review. Likewise download preferences are persisted but interception of actual browser downloads is pending. Native macOS UI E2E, Windows/Linux, independent QA signoff, CI #26, Pet full geometry, WebView origin hardening, and full 85/85 remain blockers. `releaseReady=false`, `supervisorSignoff=false`.
