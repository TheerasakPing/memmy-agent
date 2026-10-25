# T5 — Real Rust NativeRuntime supervisor acceptance in the relocatable macOS package

## Planner / agent lanes / release lead checklist

- [x] **A1 source audit:** Previous unsigned macOS DMG release acceptance covered `node` sidecar Memory/Backend/Agent Gateway and tested a read-only mounted .app. However an independently launched Rust `NativeRuntime` supervisor had not been incorporated in the repeatable relocated package gate. React invokes `desktop_runtime_config`, which delegates to the Rust supervisor and must manage all 3 subprocess lifecycles itself.
- [x] **A6 Rust integration QA:** Existing Tauri native Rust binary has explicit `--smoke-native-runtime` headless test mode in `main.rs`. It derives actual package `Contents/Resources/runtime`, uses an isolated temporary data directory, calls the real NativeRuntime `.config()` and then `.stop()`, and only exits zero if all Memory, Local API and Agent Gateway loopback listeners become ready.
- [x] **A4 security harness:** New `smoke-macos-native-supervisor.mjs` first checks actual .app integrity and a regular non-symlink GUI executable, spawns the REAL native Mach-O ARM64 Rust app in the headless smoke mode (not through a shell), with an allowlisted environment and disposable data/cache/HOME. It requires both exit 0 and the Rust `PASS: packaged Memory + Local API + Agent Gateway start/stop` marker. Timeouts close the test process group; missing/failed Runtime cannot be marked passed.
- [x] **A5 current-source native binary acceptance:** running `npm run bundle:smoke:native:mac -w @memmy/tauri-shell` from the actual PR #68 `.app` passed: ok:true, nativeStartedAndStopped:true, exitCode:0, timedOut:false.
- [x] **A5 read-only mounted DMG native binary acceptance:** mount the VERIFIED checksum Disk Image, run the same native Rust supervisor smoke DIRECTLY from the mounted `.app`, verify actual Rust start/stop, and detach. Exit 0, `nativeStartedAndStopped:true` observed.
- [x] **A5 relocation gate strengthened:** `bundle:smoke:relocated:mac` now runs (1) structural audit, (2) real Memory CLI, (3) real bundled Agent Gateway E2E and auth, (4) real Rust supervisor Memory+Backend+Gateway start/stop, on an independent APFS-cloned .app outside the repo. New result includes `nativeRustSupervisor:true` and `authenticatedGateway:true`; full relocated run PASS.
- [x] **A5 automatic mounted DMG gate:** new `smoke-mounted-dmg-macos.sh` mounts the actual checksum-verified DMG read-only in an isolated temporary mountpoint; requires built-app integrity, real packaged Memory CLI, real authenticated Agent Gateway E2E and real Rust supervisor start/stop, then detaches the disk. Integrated into `preview:dmg:unsigned:mac` after `hdiutil verify`; repeatable `npm run bundle:smoke:dmg:mac -- <repo-relative-DMG>` command PASS on actual PR #68 DMG (`exitCode:0`, `nativeStartedAndStopped:true`, `authenticatedGateway:true`). This means future new preview DMGs cannot report successful packaging before mounted Runtime acceptance.
- [x] **A3 frontend/UI retained:** 84/85 Electron preload API methods bridged; 5 partial native behaviors + 1 unported native drag; all 14 original React routes, appearance and buttons remain unchanged. This branch only augments the build acceptance gates, not visual UI or Electron behavior.
- [ ] **A5 Native interactive GUI E2E:** still unverified. Existing logged-in Mac user has a running Memmy installation, and Foundation `NSHomeDirectory()` resolves to the real user directory even after setting `HOME` to a temporary directory. We intentionally DO NOT launch a new GUI instance and risk creating/modifying a real user profile; requires a dedicated clean macOS test account/machine and explicit test isolation or sandbox before claiming click/navigation acceptance.
- [ ] **A5 Windows 11 x64/Linux Native Runtime/GUI:** not run here; cross-platform native build and installed acceptance remain release gates.
- [ ] **A4 independent human reviewer:** security review of native runtime path resolution, scoped IPC and supply-chain/installer files pending.
- [ ] **LEAD production release:** blocked by original native folder drag, Agent-WebKit same-tab/session Computer Use, full selective Browser data clearing, genuine signed Update feed, signed/notarized Mac installer, Windows/Linux GUI E2E and human approval. `releaseReady=false`; Draft PR stacked on #68.

## Repeatable commands

- `NODE_OPTIONS=--no-experimental-webstorage npm run bundle:smoke:native:mac -w @memmy/tauri-shell`
- `NODE_OPTIONS=--no-experimental-webstorage npm run bundle:smoke:relocated:mac -w @memmy/tauri-shell`
- `NODE_OPTIONS=--no-experimental-webstorage npm run bundle:smoke:dmg:mac -w @memmy/tauri-shell -- App/shell/tauri/packaging/out-unsigned/Memmy-Turbo-Tauri-1.2.5-alpha.3-macOS-arm64-UNSIGNED-DEVELOPER-PREVIEW.dmg`
- `NODE_OPTIONS=--no-experimental-webstorage npm run bundle:audit:test -w @memmy/tauri-shell`
- `NODE_OPTIONS=--no-experimental-webstorage npm run test:renderer:smoke -w @memmy/tauri-shell`
- `node scripts/engineering/tauri-parity.mjs --check`

## Important distinction

This test fully exercises the ACTUAL signed-code-capable Rust Tauri native Runtime start/stop process in headless mode on an unsigned Developer Preview. It DOES NOT assert that a GUI window was shown or interacted with. The unsigned DMG is not a production, notarized or signed installer. Do not merge production main until the remaining release gates pass.
