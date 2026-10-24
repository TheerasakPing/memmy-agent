# T1.03 Browser Use site-policy bridge — stacked delivery (43 / 85)

## Checklist planner and owners

- [x] **A3 implementation:** explicit Rust Tauri commands `getBrowserUseSitePolicies`, `upsertBrowserUseSitePolicy`, `removeBrowserUseSitePolicy` wired to the existing React bridge; no React route/layout/CSS changes.
- [x] **A1 security negative tests (automated):** reject file/javascript origins, embedded paths and credentials, invalid decisions, forged symlinks, corrupt JSON, duplicate canonical rules and unexpected host wildcards. Enforce 200 entries / 128 KiB and atomic fsync+rename store.
- [x] **A2 Agent integration check:** Rust owns `$MEMMY_TAURI_DATA_DIR/browser-use/site-policy.json`, the same path that the supervised Agent reads through `MEMMY_AGENT_DATA_DIR`; Agent's existing reader uses the version 1 `{version:1,rules:[]}` document and fails closed on malformed records.
- [x] **A5 local verification:** Rust 20/20 PASS, frontend TypeScript check PASS, React Bridge + Browser Use Site Policy interactions 19/19 PASS, Agent reader tests 8/8 PASS, parity manifest script 43/85 PASS. These tests establish store and renderer contracts, **not GUI browser feature parity**.
- [ ] **A1 separate peer review:** pending read-only review findings; must document before merging.
- [ ] **A5 E2E:** real native Tauri embedded browser action, domain prompt and actual Computer Use CDP request are NOT certified; do not claim working browser automation from these storage tests.
- [ ] **LEAD delivery signoff:** blocked until browser security path and tests are independently reviewed. Keep `releaseReady=false`.

## Security and functional constraints

Rules accept bounded canonical `http(s)` exact origins and the conservative `*.`/`**.` hostname prefix subsets. The full original JavaScript pattern grammar (interior hostname globs and special encodings) is not yet ported; UI may reject such pre-existing inputs. This is a **known compatibility limitation**, not a complete 1:1 Browser parity certification.

Permissions are persisted in the same file consumed by the Agent; no arbitrary renderer filesystem path is accepted. Site-policy changes do not replace the separate, still-unported global allow-all approval, embedded webview navigation, downloads, CDP permissions dialog or external extension lifecycle. Do not enable unsafe fallback or assume permissions are active in an unimplemented embedded browser.

## Reproduce

```sh
node scripts/engineering/tauri-parity.mjs --check
cargo fmt --check --manifest-path App/shell/tauri/src-tauri/Cargo.toml
cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml
npm run typecheck -w @memmy/frontend-desktop
npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/pages/tests/browser-use-site-policies.interaction.test.tsx
npm --prefix App/memmy-agent exec -- vitest run tests/core/agent-runtime/tools/browser-use-site-policy-store.test.ts
```

Rollback: omit the stacked PR; the existing Electron main process and GUI are unchanged. Preview Tauri data is isolated from Electron user data. Do not migrate production profiles.
