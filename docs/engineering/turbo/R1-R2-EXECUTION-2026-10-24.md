# R1 → R2 execution evidence (2026-10-24)

## Provenance and release discipline
- Base: `TheerasakPing/memmy-agent`, local starting commit `d433856bf18a253912b1c7ea4e119d5603f75d81` (Draft PR #24).
- Work branch: `codex/r1-r2-security-hardening-20261024` stacked on PR #24.
- Original UI/CSS/routes: not modified. This work changes backend security checks and tests only.
- Supervisor LEAD: scope, evidence and merge gates; no self-approval.
- A1 Security: tenant SQL boundaries, token and global endpoint threat review.
- A2 Memory: retrieval pool, time-range and onboarding search scope.
- A5 QA: independent rerun, negative and regression evidence REQUIRED before closure.
- A6 Release: native Windows/macOS package smoke and GitHub Actions REQUIRED before closure.
- A7 Docs: tracker and rollback/evidence accounting.
- Roles above are work ownership, **not** a claim that independent live agents reviewed this PR.

## Completed source modifications, pending independent acceptance
1. Pre-candidate `MemoryFilter` SQL tenant ownership guard, persisted from memory metadata or owning session. Refuse missing authenticated user, tenant mismatch and foreign project.
2. FTS/vector/structural and time-range retrieval all inherit the same SQL ownership predicate before candidates hydrate or rerank.
3. Onboarding and stale-policy scan limited to owned memory, and foreign search session rejected before recent-turn access.
4. Scoped `user_memories` lane temporarily fails closed because its existing storage lacks tenant ownership. Local unscoped shared memory is unchanged. **R2.12 remains incomplete** until schema/rollback/quality gates are implemented.
5. Scoped global dashboard/exports/aggregate logs/worker endpoints fail closed pending explicitly tenant-safe implementations. **R2.03/#25 remains incomplete**; do not claim full product feature parity for cloud tenants.
6. HTTP `recordEvent:false` forwards to service; no recall record is persisted when disabled.
7. Scoped/cloud API keys in URL query strings are rejected; local viewer token compatibility retained.

## Local QA evidence
| Gate | Result | Scope |
|---|---|---|
| `npm run typecheck` on original base branch | PASS, exit 0 | macOS baseline (before modifications) |
| `npm run typecheck -w @memmy/memory` on patched branch | PASS, exit 0 | Memory TS and viewer types |
| Targeted tenant suite (3 files) | PASS, 8/8 | cross-tenant CRUD, Panel, search guard |
| SQL/HTTP owner-vs-other + token regression | PASS, 3/3 after final assertions | positive and negative same-user/project |
| `npm run memory:test` | PASS, 1,446/1,447; 1 Windows-only skip | run started before final HTTP URL-token test edit; rerun exact final SHA required |
| macOS/Windows Desktop signed E2E | NOT RUN | R1.08/R5 blocked |
| `npm run typecheck` after patch | PASS, exit 0 | full root TS validation |
| `npm test` after patch | FAILED: 126 pass, 1 fail, 1 skip in packaging group | Mac Electron executable missing (ENOENT); later suites do not run in root sequence |
| `npm run build` with documented `.env.example` Legal URL origins | PASS, exit 0 | `MEMMY_LEGAL_CN_BASE_URL=https://memmy.cn MEMMY_LEGAL_INTL_BASE_URL=https://memmy.bot npm run build` |
| `npm run test:release-workflow` | PASS, 31 pass / 5 Windows-only skips | script/workflow static validation; NOT native CI |
| `npm run test:opencode` | PASS, 24/24 | OpenCode and cross-agent compatibility subset |
| `npm run agent:test:tui-cursor` | PASS, 5/5 | CLI/TUI cursor subset |
| `npm run test:contracts` | FAILED at import, no tests executed | Declared dependency `isomorphic-git` missing from this checkout's `node_modules` |
| Full root `npm test` all green | BLOCKED | Missing Electron runtime and a missing declared runtime dependency; do not skip either test |
| GitHub Actions for PR SHA | BLOCKED | issue #26 (422 Actions disabled although API enabled) |
| Independent A1/A5 + LEAD approval | NOT RECEIVED | required before merging |

## Mandatory remaining R1 tasks
- R1.05 threat model must receive independent Security acceptance.
- R1.06 isolated cross-tenant negative tests need CI and QA confirmation.
- R1.07 full immutable install/typecheck/test/build evidence, including original desktop unit tests. Root `npm test` fails at the Electron packaging test on this checkout. It must be rerun with a valid native Electron binary, and no case should be skipped to force PASS.
- R1.08 baseline screenshots and native macOS + Windows 11 parity journeys.
- R1.09 SQLite retrieval and evolution benchmark p50/p95/p99, Recall@10 and dataset manifest.
- R1.10 separate QA/LEAD signoff. No R1 exit claim.

## Mandatory remaining R2 tasks
- R2.01–.03: scoped runtime policy, tested packaging, and all read/write/stream/worker data paths.
- R2.04: root regression and independent reviewer acceptance.
- R2.05: SSE/query-token and log redaction review plus native smoke.
- R2.06–.11: queue aging, provenance dedup, index outbox replay, backup/restore, evidence provenance and contradiction history.
- R2.12: actual tenant-owned UserMemory schema, migration/backfill, read/write and recall tests; remove scoped fallback only after these pass.
- R2.13: ensure redaction propagates across FTS/vector/derived indexes and reruns.
- R2.14: full cross-platform + Security/A5/LEAD exit gate.
- P0 release blocker: [#25](https://github.com/TheerasakPing/memmy-agent/issues/25) scope all disclosure paths. Actions blocker [#26](https://github.com/TheerasakPing/memmy-agent/issues/26).

## Rollback
- Work is isolated on a new branch stacked on PR #24; do not merge this branch until QA and CI. Restoring `package.json` after an unsuccessful local `npm install-scripts approve electron` attempt preserves dependency policy unchanged.
- Revert the security-hardening commit as a unit if it breaks legacy local E2E; no schema migration is performed in this patch.
- Never use a release flag or skipped CI as evidence of success.
