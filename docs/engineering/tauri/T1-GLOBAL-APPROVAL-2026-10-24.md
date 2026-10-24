# T1.03 — Native global approval gate (stacked PR, 2026-10-24)

## Scope

Port five original Electron bridge methods to named Tauri Rust commands:

- `getNativeAppAllowAll` and `setNativeAppAllowAll`
- `getBrowserAllowAll` and `setBrowserAllowAll`
- `onBrowserAllowAllChanged` (real Tauri event subscription/unsubscription)

The existing original React UI, routes, styles, and Electron preload are not changed. Tauri's main window is the only permitted caller for the read/write commands. Pet windows are rejected. Settings preserve the Electron v1 JSON wire format: `{ "version": 1, "enabled": boolean }` and browser state `{ enabled, inherited, effective }`.

**Real Agent propagation:** the managed Tauri Gateway receives the app-controlled `MEMMY_NATIVE_APP_ALLOW_ALL_FILE` path, derived from its `MEMMY_TAURI_DATA_DIR`, rather than trusting a path sent from React. The Agent process also receives this exact derived path; the existing Agent site-permission reader already consults it. Browser global approval uses the Agent's existing `browser-use/allow-all-websites.json` path under the same managed data root.

## Checklist / assignment

- [x] **A3 Implementation:** five renderer bridge methods map to four explicit Rust commands and one emitted Tauri event; backend propagates the real preference file path.
- [x] **A1 Security tests authored:** default-deny, invalid/corrupt versioned JSON, oversized grant files, and symlink replacement protection. Native file writes use the existing bounded private-directory atomic writer. Only the primary Tauri window may invoke approval commands.
- [x] **A2 Agent contract inspection:** `BrowserUseSitePolicyReader` reads `MEMMY_NATIVE_APP_ALLOW_ALL_FILE` and the independently stored website grant file. No blanket grant is written into per-origin rules.
- [x] **A5 Test cases authored:** new Rust tests for explicit consent/inheritance/corruption and a React bridge test for approval event listener, event delivery, and cleanup.
- [ ] **A5 Live build/typecheck:** not executed after this commit because the connected macOS tool tunnel disconnected. **Do not mark passing** until these commands run on a connected runner.
- [ ] **A1 Independent code review:** required for global approvals; this is an authorization-sensitive feature.
- [ ] **A5 Real GUI E2E + full browser/Computer Use:** verify live grant changes, revocation, effective permissions, browser denial, and no bypass on malformed files. Native Computer Use driver is still not certified.
- [ ] **LEAD Release signoff:** blocked by the remaining bridge methods and broad desktop/browser/Computer Use E2E; `releaseReady=false`.

## Required acceptance commands

```sh
node scripts/engineering/tauri-parity.mjs --check
cargo fmt --check --manifest-path App/shell/tauri/src-tauri/Cargo.toml
cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml
npm run typecheck -w @memmy/frontend-desktop
npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/browser-use-site-policies.interaction.test.tsx src/pages/tests/computer-use-settings.interaction.test.tsx
npm --prefix App/memmy-agent exec -- vitest run tests/core/agent-runtime/tools/browser-use-site-policy-store.test.ts
```

## Shipping restrictions

This is a **draft, staged source change**, not a built application or proof of E2E parity. Enabling allow-all is security-sensitive; consent may only originate from a deliberate authenticated user decision on the main desktop UI. A compromised renderer or an incomplete desktop approval flow remains a known risk until CSP, native permission policy, Computer Use implementation and real GUI testing are signed off. Do not merge or release until independent A1/A5 gates are complete. The original Electron release is untouched.
