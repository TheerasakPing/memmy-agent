# Memmy Turbo R8 — Time Zone Consistency (2026-10-27)

**Release gate:** Source changes prepared on a separate branch. **Not yet Mac-verified or approved for production** because the Nexora Tunnel Client was disconnected during this work. GitHub Actions intentionally skipped per user request.

## Root causes confirmed from the source

1. `App/frontend/desktop/src/lib/user-time-zone.ts` reduced IANA names such as `America/New_York` and `Asia/Bangkok` to a **single offset calculated using today's date**. An offset alone loses daylight-saving transitions, causing historical/future time errors.
2. Chat message labels used `userTimeZone()`, but Settings usage/quota timestamps used `Date#getHours()` and memory recall timestamps used unqualified `toLocaleString(language)`. These different time-zone authorities can disagree.
3. The renderer had no clearly visible end-user time-zone preference, forcing reliance on its process/browser system zone.
4. Backend and Agent config normalized IANA timezone IDs to a current UTC offset. That can shift recurring Agent schedules when DST changes.
5. UTC instants must never be rewritten as local wall times in the database. Display conversion belongs at the presentation boundary.

## Changes implemented

- Preserve named IANA identifiers through front-end, Backend config and Agent schedule parsing. Keep fixed UTC offsets valid for existing profiles.
- Centralize display formatting in `formatUserMinute` and reuse it for BYOK usage timestamps; use the same zone for quota and memory recall display.
- Add `Settings → Preferences → Time zone` with `System (automatic)`, `Asia/Bangkok (UTC+07:00)`, `Asia/Shanghai`, `UTC`, `Europe/London`, and `America/New_York`.
- Persist the explicit renderer display preference in Tauri's localStorage, reloading renderer labels on preference change. The preference is **display-only** and intentionally does not silently modify Agent scheduling config.
- Add system zone, selected display zone, effective zone and local-time preview to the renderer diagnostics report. No tokens/user messages are included.
- Extend targeted tests for Bangkok conversion, midnight rollover, New York winter/summer DST, fixed offsets and invalid zones; test Agent/Backend config contract retention.

## Checklist / independent review

- [x] Source audit and root-cause identification: UTC-offset snapshots; inconsistent rendering paths; missing UI override.
- [x] Patch isolated on a timezone-specific Git branch.
- [x] New targeted regression test cases authored.
- [ ] Run Frontend Vitest / TypeScript, Agent TypeScript+Vitest, Backend TypeScript+Vitest on connected Mac.
- [ ] Independent code review (cross-platform Intl behavior and localStorage persistence).
- [ ] Verify macOS host timezone with `date`, `systemsetup -gettimezone` (if permitted), `Intl.DateTimeFormat().resolvedOptions().timeZone`, and SQLite UTC persisted instants.
- [ ] Native WKWebView E2E: select Asia/Bangkok, verify a known UTC time is +7h and date rollover correctly; restart the app; compare chat, memory recall, BYOK Usage, quota and diagnostics.
- [ ] Test UTC+offset compatibility and DST using a supported North American IANA zone.
- [ ] Build and sign Mac app, install with backup, run native smoke, package DMG if tests pass.
- [ ] Validate Agent scheduled tasks separately. Renderer display preference is not a mutation of `agents.defaults.timezone`; to change actual Agent job scheduling, set `agents.defaults.timezone: Asia/Bangkok` in the authorized Agent configuration path.

## Safety

Never alter existing SQLite timestamps or bulk-shift stored historical data. Stored absolute timestamps remain UTC. User timezone affects only rendering; Agent scheduling still follows the configured Agent timezone. Original Electron database and Preview database must be backed up and kept intact. Do not mark the issue closed until the installed Mac app passes real GUI acceptance.
