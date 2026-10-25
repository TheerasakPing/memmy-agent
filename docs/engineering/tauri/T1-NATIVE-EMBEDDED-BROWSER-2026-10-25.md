# Native Embedded Browser — Tauri v2 Child WebView (2026-10-25)

## Checklist Planner / agent ownership

- [x] A1 Source audit: Electron BrowserPanel toolbar and browser lifecycle mapped to Tauri child WebView; original React CSS, routes and tab UI retained.
- [x] A2 Rust Host: create/navigate/back/forward/reload/resize/show/hide/destroy native child WebViews in main Tauri window. UUID handles, max 10 tabs, strict HTTP(S)/about:blank and geometry validation.
- [x] A3 React Adapter: preserve Electron DOM path and use Tauri child native host only inside actual Tauri WebView. Same browser toolbar, history and settings; per-tab lifecycle cleanup and event forwarding.
- [x] A4 Defensive tests: reject special schemes, credentials, spoofed handles and offscreen/nonfinite bounds; remote new-window popups denied; ACL narrowed from parent-window-wide to first-party webview labels (main/pet). Parity script guards against permission regression.
- [x] A5 Local automated QA: Rust 37/37, React native/browser/bridge 28/28, frontend typecheck, Rust cargo check, renderer smoke, bundle fixture audit 3/3, formatting and parity checks.
- [ ] A4 Independent human security review of native WebView isolation, Tauri unstable API, WebKit permissions and redirects.
- [ ] A5 Installed native macOS GUI E2E: navigation, keyboard, screenshots, window resize, tab transitions, sign-in, permissions; Windows 11 x64 and Linux.
- [ ] LEAD Release approval: BLOCKED; releaseReady=false; 24 original bridge methods remain.

## Behavior boundaries

Websites are rendered by a real native child WebView, rather than the Electron webview placeholder. The original React toolbar and 14 routes remain. The runtime deliberately does NOT mint an Electron webContentsId for a native tab (returns 0). Computer Use guest-tab actions are NOT wired by this tranche, and UI does not claim they work.

The default Tauri IPC capability is scoped to first-party webview labels main/pet, not the parent window, because remote browser tabs are child webviews within that OS window. Rust commands additionally require the main Webview caller and a registered random UUID. The browser blocks file/data/javascript/custom URLs, embedded userinfo, unknown popup windows, invalid geometry and rogue tab IDs.

Electron persistent partition cookies, download history/data clearing, user content/cross-site security policies, back/forward accuracy for SPA navigation, and installed multi-WebView behavior have not been proven equivalent. Browser deletion remains blocked by missing native API rather than return fake success. Site Agent Computer Use and interactive Browser surfaces still need independent migration and E2E.

## Local evidence

- Rust: cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib => 37/37 PASS
- Rust: cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml => PASS
- React: NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/native-browser-adapter.test.ts src/pages/tests/browser-panel.interaction.test.tsx src/tests/tauri-bridge.test.ts => 28/28 PASS
- React: npm run typecheck -w @memmy/frontend-desktop => PASS
- React: npm run test:renderer:smoke -w @memmy/tauri-shell => PASS (Chromium preview, not OS-native E2E)
- Bundle: node --test App/shell/tauri/packaging/audit-bundle.test.mjs => 3/3 PASS
- Bridge: node scripts/engineering/tauri-parity.mjs --check => 61/85 methods, 14 routes
- Rust formatting and git whitespace checks => PASS

## Rollback

Stacked on Draft PR #46. Stable Electron runtime remains unchanged. No production merge or claim of 100% until independent review, installed GUI smoke and signed cross-platform bundles.
