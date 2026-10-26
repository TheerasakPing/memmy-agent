# Memmy Turbo — Performance Checklist Planner (R1–R8)

**Date:** 2026-10-26  | **Status:** PLANNED / not approved for production
**Scope:** `MemTensor/memmy-agent` derivative — Rust + Tauri v2 + React + Local Memory / Agent
**Target systems:** macOS Apple Silicon first, Windows 11 x64 and Linux regression gates
**Branch baseline:** `codex/tauri-v2-macos-original-db-install-20261025`

## Non-negotiable release constraints

- [ ] Preserve existing UX/UI, tabs, buttons, native bridges, Agent, MCP, Skills, local-only/BYOK, Thai locale, themes and history, with documented functional parity.
- [ ] **Do not edit or migrate in place** `/Applications/Memmy.app`, `~/Library/Application Support/Memmy/app.sqlite` or `~/.memmy/memory-service/memory.sqlite`. Benchmark with isolated copies.
- [ ] Do not disable safety, crash recovery, SQLite integrity constraints, permission controls or tests to improve benchmark scores.
- [ ] Each task: assigned implementation agent → code review by lead → automated tests → smoke → relevant E2E → independent reviewer acceptance → merge gate.
- [ ] A benchmark improvement is accepted only with representative workload, repeated measurements, variance and no unacceptable regression.
- [ ] Do not merge unrelated existing uncommitted changes or `node_modules` into optimization commits.

## Supervisory workflow (mandatory for every task)

1. **Lead Architect:** assign task ID, owner and reviewer; record exact scope and baseline.
2. **Implementation Agent:** branch/commit isolated changes; attach code, tests, before/after measurement and rollback instructions.
3. **QA Agent:** independently run unit/integration tests, package smoke, native GUI smoke and relevant E2E; collect artifacts/logs.
4. **Independent Reviewer:** inspect correctness, isolation, security and regression risks; reject unsupported speed claims.
5. **Lead Architect:** mark a task `[x]` only with linked evidence and approval; otherwise retain `[ ]` / `BLOCKED` with explanation.

### Agent assignment matrix

| Role | Responsibility | Review ownership |
|---|---|---|
| Lead Architect (LEAD) | architecture, work division, integration, final acceptance | all tasks |
| Rust Performance (RUST) | native startup, IPC, process lifecycle, diagnostics | LEAD + QA |
| Memory/Database (DB) | SQLite, FTS, WAL, indices, profiling | LEAD + QA |
| Agent Runtime (AGENT) | sessions, concurrency, worker isolation, MCP | LEAD + QA |
| Frontend (UI) | React, virtual lists, first paint, localization parity | LEAD + QA |
| Packaging (PKG) | package pruning, dependencies, signing and rollback | LEAD + QA |
| QA/Benchmark (QA) | baselines, stress, soak, cross-platform E2E | independent reviewer + LEAD |
| Independent Reviewer (REVIEW) | validation separate from implementing agent | LEAD |

## Status / progress tracker

| Release | Description | Lead owner | State | Exit gate |
|---|---|---|---|---|
| R1 | Baseline & reproducible profiler | QA / RUST | TODO | baseline approved |
| R2 | Cold/Warm startup, Time-to-Interactive | RUST / UI | TODO | verified faster without cold regression |
| R3 | Memory & SQLite query performance | DB | TODO | P95 and integrity gate |
| R4 | Agent/Session/worker resilience | AGENT | TODO | stress + soak gate |
| R5 | React UI responsiveness | UI | TODO | route + virtual-list E2E |
| R6 | Package, native runtime, memory | PKG / RUST | TODO | dependency parity + RSS gate |
| R7 | Cross-platform reliability & migration | QA | TODO | macOS/Win11/Linux gates |
| R8 | Release & independent review | LEAD / REVIEW | TODO | approval + rollback + signed distribution |

## R1 — Source Audit, Measurement, Baseline (P0)

**Progress note (2026-10-26):** partial R1-01 hardware inventory, partial R1-02 installed and smoke-tested opt-in Rust lifecycle instrumentation plus in-memory React first-frame/ready-route timing, and first 5-run isolated native-supervisor benchmark complete. Median 5387 ms, P95 9644 ms (details: `docs/qa/perf-baseline-2026-10-26.md`). These are **not marked complete** because Original pairing, GUI TTI, large DB and independent review remain open. Implementer: RUST/QA; reviewer: pending.


