# T2 — Tauri v2 Native Managed Memory CLI Installer (78/85) — 2026-10-25

## Checklist Planner — A1 / A2 / A3 / A4 / A5 / LEAD

- [x] **A1 Source Audit:** Electron `installCliTools()` installs real `memmy-memory` under `~/.local/bin`, updates `.zshrc`/`.bash_profile` idempotently; packaged Tauri runtime owns its own private `node` and compiled `Memory/dist/src/cli/index.js`. Existing React Memory Sources reinstallation button expects `{ok,binDirectory,installed,pathUpdated,profilePaths}`.
- [x] **A2 Rust Native:** new `desktop_install_cli_tools` command restricted to first-party `main` WebView. On macOS/Linux it verifies an actual packaged, non-symlink bundled `runtime/node` executable and `runtime/Memory/dist/src/cli/index.js`, then installs a real executable launcher at `~/.local/bin/memmy-memory` calling the **bundled Node executable directly**, without relying on Finder's incomplete PATH. Writes atomically with user-only permissions, preflights both shell profiles before install and updates PATH with the exact fixed shell line if missing.
- [x] **A3 React:** existing `installCliTools()` API now invokes that real native command; original React button, results, warning UI, all 14 routes and Electron fallback unchanged.
- [x] **A4 Security:** rejects broken/missing Node and compiled CLI, dangerous symbolic links, non-file launch targets, replacing unrelated pre-existing commands, unsafe shell profiles, oversize profile data and paths containing control characters. Quotes real resource paths as shell literals, never executes a shell string from renderer. No root/elevation or arbitrary package downloads.
- [x] **A5 Rust:** `cargo test --locked ... --lib` **61/61 PASS**. Four new CLI tests cover idempotent installation, safe profile preservation and symlink refusal, runtime shell quoting (including a literal apostrophe), and **actual executing installed wrapper** without any `node` in the shell PATH. `cargo check --locked` PASS, Rust formatting PASS.
- [x] **A5 React:** Tauri bridge + Memory Sources health tests **18/18 PASS**; frontend `tsc -p ... --noEmit` PASS.
- [x] **A5 Smoke/Audit:** Chromium renderer smoke **3/3 PASS**; packaging audit **3/3 PASS**, extended to reject bundles lacking compiled Memory CLI entrypoint; parity scanner **78/85**, original React routes **14**.
- [ ] **A5 Actual macOS installed `.app` UI:** cannot test this feature from the checkout alone because `App/shell/tauri/packaging/runtime/node` and a signed complete packaged app have NOT been staged. Native packaged path, Finder -> CLI process path and terminal invocation require E2E.
- [ ] **A5 Windows 11 x64 native CLI parity:** explicitly unsupported in Rust until bundled and verified Windows `.cmd` launchers and per-user PATH registration are available. The original Electron Windows install behavior uses a different registry workflow; Rust **fails explicitly**, no false success. Linux needs installed GUI validation.
- [ ] **A4 Independent Security Review:** atomic profile modification permissions, symlink/TOCTOU checks, safe shell quoting and bundled Node authenticity, installer path lifecycle across app updates.
- [ ] **LEAD Release:** blocked: seven more preload contract methods, Native WebKit/Agent Playwright same-tab Computer Use, updater/download installer, signed cross-platform app, native GUI and review. `releaseReady=false`.

## Behavior contract / important caveat

This installs only the real **memmy-memory** CLI on supported POSIX packaged builds and points it at the Node and compiled JS shipped within the `.app` runtime. It does **not** install a fake executable, rely on a globally installed Node, grant system permissions, mutate user files when the required runtime is missing, or claim Windows native CLI installer parity. Native `installCliTools` is counted as a macOS/Linux implemented bridge method for the local parity scanner; **78/85 is API-surface coverage, not full cross-platform acceptance**.

## Reproduce

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib` — 61 PASS
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml` — PASS
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/memory/tests/sources-sub-page-health.interaction.test.tsx` — 18 PASS
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r50.tsbuildinfo` — PASS
- `npm run test:renderer:smoke -w @memmy/tauri-shell` — 3 PASS (Chromium preview, not installed WebKit)
- `npm run bundle:audit:test -w @memmy/tauri-shell` — 3 PASS
- `node scripts/engineering/tauri-parity.mjs --check` — 78/85, 14 routes

## Rollback

Stacked Draft PR based on PR #59. No Electron preload changes or real user HOME changes during tests. Keep production `main` unchanged until native GUI E2E, Windows CLI parity and independent security review.
