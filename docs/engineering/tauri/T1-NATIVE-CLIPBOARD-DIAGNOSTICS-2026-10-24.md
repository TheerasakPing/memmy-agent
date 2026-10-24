# T1 native clipboard + diagnostics tranche (54/85 staged)

## Checklist planner — task ownership

- [x] **A1 source audit:** match original Electron preload `copyImageToClipboard` and `exportDiagnosticsReport` contract; confirm Settings page and chat image actions call the unchanged React interface.
- [x] **A6 implementation:** invoke Rust/Tauri v2 commands `desktop_copy_image_to_clipboard` and `desktop_export_diagnostics_report`; register native OS clipboard plugin, reuse user-confirmed Save Dialog. Keep existing 14 routes and CSS unchanged.
- [x] **A4 security cases authored:** restrict both commands to the main webview; require renderer-supplied bytes (no privileged URL fetch); 64-MiB transport limit and image magic-byte checks; decoded image dimensions max 4096x4096 and memory allocation cap; diagnostic report allowlists only version/platform/architecture/child registration flags with no secrets, URLs or local paths.
- [x] **A5 automated suite:** Rust tests for actual PNG decoding, invalid image, redacted report; React bridge serialization tests; Rust fmt, TypeScript, source parity checks. Individual result counts recorded in PR.
- [ ] **A4 independent review:** review native clipboard permissions, image decompression, panel intent, failure-mode handling, file save collision semantics.
- [ ] **A5 native installed-app GUI E2E:** copy PNG/JPEG/GIF/WebP to system clipboard and paste in real apps, preview cancel/save; Windows 11 x64/Linux platform and real macOS WebKit automation still pending.
- [ ] **LEAD release approval:** withheld until independent QA and signed installers complete.

## Local validation results (macOS arm64)

- Rust `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib`: **29 passed**, including 2 new decoding/privacy tests.
- React bridge + Pet page Vitest: **66 passed**.
- `npm run typecheck -w @memmy/frontend-desktop`: **passed**.
- `npm run sidecar:test -w @memmy/tauri-shell`: **4 passed**.
- `npm run bundle:audit:test -w @memmy/tauri-shell`: **2 passed** (fixtures only, not production installer audit).
- `npm run test:renderer:smoke -w @memmy/tauri-shell`: **3 passed** (Chromium renderer, not native Tauri WebKit).
- `node scripts/engineering/tauri-parity.mjs --check`: **54/85** and 14 original React routes.
- Rust compile initially reported a non-exhaustive `image::Limits` constructor; fixed using `Limits::default()` and reran Rust tests successfully.

## Behavior and boundaries

- Unlike the old Electron main process, **URL-only copy still errors explicitly** when the authenticated React fetch does not supply bytes.
- Registration of Memory/Local API/Agent child is not equivalent to a live health check; diagnostics report labels this clearly, and deliberately omits private paths and user configuration.
- Native Rust clipboard access is intentionally limited to write-image commands. No arbitrary renderer clipboard read capability was added.
- **54/85 methods wired, 31 remain**, and neither method count nor targeted tests proves total functional parity.
- Stacked on PR #42; do not merge this tranche to production or remove Electron rollback until release QA approves.
