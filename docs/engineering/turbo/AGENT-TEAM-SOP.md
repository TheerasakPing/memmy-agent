# Multi-Agent Engineering SOP

## Team & ownership
- LEAD / Supervisor — design, decomposition, dependency tracking, review gates, final acceptance. For LEAD-authored changes A5 plus A1 must perform independent approval; self-approval forbidden.
- A1 Security Agent — auth, namespace, privacy, redaction, negative tests. Reviewer LEAD; independent QA A5.
- A2 Memory Agent — SQLite, retrieval, evolution, dedup, performance. Reviewer A1 for privacy-impacting changes, otherwise LEAD; A5 QA.
- A3 Integrations Agent — AgentSourceCore, hook/plugin support, cross-agent handoff. Reviewer A2 + LEAD; A5 QA.
- A4 Orchestration Agent — checklist planner, persistent tasks, watchdog/retries, approval workflow. Reviewer A1 + LEAD; A5 QA.
- A5 QA Agent — test plans, E2E, smoke, fixtures and signoff evidence. Reviewer LEAD + relevant non-author engineer.
- A6 Desktop & Release Agent — Electron, signed artifacts, platform matrix, upgrade/rollback. Reviewer A5 + LEAD.
- A7 Docs Agent — SOP, changelog, user docs. Reviewer A5 + LEAD.

These are formal **assignments in the backlog**, not a claim that autonomous workers have been launched.

## Required per-task state machine
BACKLOG → READY → ASSIGNED → IN_PROGRESS → IN_REVIEW → QA_VERIFIED → SUPERVISOR_ACCEPTED → DONE.
Side states: BLOCKED, REJECTED, CANCELLED; DONE requires a link to the exact reviewed commit SHA and results.

## Before work
1. Supervisor assigns unique task ID and acceptance tests from CHECKLIST-PLANNER.json.
2. Pin starting SHA, file ownership and dependency conditions.
3. Each Agent uses its own issue and isolated branch/worktree; never concurrent-edit a shared file.
4. Include baseline test result and rollback plan before changing source.

## Developer evidence checklist
- Changed files, diff, upstream/base SHA, code review link
- Unit and typecheck output; integration fixtures for relevant paths
- E2E or smoke evidence on relevant OS, including screenshots if UI-adjacent
- Security negative tests for exposed memory/API changes
- Performance delta (p50/p95/p99 AND Recall@k) for optimization tasks
- Data migration backup and rollback; fallback if Rust/native changes
- No skipped/unknown test shown as a PASS

## Review and merge
- Independent reviewer verifies correctness and threat-model impact.
- A5 reruns relevant tests, confirms unchanged features/UI and documents environment.
- LEAD verifies files, approvals, gates, compatibility and accepted test evidence. If LEAD authored change, another qualified reviewer has to approve.
- Draft PR cannot merge without the checks. Do not merge to main when critical tests fail or have not run.
- Disagreements and blockers stay in GitHub Issues with owner/date and remediation before a release.

## Every feature must pass
1. Unit + integration tests for the changed module
2. Representative E2E/smoke for existing user journey it touches
3. Cross-agent/tenant negative checks for memory access and injection
4. Existing feature parity / screenshots (if UI-adjacent)
5. Crash, restart, migration/rollback if persistent data is involved

Escalation: P0 tenant leak, data corruption, startup regression, lost user features → halt release, flag OFF and restore prior binaries/data.
