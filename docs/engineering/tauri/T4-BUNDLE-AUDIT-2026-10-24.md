# T4.01 — Packaging readiness audit (Mac arm64)

**Status: BLOCKED (correctly fail closed)**. The existing `Memmy Turbo Preview.app` is a valid Tauri GUI-only debug bundle, **NOT** a self-contained user-installable app.

A repeatable audited contract is implemented in `App/shell/tauri/packaging/audit-bundle.mjs` and tested in `audit-bundle.test.mjs`. `npm run bundle:audit -w @memmy/tauri-shell -- /path/to/App.app` returns nonzero if required Node, Memory, Local API, Gateway, SQLite addon or shims are not contained in the `.app` resources. This check cannot be replaced by verifying only a GUI icon/executable. **The current real app fails this gate: 8 runtime assets are missing.** The two isolated gate tests pass.

## Next build milestones (A6 owner / A2 runtime / A1 security / A5 QA / LEAD signoff)

1. Build separate signed, relocatable, architecture-matched runtime binary and collect production node modules + native SQLite addons. No Homebrew PATH dependency.
2. Stage `Contents/Resources/runtime` while keeping the same fixed, audited launch entrypoints. Update Rust to resolve app resource paths and eliminate `cfg(debug_assertions)` sidecar-only launch restriction only after signing and validation.
3. Add Tauri build resources specification, immutable content/hash validation, provenance and notarization; ensure no credentials, development `.env`, caches or legacy user databases enter a bundle.
4. Run the **real installed bundle** offline and online after moving it outside the repository, verify child start, real Memory + Local API + Gateway, denied remote origins, graceful shutdown, no process leaks, crash recovery and app-data isolation.
5. Repeat per architecture on Windows 11 x64 and Linux and independently review all 85 bridge APIs, original UI/E2E. CI actions issue #26 blocks trusted cross-platform automation.

Do not publish an unsigned GUI-only build as a functional installer. This phase has **implementation evidence for packaging gate**, not standalone runtime delivery. Electron v1.2.4 is unaffected.
