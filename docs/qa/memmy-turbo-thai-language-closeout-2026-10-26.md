# Memmy Turbo macOS — Thai Settings / Locale Closeout (2026-10-26)

## Objective
Enable `th-TH` in Settings and all compact entry-screen language controls, preserve the preference across app restarts, and avoid changing the Electron Original profile.

## Coordinator checklist / independent checks
- [x] **UI workstream:** Settings exposes Thai; Login, Welcome, Token Detail cycle `zh-CN -> en-US -> th-TH -> zh-CN`; labels and aria-labels identify the next language.
- [x] **Localization workstream:** Thai message-key parity and placeholders validated against English catalogs.
- [x] **API workstream:** `th-TH` accepted by installed API contract and PATCH `/api/app/settings`; cached language is reflected by GET `/api/app/bootstrap`.
- [x] **Persistence workstream:** migration `0031-thai-app-language.sql` preserves all existing app-state columns; a WAL-safe Preview DB backup was taken before applying it. SQLite integrity verified.
- [x] **Reliability workstream:** Backend's Memory reload failure cannot silently roll back a valid UI language preference; old Backend shutdown does not remove a newer process's runtime-config token.
- [x] **Build/packaging workstream:** Frontend TypeScript check, React/Vite release, Rust Tauri `custom-protocol` release, Memory + Backend + Gateway native-runtime smoke, package signature check.
- [x] **Regression workstream:** Vitest 127/127 on relevant UI/Backend/Auth areas; additional Node sidecar tests 3/3 including replacement-instance credential safety; Chromium renderer smoke passes 3 screens + IPC mapping.
- [x] **Live-service E2E:** installed Preview switches `th-TH -> en-US -> th-TH`; resulting SQLite and API bootstrap both report `th-TH` after a clean restart.
- [ ] **Manual macOS WebKit GUI E2E:** inspect all Thai screens and interactive selection through the actual WebView (Accessibility permission denied by macOS in connected worker). This is a release acceptance dependency, not covered by Chromium.
- [ ] **Independent reviewer / production approval:** not obtained; Preview is an ad-hoc-signed developer build, not a notarized production release.

## Safety and scope
- Original Electron `/Applications/Memmy.app` and Original live SQLite profiles are unchanged.
- Only `~/Applications/Memmy Turbo Preview.app` and its isolated Preview profile were touched.
- Earlier Preview app and `app-state.before-thai-language-migration-20261026.sqlite` backups are retained for rollback.
- No claim of complete Original-feature parity or production readiness is made by this checklist.
