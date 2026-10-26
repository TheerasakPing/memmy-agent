# T2 — Agent Browser Surface end-to-end bridge (64/85) — 2026-10-25

## Checklist Planner / designated lanes

- [x] A1 Source audit: original Electron Agent Gateway uses authenticated managed Node IPC and ComputerUseSurfaceMessage/Action validators. Prior Tauri Gateway had no IPC; PR #48 staged fail-closed relay.
- [x] A2 Gateway: preserve PR #48's opt-in relay; Rust-owned managed Gateway enables it, routes only browser surface messages and sends only validated browser actions to its Agent child.
- [x] A3 Rust: bounded BrowserSurfaceStore, scoped session/target state, current-surface-only action writer, authenticated main WebView caller, lifecycle teardown, IPC events. Dispatch writes through spawn_blocking so the native UI thread cannot be held by a slow child pipe.
- [x] A4 Access controls: reject unknown sessionKey, cross-chat/target rebind, missing typed fields, oversize payload and unsafe navigation, coordinates and command fields. Unsupported browser access/capability/download/embedded automation requests get immediate schema-valid DENY, never silent grant or five-minute delay.
- [x] A5 Targeted automated checks: Rust 39/39 on hardened integration, React Browser/Computer Use 29/29, Node allowlist and denial 7/7, genuine child IPC round trip 1/1, Rust cargo check PASS, parity 64/85/14 routes, renderer Chromium smoke 3/3 PASS.
- [x] A5 Rust rerun after optional-field and session hardening — 39/39 PASS.
- [x] A5 Full sidecar test suite, real managed Browser IPC enabled in Gateway smoke, sequential test execution — 12/12 PASS with exit code 0. Earlier shared-Mac failures no longer reproduce in this isolated run.
- [ ] A5 TypeScript full workspace typecheck — previous full command stalled and did not return a passing exit code. A direct isolated incremental compiler check is under verification; do not mark PASS prematurely.
- [ ] A5 macOS installed native WebKit GUI/browser surface clicks, Windows 11 x64/Linux installed GUI E2E.
- [ ] A4 Independent human security review of Child WebView ACL, IPC source identity, surfacing credentials and screenshot privacy.
- [ ] LEAD production signoff BLOCKED; keep releaseReady=false, PR draft, Electron fallback intact.

## Behavior and important limits

Agent Browser sidebar now has a real event path: Agent (managed Node child) -> validated private Node IPC -> Rust-owned Gateway stdout tagged line -> Rust BrowserSurfaceStore -> Tauri event to first-party main React WebView. The reverse path uses the main WebView's named Rust command, validates the active session and commands, writes to Rust-owned Gateway stdin and forwards via authenticated parent-child IPC. The relay is enabled by the Rust owner for its managed Gateway only, never by a renderer flag.

Only browser preview events are forwarded; native Computer Use operating-system control is NOT enabled by this bridge. The sidebar currently shows Agent-managed Playwright screenshots and acts on the Agent-owned browser session. It does not yet expose full control of the separately created Tauri child WebView tab. Unrecognized Agent permission requests are explicitly denied, so interactive first-use consent remains a feature gap; explicit pre-existing site-policy grants can still apply under the Agent's policy reader.

## Local test commands

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib`
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/agent-browser-surface.interaction.test.tsx src/tests/native-browser-adapter.test.ts src/pages/tests/browser-panel.interaction.test.tsx`
- `npm run typecheck -w @memmy/frontend-desktop`
- `node --test App/shell/tauri/sidecar/surface-relay.test.mjs App/shell/tauri/sidecar/agent-ipc-deny.test.mjs App/shell/tauri/sidecar/surface-relay.ipc.test.mjs`
- `npm run sidecar:test -w @memmy/tauri-shell`
- `npm run test:renderer:smoke -w @memmy/tauri-shell`
- `node scripts/engineering/tauri-parity.mjs --check`

## Rollback

Stacked on Draft PR #48; no change to original Electron preload or 14 existing React routes. Release readiness requires independent review, sidecar smoke and installed macOS/Windows/Linux native GUI E2E.
