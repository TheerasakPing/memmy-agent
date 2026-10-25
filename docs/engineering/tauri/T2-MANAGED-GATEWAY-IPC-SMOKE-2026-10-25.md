# T2 — Managed Agent Gateway Browser IPC E2E closure | 2026-10-25

## Team Checklist Planner

- [x] A1 Source audit: traced Rust-managed `MEMMY_TAURI_BROWSER_SURFACE_RELAY=1` through Tauri's `gateway.mjs` into the Agent child; previous gateway.test omitted that flag.
- [x] A6 Implementation: startup test now exercises the same private Node IPC launch mode used by the Rust supervisor, not the disabled-by-default transport configuration.
- [x] A4 Security verification: previous `surface-relay.test.mjs` and `agent-ipc-deny.test.mjs` enforce valid Agent session identity, disallow privileged commands and reject unapproved browser access/downloads.
- [x] A5 Sequential sidecar suite with real managed Browser IPC: **12/12 PASS**, `SIDECAR_SUITE_EXIT:0`; services include Local API, Memory and Agent Gateway. This resolves the previously failing combined Gateway smoke gate in PR #49.
- [x] A5 Original Chromium renderer smoke (from stacked PR #49): 3/3 PASS; Rust lib tests 39/39, React Browser integration 29/29 and Rust `cargo check --locked` previously verified.
- [ ] A5 Full React TypeScript typecheck: isolated check rerunning, final exit result must be captured before marking PASS.
- [ ] A5 Installed native macOS Tauri WebKit GUI, Windows 11 x64 GUI and Linux GUI multi-window Browser/Computer Use E2E.
- [ ] A4 Independent human security review of native WebView isolation, loopback auth, Agent IPC and permissions.
- [ ] LEAD release approval, signing, notarization and production merge. **releaseReady=false**.

## Evidence

- `NODE_OPTIONS=--no-experimental-webstorage npm run sidecar:test -w @memmy/tauri-shell` returned exit 0 with 12 passing tests, including real Agent Gateway started with IPC enabled and WebUI bootstrap access control.
- Original Tauri renderer routes remain 14. Native Bridge contract remains 64/85; the 21 unported methods are not being counted as implemented.
- Test executions operate under temporary isolated data directories. Never touch end-user Agent keys or long-lived profiles.

## Semantics / remaining work

Real IPC mode proves service lifecycle with private Node child transport. It does not prove that the Tauri native child WebView and Agent Playwright context are the same tab or certify user-facing Click/Scroll in a packaged native GUI. Existing Electron rollback remains available. The test must remain fail-closed on authentication and origin checks.

## Rollback

Stacked Draft PR based on PR #49. Reverting the test-mode change leaves runtime feature behavior unchanged.
