# Rust Supervisor: parallel Backend + Agent Gateway startup

## Checklist
- [x] Audit startup dependency: Memory first, then Backend and Agent Gateway independently use healthy loopback Memory endpoint
- [x] Change Rust supervisor to overlap the last two service starts, join both, fail closed and stop both on any error
- [x] Rust unit tests 8/8, production-feature binary build
- [x] Relocated staged runtime audit and native-supervisor smoke pass
- [x] Compare baseline and candidate with isolated HOME and native-runtime startup smoke
- [x] Signed app installation and real existing Preview SQLite 45-second health/bootstrap E2E
- [ ] Full GUI/Agent workflow E2E and repeated cold-start benchmarking on original comparable load

## Measurements
First cold-ish comparison: old 7.08 seconds, new 17.80 seconds (both pass). This is a significant regression possibly caused by cold I/O contention; do not claim consistent cold-start gains.

Four alternating warm-cache measurements: candidate 5 and 6 seconds, baseline 7 and 7 seconds (all pass), 1–2 sec improvement on this narrow isolated supervisor smoke. These are elapsed wall seconds with `date +%s` resolution; they are **not** main GUI time-to-interactive benchmarks. Startup with an existing 1.7GB profile may be dominated by Memory initialization and needs separate instrumentation.

Safety: this change does not modify Memmy Original databases and retains all three managed services. Stored branch has unrelated uncommitted source changes; do not include those in the commit.

## Installed result

Ad-hoc signed app verified with `codesign --verify --deep --strict`, atomically installed at `~/Applications/Memmy Turbo Preview.app`; prior Preview backed up at `~/Applications/.memmy-preview-rollback-before-parallel-start-20261026.app`. Finder-launched app stayed alive during 45-second test against the real, separate 1.7 GB Preview SQLite. Memory Health 10/10, `/api/app/bootstrap` BYOK 3/3, `/api/agent-sources` 3/3. Original app and original memory/app database sizes+mtimes unchanged.

No claims that cold start is faster or that all GUI routes have completed E2E.
