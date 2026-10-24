# T1.02 — Native Pet Window Drag parity increment (50/85 staged)

## Planner / task assignments

- [x] **A6 implementation** — `startPetWindowDrag(pointer)` saves scaled grab offset; `movePetWindow(pointer)` reads the actual OS cursor, identifies the monitor containing it and moves the Tauri pet webview; `stopPetWindowDrag()` removes the active drag state. Exactly the existing React renderer API is used. No React routes, pages, CSS or Electron preload modified.
- [x] **A4 OS/window safety cases authored** — prohibit callers other than the pet webview, validate pointer coordinates and window scale, prevent NaN/negative/out-of-bounds input, clamp the resulting floating pet inside the selected monitor including negative-coordinate secondary displays. State changes have a mutex.
- [x] **A5 unit/contract QA on macOS ARM64** — `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`: 23/23 PASS; `npm run typecheck -w @memmy/frontend-desktop`: PASS; `npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/pet-page.test.tsx`: 66/66 PASS; `node scripts/engineering/tauri-parity.mjs --check`: 50/85 PASS. An initial bridge assertion incorrectly expected zero arguments instead of the forwarded undefined optional argument; fixed, retested, PASS. Original React Chromium renderer smoke 3/3 PASS with IPC mapping, which is not native WebKit GUI E2E.
- [ ] **A4 independent native GUI reviewer** (attempted separate Codex CLI review but available ChatGPT-account models were rejected by the CLI; no peer-review signoff) — drag across edges of real macOS/WebKit monitors, click and mouseup outside webview, pet hide/show/fullscreen, accessibility focus and negative dual-monitor origins need actual Mac interactive UI E2E.
- [ ] **A5 cross-platform validation** (GitHub PR #41 currently reports no CI checks) — Windows 11 x64 and Linux native monitor behavior and CI QA are not certified.
- [ ] **LEAD final signoff** — blocked. `releaseReady=false`; existing original React 14 routes retained, but 35/85 bridge methods still unported, and native browser/Computer Use is still incomplete.

## Important behavior limitation

This implementation follows mousemove events dispatched to the React pet document, which is **not equivalent** to Electron's interval-driven global pointer tracking once the pointer exits the pet webview. The starting point is recorded through `startPetWindowDrag`, motion is handled by Rust using the authoritative native cursor and the active monitor, and `stopPetWindowDrag` ends the session. Native integration/screenshot evidence is mandatory before claiming full Pet UX parity; the 50/85 count is **API wiring**, not end-to-end feature certification.

## Rollback

The pull request is stacked on PR #40 and targets only the Rust Tauri shell and its existing React bridge. Reverting this branch retains the prior 48/85 snapshot and does not modify the established Electron app or user's on-disk databases.
