# T1 — Native Save File / Save Image (52/85 staged)

## Checklist Planner and independent gates

- [x] **A1 source mapping:** original Electron preload contracts (`DesktopImageActionRequest` / `DesktopImageSaveResult`) remain unchanged; React pages/CSS/routes remain byte-identical.
- [x] **A6 Rust implementation:** two real Tauri commands `desktop_save_file` / `desktop_save_image` route through user-visible native Save Dialog; no arbitrary destination path accepted from renderer.
- [x] **A4 threat controls authored:** only main WebView may initiate; 1 byte–64 MiB buffered payload; sanitized basename; PNG/JPEG/GIF/WebP magic-byte sniffing for image export; atomic sibling-temp write; existing symlinks replaced rather than followed on Unix. No remote arbitrary network fetch from privileged Rust.
- [x] **A5 automated tests:** 4 added Rust unit/negative tests plus React bridge IPC typing/array serialization checks. Exact command and test evidence recorded below.
- [ ] **A4 independent human/security review:** destination path TOCTOU and Windows replacement behavior; file picker UX with a real native WebView, agent attachments, cancellation, save and image preview.
- [ ] **A5 Windows/Linux GUI E2E:** not run; signed production installers not validated.
- [ ] **LEAD signoff:** blocked. Full Tauri native parity and production release are not yet achieved.

## Scope limitations

- **URL-only requests are not supported yet:** native Rust requires renderer-provided bytes and emits an explicit failure when only a URL is passed; authenticated Gateway media retrieval and arbitrary CORS-safe image export remain a future tranche. The existing React attachment flow fetches bytes first when accessible; remote-only fallback remains incomplete.
- On Windows, atomic rename may refuse to replace an already-existing destination; the user should select a new filename. Full existing-file overwrite parity is not claimed.
- Saving a file is never reported as successful after a cancelled picker, invalid bytes, unsupported image encoding or a failed write. No automatic private data export is enabled.
- Method inventory **52/85 wired, 33 outstanding**; 14 React routes unchanged. Inventory is API wiring only, not E2E feature certification.

## Rollback

This change is only in the Tauri Rust host, bridge, tests and parity documentation. Original Electron preload/runtime is untouched. The previous 50/85 Tauri branch remains available as rollback. Keep `releaseReady=false` until independent QA and cross-platform installed-application checks pass.
