# Memmy Turbo R7 — Native Restart/Leak Smoke (2026-10-26)

**Release status:** partial QA evidence; NOT a production signoff or a true crash/24-hour soak test.

## Assignment and checklist

- Lead: coordinate R7 startup-resilience scope; preserve Original Electron and live databases; review observed smoke results.
- Runtime workstream: author `App/shell/tauri/packaging/smoke-native-runtime-restarts.mjs` for repeated isolated supervisor runs.
- QA workstream: run 5 consecutive native-runtime restarts with the installed signed Preview; enhance script with packaged-process survivor detection; run 3 additional restarts; read-only verify installed Preview endpoints and DB.
- Reviewer: independent human approval remains **PENDING**. This report is author-run QA and is not an independent review.

| Requirement | Result | Evidence |
|---|---|---|
| [x] Run isolated Memory + Local API + Agent Gateway start and clean stop, five sequential runs | PASS (5/5) | elapsed times 5731, 4335, 4277, 4193, 4200 ms; median 4277 ms |
| [x] Retest with surviving PID / child-process and temporary-profile leak detection | PASS (3/3) | 4968, 4349, 4163 ms; median 4349 ms; zero observed surviving *new* bundled processes and temporary profiles |
| [x] Isolated Backend sudden crash / restart | PASS | SIGKILL leaves stale credential, second start succeeds, old token denied (401), new token accepted (200), clean shutdown removes new credential; Node Backend tests 4/4 |
| [x] Installed Preview booted and remained open | PASS | main native process found; read-only health checks below |
| [x] Installed Local API `GET /api/health`, `GET /api/app/bootstrap`, `GET /api/agent-sources` | HTTP 200 for all | loopback-only request; no bearer tokens written to logs |
| [x] Thai / BYOK persistence and Preview SQLite quick-check | PASS | bootstrap language `th-TH`, userMode `byok`, Preview SQLite quick_check = `ok` |
| [x] Original profile modification check | Original app.sqlite and Memory SQLite sizes/mtime unchanged relative to recorded previous baseline | 8,007,680 bytes / 1,778,192,384 bytes; this smoke uses ephemeral temporary data directories |
| [x] Native WebKit browser renderer smoke and app-state migration tests | PASS (previous R7 QA) | see `memmy-turbo-r7-db-upgrade-and-webkit-smoke-2026-10-26.md` |
| [ ] Entire native supervisor force-kill/power loss, sleep/wake, multi-session/Agent job recovery | Not tested | Only the isolated Local API child was SIGKILL-tested; other failure modes require separate recovery scenarios and non-duplicating action verification |
| [ ] macOS embedded WKWebView GUI interactions / human approval | Blocked | Screen Recording / Accessibility permission unavailable to connected worker; browser WebKit is not native WKWebView |
| [ ] Windows/Linux, signed notarized production installers, CI / independent review | Not tested | R7/R8 release gates remain open |

## How to rerun (without modifying live profiles)

```
node App/shell/tauri/packaging/smoke-native-runtime-restarts.mjs "$HOME/Applications/Memmy Turbo Preview.app/Contents/MacOS/memmy-turbo-tauri" 5
```

The script invokes the installed Rust `--smoke-native-runtime` mode, which creates a fresh `memmy-standalone-smoke-<uuid>` directory per run. The smoke verifies readiness of all three processes and cleanup, and checks OS process command paths to avoid confusing them with Original Electron or unrelated Node processes. This is a **supervisor startup/stop duration**, not first interactive paint or cold-start performance. No speed improvement is claimed.

## QA caveats

- Installed Preview remains a developer/ad-hoc signed build, not notarized release.
- All measurements are single-machine samples; they are not comparable to Electron baseline or statistically sufficient for release SLOs.
- Avoid merging source changes alongside unrelated dirty worktree changes without separating commits, revalidating on a clean checkout, and obtaining independent reviewer signoff.
