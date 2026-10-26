# Memmy Turbo R7: Database upgrade and WebKit renderer QA — 2026-10-26

**Release gate:** PARTIAL / independent reviewer still required. Worktree: `codex/tauri-v2-macos-original-db-install-20261025`; do not merge unrelated dirty changes or generated dependencies.

## Task allocation, review and checklist

| ID | Implementing role | QA scope | Lead / reviewer status |
|---|---|---|---|
| R7-DB-01 | Database migration role | pre-Thai DB upgrade, count and value preservation, schema integrity, idempotency, compiler | Lead reviewed test intent and output; independent review pending |
| R7-UI-01 | Frontend/QA role | Chromium and WebKit renderer routes, Tauri JS IPC mapping | Lead reviewed script and output; actual installed WKWebView remains unverified |
| R7-AGENT-01 | Agent runtime role | Backend startup retry/session credential integrity smoke | 3/3 tests passed; independent review pending |

- [x] Fix migration-count test previously asserting 35 after Thai migration `0031` brought expected count to 36. Test now checks idempotent migration count.
- [x] Add regression test to build a legacy profile without migration `0031`, retain dark theme, BYOK mode and Memory token limits, apply the migration, verify all settings are byte-for-byte equivalent, then update to `th-TH`; verify `PRAGMA integrity_check` and `PRAGMA foreign_key_check` and rerun migration idempotently.
- [x] Upgrade UI renderer smoke script so `MEMMY_RENDERER_BROWSER=webkit` runs Playwright WebKit as well as the existing Chromium mode. Use `MEMMY_WEBKIT_EXECUTABLE` only for local browser revision mismatch (no path hard-coded in source).
- [x] WebKit renderer smoke: startup, nickname, Memory plugin conflict, and Tauri IPC checks pass.
- [x] Chromium renderer smoke: same three views + Tauri IPC checks pass.
- [x] Combined six focused Vitest files: 141/141 tests passed; three Backend sidecar Node smoke tests passed; Backend TypeScript compilation passed; `git diff --check` passed.
- [ ] Native WKWebView GUI interaction, menus, complete Thai Settings and dark-mode visual audit. macOS Accessibility/screenshot capture denied (`screencapture -l` failed); browser WebKit smoke is not this gate.
- [ ] Full Agent/model interaction, Original parity, concurrent session stress/soak, Windows/Linux installation, notarization, and human independent reviewer signoff.

## Running the checks

```sh
npm exec -- vitest run App/backend/src/infrastructure/app-state-store/tests/index.test.ts --no-file-parallelism
MEMMY_RENDERER_BROWSER=chromium node scripts/engineering/tauri-renderer-smoke.mjs
MEMMY_RENDERER_BROWSER=webkit MEMMY_WEBKIT_EXECUTABLE=/path/to/installed/pw_run.sh node scripts/engineering/tauri-renderer-smoke.mjs
node --test App/shell/tauri/sidecar/backend.test.mjs
```

## Safety

No Original Electron profile or original SQLite database was changed for this QA work. Test databases use temporary directories. The installed Preview app is not replaced by this specific QA/testing change; the last installed Preview was verified earlier with `th-TH` and HTTP 200.
