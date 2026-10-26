# T2 — Native external Agent Tool prompt handoff (79/85)

## Checklist planner / delegated lanes

- [x] **A1 Source Audit** — original Electron main uses `normalizeAgentToolLaunchRequest`, app-specific `cursor://`, `claude://`, `codex://`, `opencode://`, `workbuddy://` links and registered CLI fallback for Cursor Agent, Codex, Claude Code, OpenCode, OpenClaw and Hermes. React Onboarding and Home Page call original Promise `{opened:boolean}`.
- [x] **A2 native Rust implementation** — first-party Tauri `main` WebView only, `desktop_open_agent_tool(source_id,prompt)` validates seven allowed source IDs and bounded nonempty UTF-8 prompt, emits only predefined schemes/paths, tries a macOS LaunchServices link, falls back to installed fixed-location agent executable running inside Terminal via AppleScript with separate argv. No generic renderer-provided executable or shell command, and never returns `opened:true` when no handoff mechanism accepts the request.
- [x] **A3 original React** — `openAgentTool(sourceId,prompt)` now calls the real named Rust command with unchanged `{opened:boolean}` Promise and no changes to Onboarding/Home buttons, styles or the original 14 routes.
- [x] **A4 security** — reject unsupported source IDs, empty/malformed/oversize prompts (8192 bytes max), invalid control sequences, URLs over 24 KiB, and arbitrary custom URI schemes. GUI URL uses percent encoding. Terminal AppleScript follows the original Electron quoted-form-of-arguments scripts and receives executable/prompt as separate argument values; only fixed binary candidate locations and fixed `/usr/bin/open`/`/usr/bin/osascript` are invoked. Launch attempts time out; no escalation or generic command runner.
- [x] **A5 Tauri parity scan** — 79/85 bridged original methods, 14 routes unchanged.
- [x] **A5 React targeted** — `src/tests/tauri-bridge.test.ts` 8/8 PASS; native `openAgentTool` invokes named Rust method. TypeScript project check exit 0.
- [x] **A5 renderer smoke / packaging** — original React smoke 3/3 PASS; bundle audit security regression 6/6 PASS. Original staged macOS ARM64 preview was built and audited on PR #61 (this code must be rebuilt into next installer).
- [x] **A5 Rust automated** — initial Rust library 65/65 PASS, then final Agent-specific 4/4 PASS after process cleanup change. Rust cargo check --locked and cargo fmt --check PASS. Covered source allowlist, malformed/oversized prompts, percent encoding, binary candidate paths and AppleScript quoting; external user applications were not launched.
- [ ] **A5 real GUI/CLI E2E** — launching external applications with actual user permission/installed binaries and confirming the app received prompt; tests must not open user applications automatically without the user choosing to test that behavior.
- [ ] **Windows 11 x64/Linux parity** — this port currently fails closed (`opened:false`) outside macOS; separate LaunchServices/registry/desktop-entry handoffs and installer tests still needed.
- [ ] **A4 independent human review** — URL scheme ownership, Terminal Automation permissions, executable substitutions, unicode and shell argument handling.
- [ ] **LEAD production gate** — blocked on six remaining preload methods (updater download/progress/installer, selective Browser Data Clear, extension drag, browser tab mention), same native WebKit vs Agent Playwright Computer Use context, Windows/Linux packaging and native installed GUI E2E. `releaseReady=false`.

## Important behavioral limitations

Returning `opened:true` means the system accepted the deep link or Terminal AppleScript launch, not that the external Agent has completed the requested task. GUI deep links can be unhandled on machines with no registered application; the Rust command reports `opened:false` after fallback also fails. OpenClaw's original optional dashboard/session-specific UI creation is not yet replicated; an installed OpenClaw CLI can instead be launched using its original `tui --message` fallback. The native Tauri `openAgentTool` method is counted by the parity scanner but this is **not universal cross-platform/full variant acceptance**.

## Verification

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib`
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts`
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r50.tsbuildinfo`
- `npm run test:renderer:smoke -w @memmy/tauri-shell`
- `node scripts/engineering/tauri-parity.mjs --check`

## Rollback

Stacked Draft PR on #61; Electron preload untouched; original React UI unchanged. Do not merge to production main before native GUI E2E, independent review and cross-platform acceptance.
