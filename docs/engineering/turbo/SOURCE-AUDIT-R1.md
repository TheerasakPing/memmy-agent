# R1 — Evidence-first Source Audit

**Pinned source:** https://github.com/MemTensor/memmy-agent/tree/74b26fc78ebd14a784981ba8e83bebf878c20865
**Audit grade:** remote static source inspection only; findings below are hypotheses or directly visible behavior, not proof of exploitability. All reproduction tests PENDING.

## Verified implementation map
- Desktop renderer: App/frontend/desktop/src; React + Vite, route table App/frontend/desktop/src/app/routes.ts, app/router.tsx, theme/tokens.css, styles.css.
- Desktop shell: App/shell/desktop (Electron, NSIS / dmg build configuration).
- Shared contracts: App/backend/local-api-contracts.
- Memory: Memory/src/server/index.ts, http.ts, service/memory-service.ts, service/retrieval/retrieval-service.ts, storage/repositories.ts, storage/schema.ts (schema version 9).
- Native history readers: AgentSourceCore; includes OpenCode V1/V2 database adaptation.
- Build checks: .github/workflows/windows-memory-validation.yml, runtime-artifacts.yml, computer-use-native.yml, linux-cli-installer.yml.

## Findings and proof requirements

| ID | Priority | Source evidence | Test needed | Interpretation |
| --- | --- | --- | --- | --- |
| SEC-01 | P0 validation | Memory/src/service/memory-service.ts lines 3528-3535: assertEpisodeInScope and assertRawTurnInScope perform no checks | Two tenants; test cross-tenant episode delete and raw-turn redact via scoped keys | Scope enforcement gap in helper; API reachability and practical impact not yet validated |
| SEC-02 | P0 validation | Memory/src/service/memory-service.ts lines 3517-3526: assertMemoryInScope checks tenant for external-evidence types only | Cross-tenant generic memory get/archive/delete; project isolation policy | Must define which local-owner and tenant namespaces are intentionally shared before fixing |
| SEC-03 | P1 | Memory/src/server/index.ts lines 118-124: without token config passes allowAnonymous: true; Memory/src/server/http.ts around 1398 permits anonymous scopes '*' | Verify bind address, service startup, unauthorized local and remote accesses | Local-first convenience may be intended. Never claim exposed externally without binding/network proof |
| SEC-04 | P1 | Memory/src/server/http.ts lines 783-810 reconstruct MemorySearchRequest without recordEvent; retrieval-service.ts line 2088 honors recordEvent:false | With recordEvent:false assert no recall event or API log; compare opt-in behavior | Possible read-only search semantics loss at HTTP boundary |
| REL-01 | P1 | Memory/src/storage/repositories.ts lines 3694-3700 filters strict priorityCohortOnly to first queue priority | High-priority arrival load vs low-priority job; lease fairness/aging | Starvation possible under sustained load; benchmark to prove |
| INT-01 | P1 | Codex / Cursor history may be imported across agent formats. Source identity dedup currently oriented around individual source | Synthetic imported ledger plus two histories; check duplicate semantics | Needs reproducible evidence, not an assumed live bug |
| INT-02 | Verification | AgentSourceCore/src/opencode-database-source.ts recognizes session_v2 + session_message; OpenCode plugin contains V1/V2 entrypoints | V1/V2 host fixtures, error/migration, tool-only idle boundaries | Old OpenCode V2 issue alone does NOT prove a current regression |
| PERF-01 | Benchmark | Existing better-sqlite3 / sqlite-vec native code used | Query-plan, p50/p95/p99, Recall@k, RAM, ingestion QPS, scale profiles | Rust rewrite only if measured improvements justify native complexity |
| UI-01 | P0 gate | app/routes.ts, app/router.tsx, theme/tokens.css, styles.css and Memory UI pages define current behavior | Baseline screenshots, route snapshots, old vs new keyboard/a11y, installer upgrade | No visual changes allowed without explicit product approval |

## Trust boundaries and security test fixtures
- Test tenant A vs B, user A vs B, project A vs B, local owner account vs scoped key, anonymous loopback vs blocked remote socket, read-only vs read-write scoped key.
- Cover CRUD, turns, episodes, raw turns, SSE event stream, history scans, tooling, migrations, viewer routes.
- Run on an **isolated temporary SQLite database**; never mutate the user's actual ~/.memmy store.
- Redact tokens and secrets from test logs. Assert correct rejection codes (401 unauthenticated, 403 unauthorized, or policy-consistent 404), no side effects, and no information leakage.
- Threat-model bind settings, token query string used for EventSource, service lifecycle/restart, logs, backups and feature-flag fallbacks.

## R1 next executable commands (isolated checkout)
1. npm ci
2. npm run version:check
3. npm run typecheck
4. npm run test
5. npm run build
6. npm run test:linux-cli (Linux runner only)
7. npm run test -w @memmy/frontend-desktop
8. npm run test -w @memmy/desktop
Record exact OS, Node, commit SHA, durations, logs, skipped tests and artifacts. Commands listed here are not claimed to have been executed.

## R1 Exit Gate
A1 Security Agent creates reproductions and threat model; A2 Memory Agent collects retrieval/queue baseline; A3 Integration validates source provenance; A5 QA independently reruns, LEAD Supervisor signs the evidence. All P0 items must be assigned with test-based dispositions before R1 closes.
