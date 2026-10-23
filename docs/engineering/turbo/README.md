# Memmy Agent Turbo — Engineering Program

**Repository:** https://github.com/TheerasakPing/memmy-agent
**Upstream:** https://github.com/MemTensor/memmy-agent
**Baseline:** 74b26fc78ebd14a784981ba8e83bebf878c20865 (Memmy Desktop 1.2.4, Memory package 2.1.7)
**Start:** 2026-10-23
**Status:** R1 static audit underway. Documentation and tracking infrastructure only; no production fixes or E2E passes claimed.

## Hard product invariants
1. Retain the original UI pixel-for-pixel as far as the supported native platform allows. Do not edit routes, themes, CSS, layout, typography, icons, animations or navigation to add backend features by default.
2. All existing Desktop, Pet, Browser/Computer Use, Memory, Agent runtime, CLI, Hooks, Plugins, Settings, Upgrade and Installer features must continue to work.
3. Prefer additive APIs, adapters and feature flags (default OFF). Do not rewrite the existing UI or swap the storage source of truth in place.
4. Keep SQLite as canonical transactional memory store. Experiment with optional Rust + USearch + Tantivy as rebuildable secondary indexes; DuckDB is optional read-only analytical processing, not authoritative OLTP storage.
5. Every deliverable requires independent review, QA evidence, E2E/smoke when applicable, rollback, and Supervisor acceptance. No skipped tests represented as PASS.

## Documents
- [R1 source audit](./SOURCE-AUDIT-R1.md)
- [R1–R5 roadmap](./ROADMAP-R1-R5.md)
- [Team assignment and review SOP](./AGENT-TEAM-SOP.md)
- [UI freeze and feature parity](./UI-LOCK-AND-FEATURE-PARITY.md)
- [E2E and smoke matrix](./TEST-MATRIX-E2E-SMOKE.md)
- [Competitor-inspired features and Turbo architecture](./FEATURE-EXPANSION-AND-TURBO.md)
- [Machine-readable 60-task checklist](./CHECKLIST-PLANNER.json)

## Implementation sequence
R1 pin code/tests and reproduce risks → R2 close P0 security & memory reliability → R3 prove cross-agent handoff + optional retrieval indexes → R4 checklist planner, supervisor and observability → R5 production E2E, signed installers and rollback.

Use draft PRs until all required gates are actually green. Never modify main directly. Synchronize upstream selectively and rerun full regression before adopting upstream changes.
