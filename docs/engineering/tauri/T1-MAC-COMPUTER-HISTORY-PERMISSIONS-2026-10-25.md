# T1 — macOS Computer History permissions: native Settings guide and restart (70/85)

## Checklist planner and delegated review gates

- [x] **A1 source audit** — inspected Electron `guideMemmySystemPermission` and `restartForComputerHistoryPermissions` and corresponding React Computer History/WeChat permission flows. Original Electron shows a separate helper-driven panel and runs process cleanup before relaunch.
- [x] **A6 native implementation** — Tauri `desktop_guide_memmy_permission` opens only the three hardcoded macOS System Settings privacy panes: Accessibility, Input Monitoring, Screen Recording. Rejects unapproved permission strings and any non-main WebView caller. Returns `true` only if the OS launches the pane; this does NOT imply access was granted.
- [x] **A6 native restart** — user-initiated `desktop_restart_for_computer_history_permissions` requires first-party `main` WebView and macOS; Rust supervisor stops managed Gateway, backend and Memory children before invoking Tauri's real native process restart. It is not a fake renderer reload.
- [x] **A3 React contract** — original React Computer History guide and WeChat confirmation UI unchanged, method names and optional semantics maintained in the Tauri bridge; Electron preload and existing CSS/routes remain untouched.
- [x] **A4 security test** — Rust rejects arbitrary URLs, fake permission names, shell injection attempts, unsupported permission labels; validates exact hardcoded macOS Privacy deep links. No renderer-supplied executable, command arguments or arbitrary external scheme.
- [x] **A5 Rust automated** — 47/47 Rust unit tests pass; `cargo check --locked` PASS; Rust format PASS.
- [x] **A5 React automated** — 47/47 Tauri bridge, Computer History Guide and WeChat permission interaction tests PASS; TypeScript incremental check exit 0.
- [x] **A5 Parity scanner** — original 14 React routes unchanged; **70/85 native method bridges, 15 unmigrated**.
- [ ] **A5 installed macOS native GUI E2E** — verify System Settings selection, TCC permission refresh/revocation, user-requested restart and preservation of agents/sessions. This test intentionally does not execute a real OS restart in Rust unit tests.
- [ ] **A5 Windows 11 x64 and Linux installer E2E** — cross-platform OS permissions are not implemented for this macOS-only API, non-macOS requests reject/return false as appropriate.
- [ ] **A4 independent human security review** — validate process termination and restart semantics, race conditions, user permissions and bundles.
- [ ] **LEAD release signoff** — blocked on 15 remaining methods, native Browser and Agent context parity, cross-platform GUI tests and signing. Keep releaseReady=false.

## Behavioral boundaries and safety

The original Electron host uses a helper-driven permission guide that polls TCC states while Settings remains open. In Tauri the existing React permission dialog continues to run status checks via the Agent client; Rust opens the exact OS pane but does not recreate Electron's separate native helper panel or automatically mark consent as granted. Return `true` means Settings launch succeeded, NOT that Screen Recording/Accessibility was approved.

The restart command must only be called after the existing React flow confirms the user's permission change. The native Rust command guards main-WebView and macOS and stops managed services before relaunching the application process. Real-world app restart behavior, signed macOS `.app` identity, TCC prompts, state persistence and safety are not certified until installed GUI E2E.

## Verification commands

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib`: 47/47 PASS
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`: PASS
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/computer-history-permission-guide.interaction.test.tsx src/pages/tests/computer-history-wechat-confirmation.interaction.test.tsx`: 47/47 PASS
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r50.tsbuildinfo`: PASS
- `node scripts/engineering/tauri-parity.mjs --check`: 70/85, 14 routes

## Rollback

Stacked Draft PR on #52. No Electron preload modification or automatic permission granting. Maintain original production Electron rollback until independent human review and bundled/native GUI acceptance.
