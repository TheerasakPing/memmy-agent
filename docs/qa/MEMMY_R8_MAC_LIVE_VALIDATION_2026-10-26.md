# Memmy-Agent R8 — macOS live validation evidence (2026-10-26)

**Release verdict: NOT COMPLETE / production gate NOT PASSED.** This records tests executed on the connected Mac after reconnecting the Nexora MCP Studio Tunnel Client. The application remains an internal Developer Preview.

## Actual Mac and scope

- Repository worktree used for QA: `/Volumes/Data/workspace/git/memmy-agent-r8-validation-20261026`, based on `fix/r8-acceptance-hardening-20261026`.
- Installed application used for native checks: `/Applications/Memmy Turbo Preview.app`.
- Isolated test profiles only: native Rust `--smoke-native-runtime` allocates temporary profiles, separate from Memmy Original and the active Preview database.
- Local GUI main window exists and installed Memory, Backend and Gateway child processes were observed.
- One model preset was listed as available by **authenticated local Gateway settings preflight**: `zcode/GLM-5.3-Flash`. It was **not** certified to produce a real assistant reply, because direct credential-bearing E2E execution was blocked.

## Checklist / coordinator QA evidence

| Workstream | Evidence | Status |
|---|---|---|
| R8 harness fixtures | `node --test App/shell/tauri/packaging/r8-live-model-matrix.test.mjs`: 5/5 tests pass (success, omitted preset, progress-only rejection, delayed persistence, duplicate preset rejection). | PASS, fixtures only |
| Session/MCP/Skills regressions | Nine targeted `vitest` files in `App/memmy-agent`: **166/166 tests passed**. Includes session binding, turns, fsync, history, MCP connection/tool adapter, Skills loader, MCP preset runtime and Office skills. | PASS, automated tests |
| Native sequential supervisor soak | One ~14-second run, 2/2 isolated Rust/Memory/API/Gateway cycles with zero observed leaked temporary profiles/processes. Then a separate ~54-second run of 6/6 cycles (p95 4707 ms) with zero failures/leaks. | PASS, short sampled runs only |
| Native parallel supervisors | Three simultaneous isolated `--smoke-native-runtime` runs: **3/3 passed** in about five seconds total. | PASS, supervisor only |
| macOS GUI | CoreGraphics sees the installed Memmy Turbo Preview window. `screencapture` responds `could not create image from display` and fails; Accessibility automation also unavailable. | BLOCKED: no 14-route native GUI interaction signoff |
| Real model responses | Local authenticated Gateway preflight returned HTTP 200 for `/webui/bootstrap` and `/api/settings`; one configured available model was enumerated. Sending the live E2E invocation that would use Gateway credentials was blocked by tool safety. | BLOCKED: no real provider response or session persistence E2E |
| Real MCP/Skills end-to-end | The Agent registry and Skills loader passed focused tests. A distinct real stdio fixture integration run was not completed because the requested remote tool action was blocked. | PARTIAL: no live Agent tool/skill invocation |
| GitHub R8 CI | `r8-acceptance.yml` reports `active`, Actions permissions endpoint reports `enabled=true`, **but** dispatch returns HTTP 422: `Actions has been disabled for this repository`. No R8 runs/checks are exposed. | BLOCKED: CI unavailable despite conflicting settings |
| Full 24-hour stress | The scripts exist and short native cycles passed; **24 elapsed hours have not been run** and the harness only covers repeated isolated supervisor starts, not heavy live-model concurrency. | NOT STARTED / NOT PASSED |
| Independent production review | No independent signoff, notarization or complete original feature parity evidence. | PENDING |

## Lead review and action owners

- **Agent worker:** execute real model-matrix test through an authorized local app/UI connection without exporting credentials, verify nonempty assistant reply and on-disk session across restart, then test live MCP tool and a Skill.
- **GUI worker:** enable macOS Screen Recording/Accessibility for the testing terminal, then run `r8-macos-gui-acceptance.mjs` and validate all 14 routes and interactive controls.
- **Reliability worker:** execute 24 full hours on a dedicated stable Mac; separately test multi-session load, sleep/wake, force-kill and recovery.
- **CI owner:** resolve Actions dispatch HTTP 422 without changing repository security defaults blindly, then run `r8-acceptance.yml` and attach actual job logs.
- **Independent lead/reviewer:** inspect the above artifacts before removing Draft/Release blockers. **No reviewer has approved production.**

## Safety

No Original user data or DB was modified by these tests. No Gateway secrets, model responses or GUI screenshots were stored in this report. Disposable test worktree was created separately; the existing development branch and installed Preview app remain intact.

**Important:** PR merge is not equivalent to a passing release gate. Do not mark R8 complete without real external-provider responses, actual native GUI evidence, a full 24-hour test, and independent review.
