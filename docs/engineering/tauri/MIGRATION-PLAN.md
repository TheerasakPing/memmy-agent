# Memmy Turbo — Electron → Rust + Tauri v2 + original React UI

**Date:** 2026-10-24
**Baseline:** `TheerasakPing/memmy-agent@74b26fc78ebd14a784981ba8e83bebf878c20865`
**Migration branch:** `codex/tauri-v2-react-parity-bootstrap`
**Existing R1/R2 Security branch:** `codex/r1-r2-security-hardening-20261024` / Draft PR #27 (DO NOT overwrite or silently merge).

## Nonnegotiable behavior

- The application must remain visually and functionally the **same** from the user's perspective: original React source, styles, assets, routes, tabs, menus, hotkeys, tray, pet, embedded browser, computer use, scan, memory and account behavior.
- Rust + Tauri v2 is the **target desktop shell** on macOS arm64, Windows 11 x64 and Linux. No new Electron runtime is to be shipped in a future Tauri release.
- **Never** pass a test by skipping original native features or replacing a working native action with a fake resolved Promise.
- Preserve local data, import settings/token storage securely, and verify upgrade+rollback from v1.2.4 on real native OS test VMs before retiring Electron.
- Existing Electron tests remain a **read-only compatibility baseline** during migration. They do not certify the future Tauri release.

## Source audit facts

- Original React renderer: `App/frontend/desktop/src/main.tsx`, `src/app.tsx`, `src/app/routes.ts`, `src/styles.css`.
- Original desktop shell and IPC: `App/shell/desktop/src/preload/preload.cts`, `App/shell/desktop/src/main`.
- The original renderer has **14 route IDs**. The old `MemmyPreloadApi` has **85 callable methods**, in addition to the `platform` and `osRelease` fields.
- `tauri-parity-manifest.json` is machine-generated from original source + migration bridge; run `node scripts/engineering/tauri-parity.mjs --check`.
- Tauri phase T0 reuses identical React entrypoint/CSS, bundles the original icon, and ports a **limited subset** of 13 bridge methods. This is a **migration scaffold, not feature-complete**. `notifyRendererReady` is a lifecycle noop, which still requires review for equivalence.
- The legacy Electron backend still owns critical local API, agent daemon, memory daemon and complex native integrations. The new Rust runtime refuses to fake service startup; `getRuntimeConfig` fails visibly until a native runtime writes validated loopback credentials in the new app-data directory.
- A new Tauri app identifier intentionally isolates unreviewed data paths; migration of legacy user data **must** be explicit and reversible, never automatic without review.
- Window dimensions use original 1200×780 / minimum 980×640, macOS overlay title bar and icon, but screenshot parity remains **unverified**.

## Phased checklist / Supervisor ownership

| ID | Workstream | Owner | Independent reviewer | QA and acceptance |
|---|---|---|---|---|
| T0.01 | Pin 14 React routes / 85 native bridge methods, immutable baselines | A7 | A5 | LEAD approves manifest diff |
| T0.02 | Create Rust Tauri 2 native host reusing original React entrypoint | A3 | A1 | cargo check/test + React typecheck |
| T0.03 | Preserve app window dimensions/icons/chrome, Mac/Win baseline captures | A6 | A4 | A5 screenshot pixel/layout review |
| T1.01 | Port 85 bridge methods to typed Rust commands/plugins without fake fallbacks | A3 | A1 | A5 each-method E2E parity; all gates green |
| T1.02 | Port native tray/pet/notifications/autostart/window actions | A6 | A4 | A5 native interaction smoke |
| T1.03 | Port embedded browser and computer-use permission/security policies | A1 | A3 | A5 native security + browser automation test |
| T2.01 | Start/stop signed/bundled agent gateway and memory daemon in Rust lifecycle | A2 | A1 | A5 restart/recovery/health checks |
| T2.02 | Preserve data, database, settings and credentials from Electron v1.2.4 with rollback | A2 | A1 | A5 migration+restore+fault injection |
| T2.03 | Integrate R1/R2 scoped Memory fixes from reviewed PR #27 without regressions | A1 | A2 | A5 cross-tenant negative tests |
| T3.01 | Rust-only secure native services and optional retrieval acceleration (after parity) | A2 | A3 | A5 latency/Recall + fallback |
| T4.01 | macOS arm64 / Win11 x64 / Linux build, signed installers, checksums | A6 | A5 | LEAD platform signoff |
| T4.02 | E2E/Smoke 14 routes + 85 methods and update/rollback before removing Electron | A5 | A1 | LEAD release approval |

