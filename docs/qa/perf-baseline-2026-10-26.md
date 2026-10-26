# R1 Baseline — Initial measurements (2026-10-26)

Status: R1 PARTIAL. QA benchmark executed; Rust instrumentation built/tested but not yet installed in Preview. Independent review, GUI first-paint timings and paired Original test still pending.

## Hardware and context
- macOS 27.2 (26B118), Mac16,10, 16 GiB RAM, 10 logical CPUs.
- Git source baseline `24886a7d` before instrumentation; Preview is independently installed under `~/Applications`.
- Original app and original SQLite paths must never be mutated by this profiling workflow.

## Measured isolated native supervisor startup

- 5/5 runs successful; milliseconds: **9644, 5761, 5387, 4979, 4886**.
- Median **5387 ms**; nearest-rank P95 **9644 ms**, min 4886 ms, max 9644 ms.
- Each round starts all three bundled services with disposable HOME; no production profile writes.
- This **does not** include Finder launch, first React paint, production-sized database or time-to-interactive.
- Cold-to-warm divergence justifies recording per-stage timing before further optimization; not proof of the cause.

## Work completed
- [x] Mac OS/model/RAM/CPU inventory for R1-01 (power mode and snapshot hashes remain unchecked).
- [x] Initial Rust stages for R1-02: runtime-paths start, Memory ready, Backend/Gateway joined and runtime ready, opt-in via `MEMMY_TAURI_PROFILE_STARTUP=1`; no secrets included.
- [x] 5-run reproducible isolated Supervisor benchmark script, machine-readable JSON output.
- [x] Native Rust test subset 8/8 passed.

## Remaining acceptance gates
- [ ] Hardware power mode, truly isolated DB SHA, process-tree unique-memory baseline.
- [ ] Extend timing to actual WebView first paint and React time-to-interactive.
- [ ] Run >=10 warm and >=5 controlled cold and paired Original test, with representative 1.7GB clone.
- [ ] Independent QA reviewer verification of metrics, full GUI smoke and E2E.

## Additional R1 measurement: sustained warm supervisor (10 runs)

- Separate 10-run measured series, all 10 PASS: `4892, 5067, 4726, 4698, 4641, 4635, 4817, 4939, 5097, 6162` milliseconds.
- Median 4817 ms, P95 6162 ms, minimum 4635 ms and maximum 6162 ms (nearest-rank percentile). First run already benefits from warm OS cache due to preceding runs; **not true cold start**.
- Machine on AC power; macOS 27.2, Mac16,10, 16 GiB RAM, 10 logical CPUs.
- Installed Preview at time of sample: ~2142 MiB on disk; 5 Preview child/GUI processes, combined RSS ~239 MiB and aggregate instantaneous CPU ~1.2%. Combined RSS includes shared memory, not unique RAM.
- Frontend Vite build output: 110 CSS/JS assets, 16.77 MiB JS in assets, largest TypeScript worker 6.9 MB and entry index bundle 3.1 MB; not all assets are loaded on startup. Must measure network/WebKit loading before attributing delay.
- SQLite preview read-only schema inspection: 51 application/FTS-related tables and 108 indices. Two schema-metadata queries had <0.01ms maximum of 12 measured runs; **does not measure user memory search latency**.
- Source scripts: `App/shell/tauri/packaging/perf/benchmark-startup.mjs` and `capture-idle.mjs`; machine-readable evidence in `docs/qa/perf-r1-startup-10runs-2026-10-26.json` and `docs/qa/perf-r1-idle-2026-10-26.json`.
- R1-03 and R1-07 still incomplete: controlled cold starts on cloned production-sized DB, Original comparison, OS-unique memory, independent verification pending.

## Frontend instrumentation (source only, not yet installed)

- Added startup mark `memmy:renderer-module-loaded` after renderer import initialization.
- Added `memmy:renderer-first-dom-frame` after the first root DOM mutation plus two animation frames (approximate frame, **not WebKit FCP**).
- Added `memmy:route-ready-first-frame` after startup route transitions to ready plus two animation frames (**not an actual input-response TTI**).
- Marks exist in `performance.getEntriesByType('mark')`; no user text, tokens, storage paths or network requests are emitted.
- Frontend TypeScript passes, Vite build passes, 15 selected existing tests pass and 2 new performance helper tests pass.
- R1-02 remains open until calibrated against the installed macOS Preview and tied to real WebKit paint/navigation observations.

## Installed R1 instrumentation validation

- Rebuilt Tauri v2 debug .app with the existing React/Rust profiler changes, cloned current Preview bundle with copy-on-write, replaced only its executable, and passed relocated-bundle audit, real native-supervisor smoke and isolated full Memory/Backend/Gateway service E2E.
- Strict ad-hoc codesign verification succeeded. Installed at `~/Applications/Memmy Turbo Preview.app`; rollback kept at `~/Applications/.memmy-preview-rollback-before-r1-profiler-20261026.app`.
- Finder-launched Preview remained running and returned successful Memory Health (`storage.ready=true`), `/api/app/bootstrap` (`userMode=byok`), and `/api/agent-sources` responses.
- Original SQLite database sizes/mtime unchanged: memory SQLite 1778192384 bytes, mtime 1792810805; app.sqlite 8007680 bytes, mtime 1792806288.
- **Limitation:** instrumentation is now installed, but WebKit marks have not yet been exported as a durable real-GUI time-to-interactive report; R1-02 and R1-03 remain open. Neither a faster production startup nor a performance regression is claimed from this instrumentation-only change.

## Live installed macOS GUI instrumentation trial
See `docs/qa/perf-r1-live-startup-2026-10-26.md`: real Native Runtime 1029ms Memory ready, 6510ms Backend+Gateway joined, with healthy existing Preview local DB. Renderer telemetry still unavailable; no FCP/TTI claim.
