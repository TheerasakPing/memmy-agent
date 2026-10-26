# Memmy Turbo R8 — Production Acceptance Gates (2026-10-26)

**Status: OPEN. No production certification.** These gates are newly authored on a separate QA branch. macOS desktop tunnel was offline when authored, so **no live provider/model, full native GUI or 24-hour run has been completed** by this work.

## Task assignment / checklists

| Owner / workstream | Evidence required for PASS | Current status |
|---|---|---|
| Agent model test worker | Each **available, configured** preset tested against the actual local Gateway; WebSocket new-chat selects correct model, receives nonempty assistant reply, turn ends, session appears in persisted list; no model silently omitted | Harness written; execution blocked until local Mac and legitimate model access |
| Session worker | Session creation, turn, restart/reconnect, history persistence, multi-session isolation, crash recoverability | Existing focused Vitest tests scheduled in CI; real cross-restart and multi-session manual E2E pending |
| MCP worker | At least one connected actual stdio MCP server and one real tool invocation with audited output; reconnect after service restart | Focused connection/tool tests scheduled; actual desktop invocation pending |
| Skills worker | Load built-in and workspace SKILL.md, invoke a skill from agent, inspect outcome | Loader/regression tests scheduled; full live invocation pending |
| Native GUI worker | All **14** defined routes: actual embedded macOS WKWebView, interactive buttons, Thai and Dark Mode and startup/retry visual | Interactive capture/approval harness written; macOS Screen Recording/Accessibility and human reviewer required |
| Reliability worker | Genuine installed native Rust + 3 services, repeated isolated starts across **24 elapsed hours**, no leaks and no startup failures | 24h soak harness and optional self-hosted workflow ready; **not executed** |
| Lead/reviewer | Reproduce failures, inspect logs without secrets, human independent sign-off | Pending |

## Tests that can run with ordinary GitHub-hosted CI

The new workflow `.github/workflows/r8-acceptance.yml` runs focused session, MCP and Skills regression tests on Ubuntu; on macOS it executes a **short, simulated** contract test of the soak reporter using a harmless fake executable. Neither test proves real provider replies, the user's desktop GUI, or a 24-hour run.

Run workflow by opening the QA PR. Require all its checks green before requesting full platform acceptance.

## Live model-matrix E2E (may incur provider charges)

Only on an authorized Mac with an **isolated test Gateway** and valid local BYOK credentials:

```bash
export MEMMY_R8_REAL_MODELS=YES
export MEMMY_R8_GATEWAY_URL=http://127.0.0.1:PORT
export MEMMY_R8_GATEWAY_SECRET=...    # never paste into logs or PRs
export MEMMY_R8_PRESETS='exact preset A,exact preset B'  # EVERY available configured model
node App/shell/tauri/packaging/r8-live-model-matrix.mjs
```

The script explicitly fails when configured available presets are omitted, when the Gateway rejects the model, if no assistant reply is observed, or if a resulting chat is not persisted. **This does not by itself verify MCP/Skills.** Do not use service boot smoke as a model response PASS.

## Native GUI 14-route validation

After granting the terminal Screen Recording and Accessibility rights, run **on the actual Mac**:

```bash
node App/shell/tauri/packaging/r8-macos-gui-acceptance.mjs
```

A reviewer visits each route using the actual application. The script captures a screenshot of the real Memmy window and requires a human PASS for all 14. It records a local JSON report. Screenshots can contain sensitive data; keep them local and do not attach to public issues/CI. If permissions are denied, the gate **fails** rather than claiming visual parity.

## 24-hour native restart soak

The Mac must remain powered on and have its **installed Preview binary**. Use a dedicated test Mac or an idle approved machine, not the Original live data profile:

```bash
MEMMY_R8_REPORT_DIR=/tmp/memmy-r8-soak-report \
node App/shell/tauri/packaging/r8-macos-soak.mjs \
  '/Applications/Memmy Turbo Preview.app/Contents/MacOS/memmy-turbo-tauri' 24
```

It tests isolated Rust supervisor Memory/API/Gateway startup and stop repeatedly, checks process/temporary-profile leakage, and writes a sanitized `native-soak.json` report. PASS is possible **only after the full 24 hours**. This **is not yet** a continuous real-model-load soak, and cannot certify power-loss, native window, or multi-session reliability. The optional workflow `native-24h-soak` requires an explicitly configured self-hosted macOS ARM64 GitHub runner and manual dispatch.

## Final release criteria — MUST ALL BE PASS

- [ ] Real provider response across all configured available presets
- [ ] Real session restore, multi-session, MCP tool call and Skill invocation
- [ ] All 14 native WKWebView routes and important buttons manually verified
- [ ] Full 24 elapsed hours, zero crashes/hangs/leaks; separate heavy Agent concurrency soak also passed
- [ ] Privacy and security review; original DB rollback and upgrade verified
- [ ] Independent reviewer approval
- [ ] Packaging and notarization, Windows/Linux acceptance if advertised

**Original Electron profile and SQLite are not modified by these scripts**. Do not merge this work as evidence of R8 completion until the above gaps have verified results.
