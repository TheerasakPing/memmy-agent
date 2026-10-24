# E2E / Smoke Test Matrix — Mandatory Release Gates

No native signed-package E2E pass is claimed. Some local contract/security and source-build tests have been run; see [R1/R2 execution evidence](R1-R2-EXECUTION-2026-10-24.md). Each native E2E execution must report commit SHA, OS, Node, runtime version, command, exit code, test totals/skips, logs and (where applicable) screenshot/video.

| Test | Priority | Scenario | Expected outcome | Platform |
| --- | --- | --- | --- | --- |
| S01 | P0 | Startup Memmy Desktop + Memory daemon | ready, no port/auth regression | macOS arm64 / Win11 x64 |
| S02 | P0 | Fresh install signed package | launch UI, agent + memory healthy | macOS arm64 / Win11 x64 |
| S03 | P0 | Upgrade v1.2.4→Turbo | data and original settings retained | macOS arm64 / Win11 x64 |
| S04 | P0 | Roll back binaries/DB | restore backup safely and verify reads | macOS / Win / Linux |
| S05 | P0 | Original UI screenshot snapshot diffs | 0 intentional changes, human reviewed | macOS / Win |
| S06 | P0 | Existing navigation / settings | all original routes and tabs intact | macOS / Win |
| S07 | P0 | Memory add/get/search/delete/redact | correct, durable, consistent indexes | all |
| S08 | P0 | Two-tenant scoped key CRUD | denied cross-tenant access and mutations | all |
| S09 | P0 | Cross-tenant episode/delete/raw-turn redaction | denied, no side effects | all |
| S10 | P0 | Anonymous tokenless service loopback | intended local behavior only; remote blocked | all |
| S11 | P0 | Read-only search with recordEvent=false | no recall/event/log writes | all |
| S12 | P0 | Hook + scan same native turn | capture exactly once | all |
| S13 | P0 | Codex→Claude→Codex session continuation | scoped context, no duplicate import | macOS / Linux |
| S14 | P1 | Cursor→Codex native import | duplicate source provenance reconciled | all |
| S15 | P0 | OpenCode V1/V2 host integration | compatible and tools safe | Linux / macOS |
| S16 | P0 | Browser and Computer Use permissions | old security dialogs and behavior preserved | supported native OS |
| S17 | P0 | Pet mode / trays / native notifications | same original behavior | macOS / Win |
| S18 | P0 | User account / BYOK / model switching | provider and existing secrets preserved | all |
| S19 | P0 | Agent CLI / gateway API / TUI | all legacy endpoints and commands | all |
| S20 | P1 | Evolution priority fairness | low priority eventually leased during high inflow | all |
| S21 | P1 | 100k memory high-concurrency recall | baseline latency and Recall@k recorded | all |
| S22 | P1 | Rust vector ON/OFF | semantically equivalent output within tolerance | all |
| S23 | P0 | Rust native binary absent/crashes | safe fallback and zero data loss | all |
| S24 | P0 | sqlite→USearch/Tantivy replay | every committed eligible memory indexed after recovery | all |
| S25 | P1 | Temporal as-of knowledge query | provenance and effective time correct | all |
| S26 | P0 | Memory Banks tenant/project isolation | disjoint retrieval and no index leakage | all |
| S27 | P1 | Contradiction resolution / version rollback | facts not silently overwritten | all |
| S28 | P1 | Explainable recall | relevant evidence without secrets | all |
| S29 | P1 | Memory Doctor dry run | no destructive write until approved | all |
| S30 | P0 | Multi-Agent task stale lease / replay | exactly-once accepted task and approval trail | all |
| S31 | P0 | Supervisor self-approval rejection | same author cannot approve final result | all |
| S32 | P0 | Document connectors permissions and deletion | opt-in, revoke, export/delete work | all |
| S33 | P0 | Migration with fault injection | recoverable backups, no corrupt SQLite | all |
| S34 | P1 | DuckDB Analytics snapshot | no secrets/cross-scope data | all |
| S35 | P0 | Signed installers + checksum verification | valid signatures/digests, launch native app | macOS / Win |
| S36 | P0 | Linux CLI install/uninstall under systemd | no service/port leakage, works after restart | Linux |
| S37 | P0 | CI required statuses / build provenance | 100% mandatory checks passed (0 skipped critical) | CI |
| S38 | P1 | Stress tests memory/CPU start/stop/restart | no leak, no stuck jobs | all |
| S39 | P1 | Multilingual FTS Thai/English/code | consistent ranking and correct scope | all |
| S40 | P1 | Local zero-network operation | no external requests unless model/connector configured | all |
| S41 | P1 | SSE + token handling / viewer | no accidental auth/secret disclosure | all |
| S42 | P1 | Cross-agent untrusted prompt injection | recalled text is data, cannot seize instructions | all |
| S43 | P1 | Optional model unavailable | no blocking legacy recall/search | all |
| S44 | P0 | Release smoke signed fresh + upgraded app | human QA and Supervisor signoff recorded | native OS |

## Command candidates (must validate locally)
- npm ci
- npm run version:check
- npm run typecheck
- npm test
- npm run build
- npm run test:linux-cli (Linux)
- npm run test -w @memmy/frontend-desktop
- npm run test -w @memmy/desktop
- GitHub Actions: windows-memory-validation.yml, computer-use-native.yml, linux-cli-installer.yml, runtime-artifacts.yml

**Artifact requirements:** JUnit/JSON, logs, SHA, screenshot diff pack, release installer with checksums, performance raw data, reproducible fixtures, independent review records and rollback verification.

**Block release** on test failure, skipped mandatory native installer smoke, unresolved P0 exposure, visual change, data corruption, missing reviewer approval or unsupported platform binary.
