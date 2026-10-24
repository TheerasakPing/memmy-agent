# T1 incremental native parity and E2E evidence — October 24, 2026

**Status: IN_PROGRESS / REVIEW REQUIRED.** These changes are *not* a final native feature parity signoff. The Electron v1.2.4 renderer pages, routes, `styles.css` and `app-frame.tsx` were not modified.

## Checklist and independently reviewable ownership

| Task | Owner / implementation | Security reviewer | QA | LEAD acceptance | State |
|---|---|---|---|---|---|
| T1.01 Native bridge contracts | A3 | A1 | A5 | LEAD | 26 / 85 bridged; 59 not ported, no signoff |
| T1.02 Pet window + OS Tray | A3 | A1 | A5 | LEAD | Basic real native window/tray, full geometry and lifecycle GUI parity pending |
| T1.03 Browser / Computer Use | A4 | A1 | A5 | LEAD | Not ported; full browser session, trusted capture and permission boundaries are P0 blockers |
| T4.02 React UI E2E | A5 | A1 | A6 | LEAD | Real headless Chromium UI screenshot smoke 3 modes, native WebKit full E2E pending |

The labels above are **assigned responsibilities, not approvals**. No independent A1/A5/LEAD approval has been obtained. CI #26 remains disabled.

## Implemented and reviewed locally

- **Workspace I/O** (`readWorkspaceDirectory`, `writeWorkspaceFile`) behind a typed Rust boundary: rejects ungranted roots, absolute/traversal relative paths, disallowed links, internal directories, unexpected file types, oversized files (2 MiB), and hidden agent state. The native folder picker grants explicitly selected canonical workspace roots, while Tauri-owned workspace files require no manual approval. Unit tests check positive and negative cases. This is not a generic filesystem or shell endpoint.
- **Pet mode** (`setPetWindow`, `hidePetWindow`, `syncPetWindowLayout`, `startPetWindowDrag`, `onRouteTargetRequest`) uses Tauri dedicated transparent always-on-top webview and legacy React `?memmyMode=pet` launch parameters; validates target routes, hashes, IDs and layout size before native window changes. Switching back emits validated route targets. Not yet equivalent to Electron's pointer-anchor reposition logic or complete drag lifecycle.
- **OS tray** (`setMenuBarIcon`, `setComputerHistoryTrayIndicator`) creates a real Tauri tray icon; indicator updates native tooltip. Visual recording badge behavior and OS-specific tray interaction are not yet UI-certifiable.
- **Window-close request** (`onMainWindowActionRequest`) uses a fresh nonce, restricts resolution to the original main window and validates responses to the pending close event. Rejects unsolicited quit/hide requests; desktop close is intercepted to allow original React guidance. Requires native Close/Quit GUI E2E before full approval.
- **Exact unchanged frontend**: source hashes and 14 routes enforced by `scripts/engineering/tauri-parity.mjs --check`.

## Local tests and what they prove

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`: **12/12 PASS** (includes authorization negative cases and strict Pet URL/layout/close nonce tests).
- `vitest run App/frontend/desktop/src/tests/tauri-bridge.test.ts`: **5/5 PASS**, explicit command mapping and negative unsupported methods.
- `node scripts/engineering/tauri-parity.mjs --check`: **26/85 mapped**, **59 outstanding**, original 14 routes preserved.
- `node scripts/engineering/tauri-renderer-smoke.mjs`: real macOS Chromium screenshots at 1200x780: **startup, nickname, memory-plugin-conflict** each rendered visibly; IPC mapping for Pet/Tray verified with a *mock native IPC*. Screenshots in [`ui-smoke/`](./ui-smoke/). This is *renderer UI smoke*, **not actual native WebKit/Tauri end-to-end**.
- Cross-platform compiler smoke: local macOS Rust check/tests only; Linux and Windows pending CI availability.

## Required before T1 / T4.02 may be marked DONE

Port remaining 59 Electron APIs with real OS/browsing implementations; verify browser history/download/permissions/embedding, external computer use, native pet geometry drag/close/minimize, logs, updater and user-data migration. Run end-to-end signed installer on macOS and Windows/Linux; assert screenshots, security permissions, data persistence, close action and tray with real human QA. Security reviewer must evaluate filesystem TOCTOU/symlink race between canonicalization and writes before production signoff. Tauri CSP currently `null`. Keep `releaseReady=false` and Electron fallback intact.
