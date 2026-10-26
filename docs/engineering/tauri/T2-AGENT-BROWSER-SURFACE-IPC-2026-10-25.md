# T2 — Agent Browser Surface IPC transport (staged, fail closed)

## Checklist and owners

- [x] A1 source audit: original Electron Agent process uses Node IPC for ComputerUseSurfaceMessage and ComputerUseSurfaceAction; Tauri Gateway wrapper launched its Agent without IPC.
- [x] A2 Gateway code: add a separate allowlisted browser-only relay, with bounded event/action frames and session identity sourced from Agent rather than React.
- [x] A4 negative security test cases authored: reject unknown/stale sessionKey, malformed/oversize frames, image payload abuse, non-browser messages, key injection, unsafe URL schemes and credentials; revoke on surface close and process shutdown.
- [x] A5 automated test source added to sidecar:test, including fake Agent events and scoped actions.
- [x] A6 rollout guard: wrapper uses Node child IPC only with MEMMY_TAURI_BROWSER_SURFACE_RELAY=1; otherwise the old Gateway startup path stays unchanged.
- [ ] A5 execute tests on connected macOS worker, including real Agent+Memory+Local API smoke, Rust unit and React bridge tests. The local Mac MCP tunnel disconnected during this tranche.
- [ ] A2/A3 complete and commit Rust supervisor surface store and React event/action bridge. Draft code exists only in a local Mac worktree, NOT pushed or verified.
- [ ] A4 independent security QA: review IPC permissions, agent identity and stale surface handling; Windows 11/Linux native GUI not verified.
- [ ] LEAD production approval: withheld; releaseReady=false.

## Protocol and disabled-by-default behavior

The gateway adapter recognizes `MEMMY_TAURI_BROWSER_SURFACE <validated JSON>` from child process and accepts `MEMMY_TAURI_BROWSER_ACTION <validated JSON>` from the Rust-owned parent input stream. Its session identity is stored only after receiving an Agent-authored, schema-valid browser surface and never accepted from renderer arguments. The Agent process's existing `@memmy/local-api-contracts` validator is reused; clipboard, filesystem, computer screen and arbitrary Electron IPC messages are not proxied.

**Important:** This PR is only the controlled transport stage. The opt-in environment variable is NOT set by Rust. The Rust receiver is not included in this PR. Enabling the flag manually before those protections are complete is not supported and can cause other Agent IPC permission requests to be unanswered. No claim of real browser control, native UI E2E, 100% feature parity or production readiness.

## Test plan

- `npm run sidecar:test -w @memmy/tauri-shell` — now includes surface-relay.test.mjs in addition to the existing Agent Gateway/Local API/Memory tests; pending actual connected-worker execution.
- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib` — Rust integration pending on separate worktree.
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/agent-browser-surface.interaction.test.tsx` — frontend integration pending.
- `npm run test:renderer:smoke -w @memmy/tauri-shell` — pending.

## Rollback

Draft PR on top of #47. No auto-enabled Node IPC and no UI changes. Reverting this PR removes the staged transport entirely. Preserve original Electron production rollback until independent review and installed native GUI E2E pass.
