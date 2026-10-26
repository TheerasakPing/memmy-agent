# R1 — renderer-to-native startup measurements

- Added `desktop_record_startup_mark`: accepts only three named phases and finite elapsed millisecond offsets in [0,300000], only from `main` WebView.
- Opt-in only when `MEMMY_TAURI_PROFILE_STARTUP=1`; appends to Preview-local `startup-performance.log`, never writes to Original and does not accept arbitrary paths or messages.
- React calls the Tauri IPC handler after `performance.mark` for module-loaded, first DOM frame, and ready-route frame; errors are nonblocking.
- Test evidence: frontend TypeScript `tsc --noEmit` PASS; Rust `native_runtime::tests` 8/8 PASS; renderer timing unit tests 2/2 PASS.
- **Not yet installed**, measured with new IPC enabled, or verified by full GUI E2E. The metrics are proxies, not true FCP/TTI; no improvement claim.
- The pre-existing unstaged edits to `lib.rs` were deliberately excluded from this commit via a reconstructed index blob.