Roles above are planned assignments; they do **not** assert that independent live agents reviewed or signed off. No self-approval is permitted. Supervisor must require exact SHA, unit/contract/E2E and rollback evidence on each ticket.

## Current T0 engineering state

- [x] Independent worktree/feature branch created; no original React page or CSS rewritten.
- [x] Initial `src-tauri` Cargo project, Tauri configuration, original artwork, capabilities.
- [x] React load-time adapter stays inert in Electron and uses named Rust commands in Tauri.
- [x] Inventory: original routes preserved and bridge gaps explicitly tracked.
- [ ] Complete all 85 bridge methods (currently 13 represented; no parity signoff yet).
- [ ] Implement Tauri-owned service lifecycle and secure runtime token creation (currently deliberately fails closed).
- [ ] Verify native runtime app launch, React screenshot baselines, tabs/buttons functional in Mac + Windows, then Linux.
- [ ] Signed native installers, performance and rollback; independent Security/A5/LEAD signoff.
- [ ] Fully retire Electron from shipping dependency tree **after** every previous item passes.

## Risks and rollback

1. Native browser embedding/webviews, macOS computer-use entitlements, pet tray behavior and update/install workflows differ substantially from Electron; port each separately, no generic shell execution allowed.
2. Electron IPC cannot be emulated merely by showing all buttons. Unsupported Tauri methods must remain blocked and tracked in the manifest.
3. `csp: null` in this early React-compatibility scaffold is a **security hardening blocker** before release. Restrict origins and Tauri capabilities and test Monaco, local API, model network and browser surfaces under enforced CSP.
4. Native backend launch is not implemented yet. A Tauri smoke test must show a user-visible missing-runtime error, **not** a green E2E claim.
5. Signed update and data migration require separate reproducible QA artifacts.
6. Roll back simply by not replacing the shipping Electron binary; this branch does not alter users' data or release channels.

## Commands

```sh
npm ci
node scripts/engineering/tauri-parity.mjs --check
npm run typecheck -w @memmy/frontend-desktop
npm exec -w @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts
cargo check --manifest-path App/shell/tauri/src-tauri/Cargo.toml
cargo test --manifest-path App/shell/tauri/src-tauri/Cargo.toml
# Only after the Rust host and frontend tests pass (native UI runtime still incomplete):
MEMMY_LEGAL_CN_BASE_URL=https://memmy.cn MEMMY_LEGAL_INTL_BASE_URL=https://memmy.bot npm run tauri:dev -w @memmy/tauri-shell
```

## T1 follow-up (Draft PR #30)

- The follow-up retains the original 14 React routes and source layouts.
- 16/85 native bridge methods are now wired, leaving 69 incomplete; native parity remains unapproved.
- Rust folder selection, OS notifications, autostart, persistent installation identity and fullscreen events have been added.
- Node 22 full React suite: **2,624/2,624 tests passed**, after building declared migrations dependencies. Rust 2/2 and bridge 4/4 passed.
- Source contract generator checks TypeScript methods and matching Rust IPC handlers, preventing phantom parity counts.
- Current evidence and release blockers: [T1-OS-PARITY-2026-10-24.md](T1-OS-PARITY-2026-10-24.md).
