# Tauri v2 runtime bundle integrity gate — PR #61 (2026-10-25)

## Checklist planner / delegated lanes

- [x] A1 Source Audit: Tauri runtime staging copies `node_modules`/workspace package links with rsync; macOS installed app must NEVER depend on absolute build-host paths, broken links or workspace paths outside the bundle.
- [x] A4 Security: `auditBundleSymlinks` recursively walks the packaged runtime and browser extension, checks all real symlink destinations stay inside the canonical bundle root, rejects broken and host-escaping links without traversing symlink directories, caps work at 250000 entries and reports bad paths.
- [x] A5 Negative tests: synthetic isolated package fails on external host symlink, missing runtime and broken workspace symlink, but accepts an internal staged workspace link. Existing required runtime / compiled Memory CLI / exact MV3 extension bundle gate retained.
- [x] A5 Local `npm run bundle:audit:test -w @memmy/tauri-shell`: 6/6 PASS; Node versioned packaging script SHA256 verifies 26.8.2 release binary before staging.
- [x] A5 **Real runtime stage**: preview:stage PASS, RUNTIME_STAGE_FIXED_EXIT:0 on connected macOS arm64. Official Node 26.8.2 tarball downloaded and SHA-256 verified; final staged dependency tree passed symlink integrity audit.
- [x] A5 **Real staged CLI execution**: compiled Memmy Memory CLI entrypoint executed with staged Node, isolated temporary MEMMY_HOME and --help, printed CLI version 2.1.7 and actual commands, STAGED_CLI_EXIT:0.
- [x] A6 **Packaging speed fix**: removed duplicate copy of App/memmy-agent/node_modules from external checkout; creates an internal relative symlink to the one staged dependency tree instead.
- [x] A5 Real unsigned macOS ARM64 Tauri Developer Preview .app built with original React production renderer and staged runtime; TAURI_MAC_DEBUG_APP_BUILD_FIXED_EXIT:0.
- [x] A5 Real .app Bundle Audit PASS: ok:true, errors:[], native Mach-O arm64 binary, bundled Node, Memory CLI, Agent/Backend and MV3 Browser Extension present.
- [x] A5 Real .app CLI Smoke PASS: bundle:smoke:mac exit 0 after executing actual bundled Memory CLI with temporary HOME and MEMMY_HOME.
- [ ] A5 signed/installed macOS app GUI E2E, Windows 11 x64 and Linux resource/installer GUI E2E. Actual runtime stage and CLI verified, but installed GUI remains untested.
- [ ] A4 independent code/security review, including Node binary provenance/ABI, optional `npm` dependencies, symlink TOCTOU and accidental secret inclusion.
- [ ] LEAD release signoff blocked on full native GUI/Computer Use context parity, original 7 remaining APIs and signed installers; `releaseReady=false`.

## Security boundary

Relative symlinks inside the bundle remain allowed because npm workspaces use them legitimately. Any symlink that resolves to the developer checkout or outside the `.app` is rejected before release, as are broken links. This guard does not itself rebuild or digitally sign external runtime dependencies; actual complete runtime staging, final executable/macOS Gatekeeper and native GUI E2E are distinct required acceptance gates.

## Reproduce

- `NODE_OPTIONS=--no-experimental-webstorage npm run bundle:audit:test -w @memmy/tauri-shell`
- `NODE_OPTIONS=--no-experimental-webstorage npm run preview:stage -w @memmy/tauri-shell` (macOS arm64, official SHA256 verified Node 26.8.2)
- `node App/shell/tauri/packaging/audit-bundle.mjs /path/to/Memmy\\ Turbo\\ Preview.app`

## Rollback

Draft PR stacked on #60; no React UI/routes or Electron original shell changed. API parity stays 78/85 (the change is additional release safety, not fake method coverage).

## Actual staged runtime evidence

- First attempt found two large node_modules sources linked to an older workspace; stopped duplicate copy safely.
- Fixed staging completed without external or broken symlinks; final Agent dependency link resolves within the staged bundle.
- The staged Memory CLI ran under the bundled Node runtime with a temporary isolated data directory; no user shell profiles were changed.
- This is NOT equivalent to a signed or installed .app GUI E2E acceptance.

## Built macOS Developer Preview (unsigned, not installed GUI acceptance)

- Generated path: App/shell/tauri/src-tauri/target/debug/bundle/macos/Memmy Turbo Preview.app
- First React build failed because required public legal-origin environment settings were absent. Retry used the already documented Memmy legal HTTPS origins; the React production build and Tauri debug app bundle passed.
- Output is a 1.00 GiB unsigned macOS arm64 application, confirmed Mach-O 64-bit arm64 binary.
- Real artifact passed native bundle integrity and isolated bundled Memory CLI smoke; this does NOT constitute interactive native WebKit GUI E2E.
- Remaining release gates: code signing and notarization, Windows and Linux builds, Native WebKit GUI clicks, Agent same-context Computer Use and the final seven preload methods.
