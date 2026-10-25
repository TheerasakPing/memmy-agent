# Memmy Turbo: preview runtime trim / benchmark

Owner: local-preview packaging. This is a controlled first pass, **not** a completed Electron-vs-Tauri performance comparison.

Checklist / independent verification gates:
- [x] Size audit and process-RSS snapshot of installed Tauri Preview
- [x] Conservative packaging plan for known build/test-only dependencies, with fail-closed stage checks and unit test
- [x] Run on copy-on-write Preview app staging, measure disk before/after
- [x] Audit symlink relocation and native module requirements
- [x] Memory CLI, isolated Memory/Backend/Gateway service E2E and native Rust supervisor smoke; installed GUI/Health/Bootstrap is a later gate
- [ ] Sign, strict verify, install atomically with rollback only after gates pass
- [ ] Benchmark Original and Turbo using same database and workload, without writing Original DB

Baseline: Original `/Applications/Memmy.app` 1.1 GB; Tauri Preview 2.2 GB. Root node_modules 945 MB; private Agent node_modules ~1.0 GB; included build/test tools have measurable waste. Six Turbo processes have an aggregate RSS ~1,050,800 KiB; this overcounts shared pages and must not be interpreted as unique memory. Do not claim parity or superiority from this alone.

Worker constraint: large Preview SQLite profiles use automatic-worker containment. Do not trade away features or data safety to make a benchmark look fast.

## Measured outcome and safety finding

Root/private top-level devtool trim on a staged app removed 18 directories after restoring two runtime-critical `typescript` folders. First attempt (20 candidates) failed the full service smoke because `Memory/dist/src/service/project-environment/manifest-parsers.js` imports TypeScript during actual runtime. Both trees were restored from the original signed bundle and `typescript` is now explicitly excluded from the pruner. This negative finding is an important regression guard.

Disk usage (`du -sm`): installed baseline 2224 MiB; stage after *safe* prune 2144 MiB, a net reduction of 80 MiB (3.6%). Size savings only: this does **not** demonstrate lower RAM or latency.

Pass: 2/2 prune unit tests, static relocated-bundle audit, bundled Memory CLI smoke (isolated HOME), full Memory → Local API → Agent Gateway E2E (isolated HOME, 1 pass, 0 failures), real Rust native supervisor smoke (isolated HOME). Production notarization and full human UI/agent workflow coverage remain separate gates.
