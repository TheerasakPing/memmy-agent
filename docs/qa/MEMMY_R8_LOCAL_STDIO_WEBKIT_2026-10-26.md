# Memmy-Agent R8 — Local QA follow-up (2026-10-26)

**Verdict: partial validation, NOT production-ready.** GitHub Actions deliberately excluded from this batch at user request.

## Planner and review by workstream

| Workstream | Executed evidence | Result |
|---|---|---|
| Session/MCP/Skills regressions | 10 Vitest files, including the new real stdio/Skills E2E smoke | **168/168 PASS** |
| MCP actual process E2E | Agent `connectMcpServers` spawns a real JSON-RPC stdio MCP SDK fixture; discovers `mcp_r8_live_r8_echo`, invokes through `ToolRegistry.execute`, checks output and closes connection | PASS |
| MCP child process lifecycle | Repeated the new real MCP stdio/Skills test five separate runs; inspected remaining MCP fixture processes | **5/5 PASS, zero observed orphan fixtures** |
| Skills filesystem E2E | Creates isolated `workspace/skills/r8-smoke/SKILL.md`, discovers and loads the actual Markdown source with `SkillsLoader` | PASS |
| Renderer | Browser WebKit ran startup, nickname, memory-plugin-conflict and JS IPC bridge smoke | PASS, browser WebKit only |
| Native GUI | Native window exists; Screen Recording denied to tunnel worker (`screencapture` cannot create image); Accessibility (`AXIsProcessTrusted`) false | BLOCKED; 14 real WKWebView routes not approved |
| Agent actual model answer | Local Gateway had one configured available preset `zcode/GLM-5.3-Flash`; credential-bearing live test invocation blocked by tool security | NOT PASS |
| 24-hour real soak | Previous short multi-cycle supervisor runs passed; not 24 elapsed hours, nor concurrency against real models | NOT PASS |

## Execution notes

- Worktree: `/Volumes/Data/workspace/git/memmy-agent-r8-validation-20261026`, branch `codex/r8-local-validation-20261026`
- Installed app: `/Applications/Memmy Turbo Preview.app` (not replaced in this batch)
- QA fixture: `App/memmy-agent/tests/core/agent-runtime/fixtures/r8-stdio-mcp-server.mjs`
- Vitest: `App/memmy-agent/tests/core/agent-runtime/r8-live-mcp-stdio-skill.test.ts`

## Gate rules

- This proves a real isolated MCP **transport and registry invocation**, not model-selected tool invocation or a third-party MCP provider.
- No user model key, secret, answer content or private screenshot was copied into the test report.
- The tests allocate unique ephemeral workspaces and clean them, preserving Original Electron and Preview SQLite.
- Native WebKit screenshot/interaction requires macOS Screen Recording and Accessibility permission. Browser WebKit rendering does not replace that gate.
- Real-model answer, 24-hour full-duration stress and independent human code review must all be **PASS** before a Production Release is approved.
- GitHub Actions was **intentionally skipped** and is not a prerequisite for continuing local code/QA work.

## Next independent acceptance

1. Validate a complete successful model turn for **each configured available preset** with explicit authorized credentials in the app UI; verify sessions persist after restart.
2. Let a live agent choose and invoke a real MCP tool and a workspace Skill, with observed tool result.
3. Grant Screen Recording and Accessibility for the connected macOS worker and validate all 14 native WKWebView screens.
4. Complete full 24-hour heavy-agent plus native supervisor soak on a dedicated Mac, retain sanitized logs and independently review the result.