- [ ] **R1-01 [QA]** Capture environment: macOS model/RAM/OS, CPU load, power mode, exact git SHA, Preview version and copied SQLite size/hash.
- [ ] **R1-02 [RUST]** Add timestamped stages (launch → WebView first paint → Memory ready → Backend ready → Agent ready → UI interactive), without exposing secrets.
- [ ] **R1-03 [QA]** Repeat ≥5 controlled cold and ≥10 warm starts; record median/P95/min/max and failures for both Original and Turbo where comparable.
- [ ] **R1-04 [DB]** Baseline read/search/insert latency with isolated database snapshot, no mutation of Original; record query plans and P50/P95/P99.
- [ ] **R1-05 [AGENT]** Measure session restore, first Agent response, concurrent session count and MCP startup latency.
- [ ] **R1-06 [UI]** Collect React initial bundle, FCP/TTI and route/frame timings; test Thai + dark mode.
- [ ] **R1-07 [QA]** Report process-tree RSS **and** unique/physical memory when available; sample idle/active CPU and disk I/O.
- [ ] **R1-08 [REVIEW/LEAD]** Sign off baseline report and select top three bottlenecks with supporting evidence.

**Gate:** `docs/qa/perf-baseline-<date>.md` + machine-readable results, scripts, run-to-run variance, reviewer approval.

**R1-02 live diagnostic (2026-10-26):** installed native profiler captured Memory ready at 1029 ms and Backend/Gateway joined at 6510 ms. React telemetry file absent, so R1-02 remains partially complete; see `docs/qa/perf-r1-live-startup-2026-10-26.md`.

## R2 — Startup Acceleration (P0)

- [ ] **R2-01 [RUST]** Profile Memory initialization (database open, schema migrations, synchronous index creation, worker initialization).
- [ ] **R2-02 [RUST]** Audit parallel Backend/Gateway launch; warm-cache gains exist, but a prior cold run regressed (17.8s vs 7.08s). Prevent cold-start regressions before promoting.
- [ ] **R2-03 [UI]** First paint independent of slow Agent; display accurate readiness and disable actions only until corresponding service is ready.
- [ ] **R2-04 [AGENT]** Lazily load optional providers/connectors while preserving available features on demand.
- [ ] **R2-05 [RUST]** Add bounded retry with cancellation and no zombie processes, no credential leakage or UI false-ready.
- [ ] **R2-06 [QA]** Benchmark cold/warm/large DB/offline/failure scenarios, including Finder launch and app relaunch.
- [ ] **R2-07 [REVIEW/LEAD]** Approve improvement only if median improves and P95/cold regression stays within agreed thresholds.

**Provisional target:** warm UI interactive ≤3s; target is **not** a current measured result.

## R3 — SQLite / Memory Engine (P0/P1)

- [ ] **R3-01 [DB]** Audit slow endpoints with SQL timing and `EXPLAIN QUERY PLAN`, identify full scans and N+1 patterns.
- [ ] **R3-02 [DB]** Review existing indices/FTS5 and measured benefits; add migration with down/rollback strategy only as needed.
- [ ] **R3-03 [DB]** Check WAL checkpoint frequency, busy_timeout, cache/mmap options; benchmark durability and concurrent reads.
- [ ] **R3-04 [DB]** Pagination / cursor reads for large sessions, memories, logs and search results; avoid full materialization in RAM.
- [ ] **R3-05 [DB]** Evaluate DuckDB on an **isolated analytics read replica only**; do not replace SQLite without strong evidence and compatibility validation.
- [ ] **R3-06 [QA]** Validate count/result equivalence, integrity, large-DB stress and latency under concurrent Agent activity.
- [ ] **R3-07 [REVIEW/LEAD]** Sign off query/data correctness and improvement against baseline.

**Provisional target:** typical Memory search P95 ≤200ms on specified fixture/hardware.

## R4 — Agent / Session / Worker Reliability (P0)

- [ ] **R4-01 [AGENT]** Trace active sessions, event-loop delays, timer backlogs, I/O queues and hanging promises.
- [ ] **R4-02 [AGENT]** Add bounded concurrency and backpressure with session fairness; do not silently drop tasks.
- [ ] **R4-03 [AGENT]** Isolate CPU-heavy work, ensure cancellation/timeout and deterministic clean-up.
- [ ] **R4-04 [AGENT]** Restart/recover stuck sessions; prohibit duplicate actions and stale worker ownership.
- [ ] **R4-05 [AGENT]** Preserve MCP permissions, Skills, provider auth and Thai Agent responses.
- [ ] **R4-06 [QA]** Load test ≥10 sessions, repeated open/close, provider outage, large memory and prolonged soak; record incident recovery.
- [ ] **R4-07 [REVIEW/LEAD]** Review fail-closed behavior and concurrency safety before merge.

## R5 — React/WebView UX Performance (P1)

