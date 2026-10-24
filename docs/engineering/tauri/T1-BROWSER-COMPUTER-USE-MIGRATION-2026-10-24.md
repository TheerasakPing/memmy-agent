# T1.03 Browser + Computer Use native migration — execution contract

**State:** BLOCKED / NOT PORTED. Existing Electron `<webview>` is not a Tauri browser surface. No fake iframe, `window.open` or no-op bridge passes the feature parity gate.

## Source audited

- `App/frontend/desktop/src/pages/browser-panel.tsx` mounts a live Electron `<webview>` with `getWebContentsId`, navigation/back/forward/reload and DOM events; it also displays browser history and settings and forwards tab IDs.
- `App/frontend/desktop/src/pages/agent-browser-surface.tsx` receives authenticated live capture frames per `sessionKey` and dispatches scoped mouse/keyboard/wheel actions.
- Original Electron main modules enforce access rules, CDP injection controls, embedded browser permissions, site-use policies, saved history, downloads and external extension install. A Tauri-only bridge method stub would bypass these security invariants.

## Technical decomposition (must preserve existing React UX and original routes)

| Subtask | Owner | Independent review | Required proof |
|---|---|---|---|
| B01 Real Tauri child WebView surface tracked to existing Browser Panel physical bounds, tab lifecycle | A4 | A1 | Native WebKit screenshot, tab create/select/close, resize, scroll, focus |
| B02 Explicit browser `sessionKey` / tab ownership and authenticated frame streaming | A4 | A1 | Wrong-session/key rejection, replay fail, capture opt-in and close cleanup |
| B03 Browser history + settings/data management in isolated per-profile store | A3 | A1 | CRUD, size/validation, restart durability, privacy clear and no Electron import |
| B04 Origin/permission/download/policy firewall before navigation/action | A1 | A5 | deny-by-default cross-origin, forged URLs, blocked internal IP/schemes, gesture checks |
| B05 Computer Use with trusted access grants and OS permission checks | A2 | A1 | macOS permission deny/allow, no hidden capture, negative injection tests |
| B06 Chrome/Edge external extension installation and linking | A6 | A1 | integrity/pinned directory, running/browser profile discovery, installer rollback |
| B07 Original React Browser Panel functional E2E and QA | A5 | LEAD | all tab/nav/history/download/use-site flows under real macOS Tauri |

## Guardrails

1. Browser rendering belongs in an OS-owned Tauri WebView. Never allow arbitrary navigation to the Tauri renderer origin, `file:` URLs, localhost service URLs, or Agent bootstrap secrets from arbitrary web pages.
2. Tauri IPC must be limited to **the trusted original React renderer webview**; external pages must not receive `window.__TAURI__` or app-specific grants. Native child WebViews need separate capability/window labels and intercept privilege boundaries.
3. Reuse the original UI and propagate overlay bounds, visibility and focus from React without changing its public route paths or user-facing styles.
4. Preserve token-protected same-user loopback Local API, Memory and Agent supervision and isolated app data; native Browser/Computer Use must never reuse Electron browser profiles by default.
5. A command counts toward the 85-method inventory **only after a real Rust handler, UI contract test, native E2E and security negative tests**. Headless Chromium UI snapshots alone do not qualify.

## E2E / Smoke checklist (gated)

- [ ] Browse to real HTTP(S) page, back/forward, refresh, close/reopen and multiple tabs
- [ ] Correct native view bounds with sidebar resizing and high-DPI scaling
- [ ] Cookies/cache/history/download isolation and clear-data semantics
- [ ] Permission denial/grant, spoofed trusted origin and file/loopback scheme rejection
- [ ] Computer Use screenshot provenance, tab/session proof and action rejection after shutdown
- [ ] New browser context cannot read application credentials, tokens or host filesystem
- [ ] macOS native WebKit GUI screenshot parity, security reviewer, QA and LEAD signatures

All boxes remain unchecked until evidenced by an actual Tauri build. This document is source audit and implementation plan, not completion.
