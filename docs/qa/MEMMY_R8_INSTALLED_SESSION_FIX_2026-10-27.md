# Memmy Turbo R8 — Installed Session-Fix Acceptance (2026-10-27)

**Status:** macOS Preview installation and focused reliability checks PASS. **R8 Production NOT approved.** GitHub Actions deliberately skipped.

## Checklist, work ownership and lead review

| Item / QA role | Observed result | Status |
|---|---|---|
| Session developer | Fixed duplicate temporary-file name for overlapping asynchronous Session saves, stale async overwrite after synchronous save, and hard-delete resurrection | Complete in commit `386aee1d` |
| QA / tests | 172/172 focused tests across Session/MCP/Skills; 10/10 repetitions of concurrency suite; TypeScript compilation passed | PASS |
| Packaging / reviewer | DMG `Memmy-Turbo-Preview-R8-SessionFix-20261027-macOS-arm64.dmg` mounted, checksum verified, app signature valid, compiled installed `SessionManager` contains revision fencing | PASS |
| Safe install / reviewer | Saved a SQLite app-state backup with `PRAGMA quick_check=ok` and `th-TH`, preserved rollback app, stopped running Preview, copied signed DMG build into `/Applications/Memmy Turbo Preview.app` | PASS |
| Local API | After Finder launch, `GET /api/health`, `GET /api/app/bootstrap`, and `GET /api/agent-sources` all returned HTTP 200; `th-TH` persisted; app-state SQLite integrity OK | PASS |
| Packaged Session data integrity | Tested *installed* runtime module on an isolated temporary profile: 24 parallel same-chat writes, 20 concurrent pending saves followed by hard deletion, sync vs async last-write ordering, and no leftover temp files | PASS |
| Native startup / shutdown | Five additional installed supervisor `--smoke-native-runtime` cycles: zero failures, median 4870ms, p95 5821ms, no observed leak conditions, ~45 seconds elapsed | PASS, short smoke only |
| Native GUI | Actual Memmy window 1200x780 detected; Screen Recording/Accessibility still false for connected macOS worker | BLOCKED: native GUI user-visible interactions not tested |
| Live model / full Session/MCP/Skill E2E | Real-model API reply and model-chosen tool invocation not certified | OPEN |
| 24-hour heavy load soak | Not run; short isolated startup/stop smoke is not a 24-hour soak | OPEN |
| Independent approval and main merge | PR #76 is Draft, independent reviewer not signed off | OPEN |

## Safety and rollback

- Installed Preview prior to R8 backed up as `/Applications/.Memmy-Turbo-Preview-before-r8-sessionfix-20261027.app`.
- Preview SQLite snapshot (600 permissions) at `~/Library/Application Support/com.theerasakping.memmy.turbo.preview/app-state.before-r8-sessionfix-20261027.sqlite`; SQLite `quick_check=ok`.
- Memmy Original user profile/database was not modified. Preview app-state retained the previous language `th-TH`.
- The 607 MB R8 DMG is retained in Downloads for installation, but is ad-hoc signed and not notarized.
- All test Session writes used independent temp profiles. No live provider credentials or message content were included in this report.

## Next gates

1. Validate Agent's real answer and resumed Session for every available configured model with authorized on-device access.
2. Validate model-directed MCP and Skills and actual GUI 14-route acceptance once macOS accessibility permission is usable.
3. Conduct full 24-hour heavy Agent + supervisor soak on a dedicated Mac, with sanitized reports and independent reviewer approval.
