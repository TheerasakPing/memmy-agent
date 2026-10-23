## Memmy Agent Turbo — PR Acceptance Checklist

**Task / Issue IDs:**  
**Owner Agent role (A1–A7):**  
**Independent Reviewer (not the author):**  
**QA verification (A5 or independent substitute):**  
**Supervisor / LEAD:**  
**Pinned base commit:**  

### Feature parity and safety
- [ ] The original Memmy UI (theme, fonts, routes, layouts, shortcuts, Pet, Browser, Settings) is unchanged. Any intentional change has separate product approval.
- [ ] Original Desktop, Memory, Agent, CLI, Hooks, Plugins, Computer Use and upgrade workflows are not regressed.
- [ ] Memory/SQLite data change, if any, has backup, upgrade, rollback and read-after-restart proof.
- [ ] Tenant, namespace, API key and prompt-injection implications have been reviewed.
- [ ] Optional Rust/advanced-memory features default OFF and safe fallback works.

### Evidence — do not check if not run
- [ ] Typecheck / lint `command, environment, SHA, exit code`:
- [ ] Unit and integration `command, logs, results`:
- [ ] E2E / smoke on affected OS and relevant package:
- [ ] Screenshot parity if UI-adjacent:
- [ ] Performance / Recall@k if retrieval changed:
- [ ] Security negative paths if auth/memory changed:
- [ ] Rollback and fatal failure handling:
- [ ] CI run URLs with complete pass/fail/skipped status:

### Reviews and release
- [ ] Independent reviewer examined diff and acceptance evidence.
- [ ] QA independently reran relevant cases (not self-approved).
- [ ] Supervisor verified dependency gates and accepted.
- [ ] No outstanding P0/P1 release blocker, unresolved failed gate or skipped mandatory test.

**Unknown / skipped is NOT PASS.** Keep this PR Draft until evidence is attached and QA and Supervisor have accepted the task. Do not merge changes to `main` until the corresponding R1–R5 phase gate is satisfied.
