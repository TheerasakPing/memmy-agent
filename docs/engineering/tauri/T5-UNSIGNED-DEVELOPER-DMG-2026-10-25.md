# T5 — Gated unsigned macOS ARM64 Developer Preview DMG

## Checklist planner / delegated lanes and lead review

- [x] **A1 Source audit:** prior scripts create-dmg-macos.sh and package-app-macos.sh expect a release Rust executable and ad-hoc signing, but the repository currently contains the actual tested Debug .app, not a release binary. This path must not silently skip existing 84/85 parity and full private Agent dependencies.
- [x] **A6 Developer DMG script:** create-preview-dmg-unsigned.sh uses the most recently built actual Debug Tauri .app with its real bundled Node, Memory, Local API and Agent private provider packages. Creates a distinct named artifact under Git-ignored packaging/out-unsigned so existing production and other candidate installers are not overwritten.
- [x] **A4 Strict pre-package gates:** before running hdiutil, script verifies the real native GUI and bundled Node executable, scans all required Browser Extension and Agent private dependencies via audit-bundle, runs the real bundled Memory CLI smoke and runs full bundled Memory → Backend → authenticated Agent Gateway E2E. Any failing gate aborts packaging. No signing identity or updater private key added.
- [x] **A5 Preflight smoke:** before compression, actual source app bundle audit ok:true/errors:[], compiled CLI smoke ok:true, full bundled Agent E2E ok:true/authenticatedGateway:true/exitCode:0.
- [x] **A3 UI retention:** original React shell, 14 routes, all existing icons and IPC methods preserved. No new Electron fallback or spurious fake drag behavior.
- [ ] **A5 Real compressed DMG artifact:** complete hdiutil create command, hdiutil verify, inspect actual file size and final exit code; update only after observed success.
- [ ] **A5 Mount acceptance:** mount the DMG read-only and re-run full bundle audit / compiled CLI smoke directly on the mounted .app to confirm the distributable image really contains the correct runtime. Detach image cleanly.
- [ ] **A5 Interactive GUI E2E:** open mounted .app on a clean macOS arm64 machine, verify Apple Gatekeeper/security prompts and native WebKit/Browser behavior, and independently inspect Memory/Agent state. Not yet achieved.
- [ ] **A4 Human independent security review:** unsigned DMG must never be promoted to production; verify runtime native addon ABI, supply-chain attribution, install profile isolation and supported legal/publisher signing.
- [ ] **LEAD Production approval:** BLOCKED pending signed/notarized macOS app, Windows/Linux native installers, original native extension folder drag, WebKit/Agent same-context session integration, updater signed feed E2E and full Browser data clear, plus human reviewer. releaseReady=false.

## Reproduce

- Build current native Debug app after packaging Stage using the official checked runtime, preserving all React UI.
- Run: npm run preview:dmg:unsigned:mac -w @memmy/tauri-shell
- Disk image filename: Memmy-Turbo-Tauri-1.2.5-alpha.3-macOS-arm64-UNSIGNED-DEVELOPER-PREVIEW.dmg
- Output directory (intentionally ignored by Git): App/shell/tauri/packaging/out-unsigned/

## Explicit limitation

This DMG is unsigned and unnotarized, so it is a developer test artifact, NOT a macOS production installer. Passing isolated backend E2E is not equivalent to GUI automation nor a complete release audit on clean Windows/Linux machines. Do not merge into production main without independent review.

## Critical packaging lesson

- Testing bundled executables under target/debug/bundle does not prove independence from source checkout. Node may resolve imports from an ancestor node_modules directory outside the .app.
- The first unsigned DMG had a valid checksum and passed its structural audit, yet its mounted Memory CLI failed with a missing @memmy/agent-source-core module because Tauri bundling omitted npm workspace symlink entries.
- Packaging now materializes first-party workspace modules as real files and requires them during bundle audit. The new relocated app smoke runs before the DMG is created and succeeded from outside the source checkout.
- No results from the first incomplete unsigned DMG may be used as evidence of install acceptance.

## Final artifact, test environment and reproducibility

- File: App/shell/tauri/packaging/out-unsigned/Memmy-Turbo-Tauri-1.2.5-alpha.3-macOS-arm64-UNSIGNED-DEVELOPER-PREVIEW.dmg
- SHA-256: d6ddac449b1bd2b0c8dbb4d09314dd925c2aae3b1018cee1b9f1cba03be2443a
- Real source app built 1.79 GiB; compressed read-only DMG approximately 1.3 GiB.
- Workspace module materialization: agent-source-core, knowledge, migrations, local-api-contracts, desktop-interface, memory and backend are real packages in the bundled node_modules, not symlinks that the Tauri packager drops.
- Repeatable strict gate: npm run bundle:smoke:relocated:mac -w @memmy/tauri-shell; this APFS-clones app OUTSIDE the repository, runs real CLI + authorized Agent Gateway without inheriting user login/API keys, and removes the isolated fixture.
- The DMG creation command runs relocation smoke BEFORE image compression. A separately mounted/readonly actual DMG was successfully audited and the CLI/Gateway E2E passed again. Mounted QA used a temporary mountpoint, detached after successful inspection.
- Source Sidecar regression 12/12 PASS from preceding stacked PR, current bundle negative/structural audit 6/6 PASS, and parity scanner still 84/85 bridged with 5 partial plus 1 unported; all 14 React routes intact.
- Not yet validated: macOS Finder native GUI interaction, code signing/notarization, cross-platform Windows 11/Linux native install, real publisher-signed update feed, Native OS folder drag, and shared Agent/WebKit tab control.
