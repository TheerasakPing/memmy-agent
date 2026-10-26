# R1 — Live macOS GUI Native Startup (2026-10-26)

## Verified execution

- Rebuilt standalone Tauri v2 Preview from commit `6cb65faa` plus pre-existing independent local workspace modifications; staged bundle audit, native-supervisor smoke, full isolated Memory/Backend/Gateway E2E all `ok=true`.
- Signed ad hoc and verified with strict codesign; installed `~/Applications/Memmy Turbo Preview.app`, rollback at `~/Applications/.memmy-preview-rollback-before-r1-telemetry-20261026.app`.
- The first Finder/LaunchServices run did not inherit `MEMMY_TAURI_PROFILE_STARTUP=1`, so profiler output was absent as expected.
- Restarted **installed executable** directly with `MEMMY_TAURI_PROFILE_STARTUP=1`. Rust recorded phase timing:
  - `runtime_paths_start`: 0 ms
  - `memory_ready`: **1029 ms**
  - `backend_gateway_joined`: **6510 ms**
  - `runtime_ready`: **6510 ms**
- The subsequent span, 5481 ms, reflects the combined latest readiness of Backend/Gateway, not each separate service duration. No attribution of specific bottleneck is justified until split timestamps exist.
- App remained alive 16 seconds; Memory health HTTP 200 `storage.ready=true`, Bootstrap HTTP 200 BYOK, Agent Sources HTTP 200.
- Original DB retained original sizes/mtimes and was never opened for write: Memory 1778192384 bytes / mtime 1792810805, Original app DB 8007680 bytes / mtime 1792806288.

## Open limitations

- React `startup-performance.log` did **not** appear; renderer mark transport requires investigation before claiming UI TTI.
- One real existing Preview profile start is not cold/warm benchmark evidence; run repeated controlled tests after instrumentation is complete.
- Profile staging reused existing app resources and only replaced the native executable, so do not treat frontend build artifact as installed without separately verifying bundled assets.
- Full human UI route E2E, independent review and cross-platform production gates remain open.
