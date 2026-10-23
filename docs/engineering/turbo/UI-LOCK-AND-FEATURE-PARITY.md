# UI Freeze and 100% Existing Feature Parity

**Contract:** All old visuals and old user-visible operations remain unchanged by default. Backend-only additions are feature-flag OFF until individually accepted. Do not alter visuals to copy competitor products.

## Exact source freeze map (baseline 74b26fc78ebd14a784981ba8e83bebf878c20865)
- App/frontend/desktop/src/theme/tokens.css — color, sizing, typography; do not change.
- App/frontend/desktop/src/styles.css — global appearance; do not change.
- App/frontend/desktop/src/app/routes.ts and app/router.tsx — route IDs/navigation; do not change.
- App/frontend/desktop/src/pages/settings-nav.ts — tab ordering; do not change.
- App/frontend/desktop/src/pages/memory-page.tsx and pages/memory/* — history, memory UX; protect.
- App/frontend/desktop/src/pages/home-page.tsx, agent-thread-panel.tsx, pet-page.tsx, browser-panel.tsx, settings-page.tsx — core user journeys; protect.
- App/shell/desktop/**/* — native window behavior/permissions/startup; preserve.

## Baseline snapshot checklist
Capture reproducible images at pinned commit for macOS arm64 and Windows 11 x64 (same fonts, scale, window size, language, and seeded test data):
- [ ] Onboarding / Sign-in / BYOK
- [ ] Home / Memory / Search / Memory Sources
- [ ] Agent Chat / History / Tool confirmation
- [ ] Browser / Computer Use / Permissions
- [ ] Pet mode and tray / notification lifecycle
- [ ] Settings / Models / Tokens
- [ ] Install / Upgrade / Restart / Recovery / Uninstall flows

Compare screenshots at identical viewport/device DPR using pixel-level diff plus manual review of platform-native differences. UI changes require **explicit product approval**; zero intentional diff is the default.

## Functional parity matrix
For each legacy feature: old baseline test → same test after each feature or Rust flag change → real packaged smoke on the relevant OS. Cover backend API response compatibility, old DB migrations, source hook installs, no double-turn capture, auth and namespace behavior, token secrets, browser download/permissions, notifications, update handling, local startup and Linux CLI/TUI.

## Compatibility policy
- Keep existing HTTP routes and request/response payloads, response ordering where consumers rely on it, persisted data contracts and fallbacks.
- New advanced-memory views may be introduced later ONLY via separately approved UI change; Phase 1 feature additions are headless/API-backed and opt-in.
- Never overwrite user memory during test or migration; restore backups, then verify old version can read its own compatible database. A one-way migration requires explicit migration/rollback design and approval.
- If the same scenario passes only with Turbo OFF, Turbo stays OFF for release. A test not run is BLOCKED, not PASS.
