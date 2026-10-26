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
