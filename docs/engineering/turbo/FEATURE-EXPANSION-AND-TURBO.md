# Advanced Memory Features + Rust Turbo (Proposed; NOT implemented)

## New feature backlog
| ID | Inspired by | Capability | Phase | Required acceptance |
| --- | --- | --- | --- | --- |
| F01 | Hindsight | Evidence-backed memory and provenance links | R2 | Every derived claim points to retained permitted evidence |
| F02 | Graphiti | Temporal assertions and effective dates | R3 | As-of queries return historical truth and never overwrite original facts |
| F03 | Hindsight/Graphiti | Contradiction detection and supersession | R2 | Conflicts are recorded, explained and reversible |
| F04 | Mem0/Hindsight | User/project/agent Memory Banks | R2 | Tenant/project isolation tests never leak |
| F05 | Graphiti/Mem0 | Knowledge graph / entity relationships | R3 | Relationships cite evidence; delete cascades are safe |
| F06 | Letta/OpenClaw | Memory Doctor (quality, stale and orphan detection) | R4 | Dry-run mode; no destructive cleanups without approval |
| F07 | Letta | Memory revisions and rollback | R2 | All edits history-aware; restore test passes |
| F08 | Supermemory | Document connectors | R3 | Explicit opt-in, scoped permissions and removable sync |
| F09 | Letta | Cross-Agent Context Handoff | R3 | Codex→Claude→Codex survives restart and avoids duplicates |
| F10 | Hindsight/Letta | Skill evolution and verification | R4 | Skills only activate after measurable success + human review |
| F11 | Hindsight | Explainable recall | R4 | Trace retrieval channels and reasons without revealing secrets |
| F12 | OpenClaw | Prospective memory / planned reminders | R4 | Durable idempotent schedules, opt-in and expiry controls |

These are capability inspirations, NOT code copied from other repositories. Review licenses and dependency security before using any third-party implementation.

## Target stack and rollout
- **Authoritative storage:** existing SQLite with WAL, schema migrations and backup.
- **Stage 0:** instrument query paths, CPU, memory, Recall@10, p50/p95/p99 and write latency at 10k/100k/1m items.
- **Stage 1:** Rust retrieval sidecar prototype behind flag memmyTurbo.enabled=false by default; existing HTTP contracts stay unchanged.
- **Stage 2:** USearch ANN over rebuildable vectors, Tantivy BM25 over rebuildable text; durability requires SQLite-driven outbox/replay, atomic watermarks, crash/reindex recovery and fair fallback.
- **Stage 3:** DuckDB only for read-only analytical snapshots, not live transactional memory or tenant authorization decisions.
- **Stage 4:** native packaging and startup fallback tests for macOS Apple Silicon, Windows 11 x64, Linux x64/arm64, measured against baseline.
- **No unconditional migration:** proceed only when Recall@k is non-regressed, p95 improves in representative workloads, new memory is searchable within defined freshness SLA and old service path still passes all tests.

## Threats
- Cross-tenant search index contamination; read-time metadata filters must be enforced *before* returning results.
- Background index lag; provide freshness status, SQLite fallback, recovery and no silent stale recall.
- Rust native crashes/restart or missing binary; kill switch reverts to legacy engine with durable data untouched.
- DuckDB analytics snapshots containing secrets; redact and limit by local/private scope, avoid exporting raw user memory by default.
