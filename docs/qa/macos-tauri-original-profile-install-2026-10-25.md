# Memmy Turbo Tauri v2 — macOS Original Coexistence Acceptance

Date: 2026-10-25. Platform: macOS arm64. Branch: `codex/tauri-v2-macos-original-db-install-20261025`.

## Checklist planner / independent review gates

- [x] Source audit: Original app bundle and databases exist separately from Tauri Preview.
- [x] DB compatibility: `app-state.sqlite` and `memory.sqlite` import from Original using read-only SQLite backup; isolated target files, no shared live writes.
- [x] Snapshot data integrity: SQLite `quick_check(1)` returns `ok` on both Preview databases; files mode `0600`.
- [x] Migration regression: WAL-aware copy, Source unchanged, no-overwrite checks.
- [x] Rust NativeRuntime smoke: packaged Memory, Local API, Agent Gateway start/stop in temporary HOME (no real-profile modification).
- [x] React/bridge smoke: 3 preview screens with IPC mappings in Chromium test (not native WebKit E2E).
- [ ] Signed/adhoc bundled app explicitly built with Tauri CLI and embedded frontend assets.
- [ ] Installed app GUI runtime smoke under macOS WebKit, including React root and backend startup.
- [ ] Install verified alongside `/Applications/Memmy.app` with distinct bundle identifier and profile.
- [ ] Mounted DMG test and notarized production distribution (only if signing identity / Apple Notary credentials available).
- [ ] Independent final reviewer approval: pending.

## Role-based ownership

- Source & Data workstream: compare Original vs Preview paths, migration safety, SQLite snapshot checks.
- Build & Packaging workstream: use `tauri build` (not plain `cargo build`) to embed React assets; verify codesign and bundle resources.
- QA workstream: unit, native service smoke, app GUI E2E and rollback drill.
- Lead review: reject release if either actual GUI or DB preservation has not been proven.

## Supported coexistence semantics

Original: `/Applications/Memmy.app` and its existing data in `~/Library/Application Support/Memmy/` and `~/.memmy/`.

Tauri: `~/Applications/Memmy Turbo Preview.app`, bundle ID `com.theerasakping.memmy.turbo.preview`, isolated Tauri data in `~/Library/Application Support/com.theerasakping.memmy.turbo.preview/`.

Do not symlink the databases across apps, rename Original data, or run two apps with concurrent writes to the same SQLite/WAL files. This is one-time snapshot import, **not** bidirectional live sync. New changes in one edition are not guaranteed to appear automatically in the other.

## Local reproducible checks

```sh
python3 App/shell/tauri/packaging/test-migrate-original-macos.py -v
node --test App/shell/tauri/packaging/test-updater-config.mjs
npm --prefix App/shell/tauri run test:renderer:smoke
# In App/shell/tauri/ (requires bundled runtime already staged):
CI=true MEMMY_LEGAL_CN_BASE_URL=https://memmy.cn MEMMY_LEGAL_INTL_BASE_URL=https://memmy.bot npx --no-install tauri build --debug --bundles app --config packaging/tauri-bundled.conf.json --no-sign
# Then sign with a trusted identity for production; ad-hoc local preview is not notarized.
```

## 2026-10-25 macOS white-screen incident (post-install)

- Confirmed Tauri WebKit page loaded and React root rendered, but it remained on Loading.
- Confirmed both isolated SQLite files pass quick integrity checks.
- Reproduced unresponsive Memory HTTP service after default 5-second worker startup replay against a copy of the existing ~1.7 GB Preview SQLite.
- With a 180-second worker fallback and a 30-second post-health delay, Memory answered authenticated health on the same snapshot in 12 seconds; Agent-source automation remained enabled.
- Implemented a Tauri-owned, config-directory-verified worker startup policy; Original Electron and ordinary Memory CLI behavior remain unchanged.
- Added a bounded Memory health probe to Local API bootstrap so UI can render offline rather than waiting indefinitely for memory; both regression suites pass (2 tests each).
- Confirmed actual installed Runtime spun up Memory + Local API + Gateway and wrote runtime-config.json, prior to the bounded bootstrap patch.
- **Packaging gate**: local ad-hoc signing/strict verification and post-patch installed UI/API startup must pass. This is not a notarized production build.

### Rollback (only if required)

Stop Preview, do not remove the Original app or any SQLite data.
The prior Memory service entrypoint and Bootstrap entrypoint are saved under:
`~/Library/Application Support/com.theerasakping.memmy.turbo.preview/installer-backups/2026-10-25-white-screen-fix/`.
Restore the two JavaScript entrypoints to their matching paths inside Preview bundle, then re-sign the entire app. Keep the app bundle identifier unchanged and never link writable databases between Original and Preview.

## 2026-10-25 Large Legacy Database Incident — Isolated Reproduction

**Observed in the installed Preview:** Rust Supervisor displayed `managed Memory service health timed out`, although Tauri/React launched. An orphaned Preview-only Memory child (PID 73123, PPID 1) held `memory.sqlite.server.lock` after the GUI owner exited; the process ignored a graceful SIGTERM due to an unresponsive event loop and required targeted SIGKILL (only after verifying the exact Preview executable + script paths and parent PID). Original `/Applications/Memmy.app` and `~/.memmy` were untouched. After the orphan exited, Preview successfully started Memory + Local API + Gateway, and `/api/health`, `/api/app/bootstrap`, `/api/agent-sources` returned HTTP 200. This was transient because the worker subsequently starved Memory health.

**Reproduction:** cloned the Preview `memory.sqlite` (approximately 1.7 GB), WAL, and config into an isolated temporary directory using macOS copy-on-write; used a unique port and one-time credentials, and removed the temporary test directory afterward. With automatic workers enabled, Memory health returned 200 early, then stopped responding for over 120 seconds. Instrumentation showed startup entered `reconcileWorkerStartup`, then `previewPolicyEvidenceReconciliation`; even with a limit of 100, that path blocked the main Node event loop. Deferring only that policy check let the remainder of worker tasks intermittently block HTTP. With automatic workers paused on the large clone, `/api/v1/health` returned HTTP 200 every five seconds across a continuous 60-second run (13/13 checks).

**Containment:** when and only when Memory is Rust/Tauri-owned and SQLite exceeds 512 MiB, the automatic background drain is paused. This preserves local Memory reads, memory database content, and all foreground/manual worker API routes, while temporarily withholding automatic reconciliation and queued AI processing until the heavy workers can be moved off the HTTP event loop. Smaller Tauri profiles and Original Electron remain unchanged. This is an operational safety mode, not complete production parity.

**Must-do before production:** isolate Memory worker/reconciliation into a separate process or worker thread (with bounded batches and durable resume), restore auto processing for large profiles, verify multi-minute health/read/write load and E2E GUI, verify app-bundle signature, and review independent QA evidence.