- [ ] **R5-01 [UI]** Profile route-level hydration, bundle loading and first paint in Tauri/WebKit.
- [ ] **R5-02 [UI]** Code-split Monaco/editor, analytics and infrequently used views; preserve feature access.
- [ ] **R5-03 [UI]** Virtualize massive lists and avoid repeated derived-state computations.
- [ ] **R5-04 [UI]** Stabilize React selectors/callbacks and debounce expensive filter/search updates.
- [ ] **R5-05 [QA]** Test scrolling, tab switches, multilingual Thai wrapping, dark theme and accessibility interactions.
- [ ] **R5-06 [REVIEW/LEAD]** Accept only if frames/interaction latency improves and parity tests pass.

## R6 — Runtime Footprint, Idle Resource Use (P1)

- [ ] **R6-01 [PKG]** Produce dependency usage evidence for root and Agent-private `node_modules`.
- [ ] **R6-02 [PKG]** Prune safe development-only modules in staged bundle; keep `typescript` (required by Memory runtime manifest parser).
- [ ] **R6-03 [RUST/AGENT]** Consider reducing Node processes **only** if worker isolation/recovery and feature parity remain safe.
- [ ] **R6-04 [PKG]** Detect duplicated native addons, binaries and unused Cloud-only assets without breaking user-configured BYOK APIs.
- [ ] **R6-05 [QA]** Compare bundle size, launch performance, true memory footprint and native addon loading.
- [ ] **R6-06 [REVIEW/LEAD]** Sign off relocatable signed app, no missing modules, and safe rollback.

**Known evidence:** preview reduced from 2,224 to ~2,142 MiB, but this did **not** prove RAM savings. Goal ≤1GB is aspirational.

## R7 — Production Reliability / Compatibility (P0)

- [ ] **R7-01 [QA]** macOS arm64 Finder launch, login-free local mode, test with representative 1.7GB cloned DB.
- [ ] **R7-02 [QA]** Windows 11 x64 installation/smoke/E2E and absence of Node terminal flashing.
- [ ] **R7-03 [QA]** Linux package smoke/E2E where supported.
- [ ] **R7-04 [QA]** Crash/kill/restart, sleep/wake, 24-hour soak, DB locked/full disk, disconnected MCP provider.
- [ ] **R7-05 [QA]** Compare all visible tabs/buttons/features to Original, including Thai, themes, Agent, MCP, exports.
- [ ] **R7-06 [REVIEW/LEAD]** Review accessibility, security, regression logs, resource graphs and any deviations.

**R7 reliability addendum (2026-10-26):** eight isolated installed Rust supervisor start/stop cycles passed (5/5 then 3/3 with process-leak and leftover-profile checks); isolated Local API SIGKILL/restart and credential-rotation smoke passed (Backend tests 4/4). Installed Preview read-only health endpoints returned HTTP 200, Bootstrap `th-TH` and `byok`, Preview SQLite quick-check `ok`. This is **not** a crash/kill/soak or true GUI interaction signoff. QA artifact: `docs/qa/memmy-turbo-r7-restart-smoke-2026-10-26.md`.

**R7 QA progress (2026-10-26):** added a regression test for upgrading a legacy app-state DB to Thai while preserving fields, idempotence and SQLite integrity; app-state suite passed 38/38. Extended the existing renderer smoke to Chromium **and browser WebKit**, both passing three original React preview screens and Tauri JS IPC mapping. Combined focused unit tests passed 141/141, Backend sidecar smoke 3/3. The browser WebKit result is **not** native macOS WKWebView interaction; Accessibility permission, full functional parity, cross-platform E2E, long-running soak and independent review remain open. Details in `docs/qa/memmy-turbo-r7-db-upgrade-and-webkit-smoke-2026-10-26.md`.

## R8 — Release Gate (P0)

- [ ] **R8-01 [REVIEW]** Independent code, security, dependency/license and performance evidence review.
- [ ] **R8-02 [QA]** CI: Rust tests, TypeScript, unit/integration, E2E/Smoke, DB fixture checks, benchmark regression budgets.
- [ ] **R8-03 [PKG]** Produce macOS, Windows x64, Linux builds; sign/notarize where appropriate and validate installers.
- [ ] **R8-04 [PKG]** Test upgrades, profile-isolation, backup/rollback and Original DB preservation.
- [ ] **R8-05 [LEAD]** Approve release only when all mandatory gates are complete; publish honest before/after report.

## Immediate execution queue

1. **NEXT:** R1-01 + R1-02: hardware/profiler instrumentation + controlled startup phases.
2. R1-03 + R1-07: repeat startup and CPU/RAM baseline.
3. R1-04 + R1-05 + R1-06: parallel DB, Agent and Frontend profiles.
4. R1-08: team-lead bottleneck review; then R2 performance work.

**Update rule:** every completed item gains commit SHA, test name/results, benchmark delta, reviewer and sign-off date. Unverified tasks remain unchecked. A code author cannot self-certify independent review.
