# R1–R5 Delivery Roadmap

**Baseline:** 74b26fc78ebd14a784981ba8e83bebf878c20865 · Owner: LEAD · Status: in progress (R1 static audit only).

## R1 — Deep Source Audit + Reproducible Baseline (10 tasks)
- [x] Map repo, workspaces, package scripts and baseline SHA (static)
- [x] Map memory engine, 4 memory layers, schema and retrieval (static)
- [x] Locate probable auth/namespace/search/fairness/dedup risks (static)
- [x] Inspect existing CI/build/E2E coverage (static)
- [ ] Model trust boundaries (loopback, tokens, namespaces, local viewer, SSE)
- [ ] Add failing negative tests in isolated DB for cross-scope write/read
- [ ] Run clean npm ci, typecheck, test, build with immutable logs
- [ ] Capture original UI screenshots and feature inventory for macOS + Windows
- [ ] Profile retrieval/search/evolution and record cold/warm baselines
- [ ] A5 + Supervisor accept R1 evidence and explicitly disposition P0 issues
**Gate:** Threat model, reproductions, complete test inventory, UI baseline and review sign-off.

## R2 — Reliability, Privacy and Advanced Memory Foundations (14 tasks)
- Define tenant/user/project/agent namespace semantics, implement authorization and scoped-key wiring.
- Regression-test local anonymous mode/bind security; preserve single-user experience.
- Fix read-only Search semantics and event logging opt-out; test no side effects.
- Queue fairness/aging, leases and crash retries.
- Cross-agent dedup provenance and idempotency.
- Transactional outbox and reindex repair.
- Backup, migration and rollback tests.
- Evidence-backed memory and versioned facts.
- Contradiction resolution, temporal-ready metadata.
- Memory Bank isolation and permissions.
- Test memory edit/redact/delete with index synchronization.
- Document performance baseline; do not ship Rust yet.
- Independent security/QA acceptance of APIs.
- LEAD release gate: no untested P0.
**Gate:** no cross-scope leaks or data corruption; all legacy contracts and tests pass.

## R3 — Native Sources, Handoff, Graph + Turbo Prototype (13 tasks)
- SourceTurn stable keys, hooks↔scan idempotency, Codex/Cursor provenance fixtures.
- Real OpenCode V1/V2 checks and plugin compatibility.
- Agent-to-agent handoff tests with bounded trusted context.
- CLI, API, desktop, hooks, gateway contracts unchanged.
- Temporal graph PoC and as-of semantics.
- Entity/relationship provenance + access control.
- Opt-in external document connector architecture + delete/export.
- Rust sidecar ABI/API contract and fallback design.
- SQLite WAL outbox indexing under failures.
- USearch benchmark, recall quality and index freshness.
- Tantivy tokenizer + multilingual/code query evaluation.
- Test cross-platform native module loading.
- Independent LEAD/QA acceptance with flag OFF by default.
**Gate:** no feature regression, correct handoff, measured PoC before Turbo is enabled.

## R4 — Planner, Supervisor and Observability (13 tasks)
- Persistent checklist/schema and task assignment.
- Supervisor dispatch, claim, cancel, retry and idempotency.
- Explicit independent code review and QA gating.
- Non-self-approval enforcement and immutable evidence record.
- Failure-injection for stale lease, crashed worker and retry.
- Explainable recall and index provenance/latency observability.
- Memory Doctor dry-run and safe repair workflows.
- Human-reviewed skill evolution and safe activation.
- Prospective Memory tasks/reminders with expiry and opt-in.
- DuckDB read-only analytics snapshots from sanitized data.
- Benchmarks and threshold-based performance/accuracy dashboards.
- Security/privacy review of analytics and logs.
- LEAD accepts Supervisor and migration behavior.
**Gate:** tasks cannot mark DONE without reviewer, QA and Supervisor evidence.

## R5 — E2E, Smoke, Native Packages and Production (10 tasks)
- Build matrix Windows 11 x64, macOS arm64, Linux x64/arm64.
- Full existing-feature/UI screenshot parity and keyboard/accessibility.
- Cold/fresh install and upgrade from baseline with memory preserved.
- Real end-to-end multi-agent + indexed-memory recovery.
- Security negative/regression suite mandatory.
- Rust ON/OFF fallback, native crash and missing binary.
- Analytics and data migration/rollback verification.
- Signed installer and checksums; provenance/verification.
- Release candidate smoke on actual packaged artifact.
- Dual independent sign-off (QA + Supervisor), publish and rollback instructions.
**Gate:** no P0/P1 unresolved release blockers; no fake PASS/unknown; complete evidence and approved signed installers.

## Work board
Machine-readable 60-task list is in CHECKLIST-PLANNER.json. Each task needs owner, independent reviewer, acceptance criteria, linked tests and artifacts. Treat research checks as STATIC_REVIEW only; runnable tests remain NOT_RUN.
