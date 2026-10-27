# Memmy-Agent R8 — Session Concurrency / Delete Recovery QA
Date: 2026-10-27 (Asia/Bangkok)
Status: source fix tested, not yet installed / production approved.

## Root-cause confirmation
- Old `SessionManager.saveAsync` and synchronous `save` shared the same `<session>.jsonl.tmp` file.
- 16 overlapping asynchronous writes to one chat deterministically triggered `ENOENT` on rename.
- A pending asynchronous write could resurrect a chat after `hardDeleteSession`.
- 48 separate chats persisted successfully; failure focused on same-key races and deletion fencing.

## Fix
- New asynchronous write uses a random unique temporary filename per write attempt.
- Per-chat revision fencing discards stale writes, including those superseded by synchronous saves.
- `delete()` and `hardDeleteSession()` invalidate outstanding asynchronous writes.
- The revision check and final atomic rename execute in the same JavaScript turn.
- All writes use isolated temporary test directories; Original and Preview profiles untouched.

## Checklist / review gate
- [x] Lead audit: source and before-fix failures reproduced.
- [x] Agent Session worker: same-chat async overlap, late deletion, sync-vs-async order fixed.
- [x] QA: independent chat isolation with 48 sessions and restart.
- [x] Regression: 172/172 tests across 11 Session/MCP/Skills files passed.
- [x] Stress repeat: same-chat concurrency test run 10/10 times without failure.
- [x] TypeScript noEmit and git diff whitespace check passed.
- [ ] Independent code review and native packaged runtime acceptance.
- [ ] Real model reply, model-directed MCP/Skill tool calls, 14-route macOS GUI and full 24h heavy stress.
