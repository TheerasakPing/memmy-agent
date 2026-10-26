# R7 macOS white/blank startup fix & cleanup (2026-10-26)

## Checklist / review

| Task | Evidence / status |
|---|---|
| Audit installed DMG vs signed bundle, services, duplicate app registrations | Confirmed both `/Applications` and `~/Applications` contained Preview apps sharing the same bundle identifier. Separate runtime service smoke was not a guarantee of GUI readiness. |
| Verify bundled WebView bootstrap with opt-in, privacy-safe diagnostics | WebView `Started`/`Finished`, bridge present, React root created; renderer performance marks showed a ready route at ~7–8 seconds on actual installed build. No renderer content or tokens logged. |
| Eliminate white-looking route restoration | Tauri no longer uses Electron's nearly blank quiet startup on restored routes. A visible progress screen renders while startup is running. |
| Bound hung startup state | React app now transitions to a visible recoverable startup error after 30 seconds if bootstrap has not settled; React effect cleanup cancels the timer. |
| Force fresh embedded frontend & native bundle | Frontend Vite build + Cargo release `--features custom-protocol` with `cargo clean --release -p memmy-turbo-tauri`; bundled signed arm64 app smoke for Memory/Backend/Gateway. |
| Tests | Focused Vitest 75/75, Backend sidecar 4/4, TypeScript check, git diff check. |
| Installed Preview live check | Local API `/api/health` and `/api/app/bootstrap` HTTP 200; `th-TH` saved in SQLite; `PRAGMA quick_check=ok`; native performance marks observed `renderer-module-loaded`, `renderer-first-dom-frame`, `route-ready-first-frame`. |
| Package deliverable | `~/Downloads/Memmy-Turbo-Preview-1.2.5-alpha.3-macOS-arm64-R7-FIX-20261026.dmg`; `hdiutil verify` passed; mounted app's executable SHA-256 matched `/Applications/Memmy Turbo Preview.app`; App Signature check passed. |
| Temporary build cleanup | Deleted 8 obsolete 2+ GB `packaging/out-*` candidate directories, one extra DMG staging copy, Python test cache, temporary console logs, old broken DMG and old visible duplicate Preview installation. Reclaimed ~22 GiB of `/Volumes/Data` logical used space at cleanup time. |
| Safety | Original Electron profile and its memory SQLite unchanged; Preview data retained; one hidden rollback app retained under `/Applications/.Memmy-Turbo-Preview-before-visible-startup-fix-20261026.app`. |
| Native visual confirmation | **Outstanding**: macOS Screen Recording restrictions prevent screenshot/click based WKWebView visual signoff. Loading and ready route are instrumented, but production-grade GUI acceptance still requires user/human visual check. |

**Root cause / symptom:** In a restored-route launch, the app selected an intentionally minimal `StartupScreen quiet` UI while the native services were starting, visually appearing like an empty/white window. The installer previously verified runtime services but did not assert a first ready React route. The new build makes the loading stage visible, times out recoverably, and avoids conflicting visible Preview installations. A separate process/filename race was suspected during first seconds of startup; follow-up read showed the runtime config appeared once services were ready, so it is *not* asserted as an independently confirmed bug.

## Release caveat

This build is ad-hoc signed for internal Preview. It is **not** Apple notarized, independently reviewed, or a completed 24-hour soak/Agent E2E certification. R7 remains a draft PR awaiting review before merging to `main`.
