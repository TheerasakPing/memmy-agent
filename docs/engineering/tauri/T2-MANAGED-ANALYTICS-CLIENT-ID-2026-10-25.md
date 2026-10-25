# T2 — Managed Tauri Analytics Client ID bridge (71/85)

## Checklist planner / role-based acceptance

- [x] **A1 Source audit** — Electron `sendAnalyticsClientId` stores the GA4 gtag-reported client ID for the Agent CLI reader, and caches edition/environment for app-exit telemetry. Tauri Gateway sets `MEMMY_HOME` to Rust-managed app-local data directory; the original React gtag SDK reports `clientId`, `appEnv` and `appEdition`.
- [x] **A6 implementation** — native Rust `desktop_send_analytics_client_id` writes the bounded GA4 ID into exactly `app.path().app_local_data_dir()/analytics-client-id`, matching the managed Agent's MEMMY_HOME path. Writes replace the previous ID atomically using a temporary 0600 file where supported, never follows symlinks, never trusts a renderer-provided filesystem path and never sends analytics by itself.
- [x] **A3 React contract** — keeps the original `sendAnalyticsClientId` fire-and-forget desktop API. Failed OS persistence is logged, not presented as success; untouched React gtag initialization, other UI pages and 14 routes.
- [x] **A4 negative tests** — reject empty, oversized, injected newline, path separators, unsupported environment/edition and symlink destination. Main WebView alone may invoke Rust.
- [x] **A5 automated unit/contract checks** — Rust 49/49 PASS including two new persistence/security tests; React desktop bridge/permissions 47/47 PASS; Rust check and TypeScript check and parity scanner run separately.
- [ ] **A5 installed native GUI E2E** — demonstrate a real consented gtag session updates the same isolated managed Agent's client ID and CLI reads the latest value; app_exit telemetry parity still incomplete.
- [ ] **A4 independent human review** — verify GA4 privacy/consent, app-local data sharing, symlink parent race and original legacy ~/.memmy interoperability.
- [ ] **LEAD final approval** — BLOCKED. 14 original bridge methods remain and native GUI/production release gates still unmet.

## Behavioral notes

The Electron desktop previously wrote ~/.memmy/analytics-client-id. Tauri's managed Gateway sets MEMMY_HOME to its isolated app-local data root, so its Agent CLI can read the new native writer's file. This does not change the user's legacy ~/.memmy file, and does not yet implement Electron main-process app_exit analytics scheduling. The original renderer maintains an in-memory analytics client ID for cloud UI events. No new network transmission occurs from this Rust command.

## Verification commands

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib`: 49/49 PASS
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`: PASS
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/computer-history-permission-guide.interaction.test.tsx src/pages/tests/computer-history-wechat-confirmation.interaction.test.tsx`: 47/47 PASS
- `node scripts/engineering/tauri-parity.mjs --check`: 71/85, 14 original React routes
- TypeScript/renderer smoke outcomes are separately recorded at the PR once complete.

## Rollback

Stacked draft PR on #53, no original Electron preload/CSS changes, no user-initiated new telemetry categories and no implicit production merge.
