# Memmy Turbo Tauri v1.2.5-alpha.3 — relocatable macOS ARM64 preview

**Preview/test-only**. This build is **not** Developer-ID signed/notarized; it is not the production replacement for Electron v1.2.4. The existing React UI source and 14 original routes have not been redesigned or removed, but only 16/85 native bridge methods are wired. `releaseReady=false` and independent A1/A5/LEAD signoff is still pending.

## Implemented

- Tauri release-mode supervisor now launches **three real processes** (Memory SQLite, Backend Local API and Agent Gateway) from resources under the installed `.app/Contents/Resources/runtime`, not from Homebrew PATH or repository working directory.
- Node v26.8.2 **official macOS arm64 distribution** downloaded using HTTPS and checked against the pinned upstream SHA-256 `f58e5044b938a3174184de4aaf1d2bbfcfff812e88220ff08e9221c09f5c8677`. Native `better-sqlite3` modules are bundled with matching Node ABI.
- Separate Tauri application-local private data, no automatic Electron import. Ephemeral loopback Memory port and session token, authenticated Gateway and UI Local API.
- A headless test switch `--smoke-native-runtime` invokes the **same release supervisor** from the executable inside the `.app`; creates a uniquely named temporary data folder, starts all three services, verifies readiness, stops them and removes temporary data. It does not access production databases.
- Fixed a real-world macOS path bug: `new URL(...).pathname` mishandled spaces in `Memmy Turbo Preview.app`. Sidecar code now uses `fileURLToPath`, and its smoke tests can run from an app installed to a path with spaces.
- Added packaging scripts to stage the Node+runtime payload and assemble a relocatable `.app` without colliding with normal Tauri build output. `packaging/runtime` and `packaging/out-*` are ignored by Git.

## Mac arm64 local evidence

- Stage runtime `npm run preview:stage -w @memmy/tauri-shell`: PASS; generated 2.1 GB uncompressed payload.
- Source-level Node E2E: 4/4 PASS (Memory, Local API, Agent real process bootstrap).
- `cargo check --locked`: PASS; Rust unit suite 9/9 PASS.
- Bundle assembly: PASS; installed `.app` moved to a directory **outside the repository**.
- **Relocated app's own Node test suite 4/4 PASS**, with spaces in app path.
- **Relocated release binary `--smoke-native-runtime`: PASS**, starts/stops real Memory + Local API + Agent and does not require a developer Node executable.
- `codesign --force --deep --sign -` followed by `codesign --verify --deep --strict`: PASS (**ad hoc only; not Apple Developer ID**).
- `hdiutil create ... -format UDZO`: PASS; generated macOS arm64 `.dmg` of approximately 1.3 GB.
- **Read-only mounted DMG `--smoke-native-runtime`: PASS** (true packaged offline Memory + API + Gateway startup/shutdown; no developer workspace fallback). This is a backend lifecycle acceptance test, not a visual GUI acceptance test.
- Still missing: automated GUI screenshot/complete feature parity, notarization and Developer-ID signing, clean Windows 11/Linux installer builds, external security QA and mainline CI (#26).

## Reproduce on a developer Mac

Prerequisites: build-compatible macOS arm64 Node 26.8.2 native addons, Rust/Tauri, full npm install and built Memory/Backend/Agent. The packager downloads only Node from pinned official URL; third-party dependencies are taken from the local installed workspace, not downloaded at app startup.

```sh
npm run memory:build
npm run build -w @memmy/backend
npm --prefix App/memmy-agent run build
npm run tauri:build -w @memmy/tauri-shell -- --debug --bundles app
cargo build --locked --release --features tauri/custom-protocol --manifest-path App/shell/tauri/src-tauri/Cargo.toml
npm run preview:stage -w @memmy/tauri-shell
MEMMY_TAURI_PACKAGE_OUTPUT="$PWD/App/shell/tauri/packaging/out-qa" npm run preview:app:mac -w @memmy/tauri-shell
```

To build an **ad-hoc signed, NOT notarized** DMG with an enforced headless runtime smoke gate, run `MEMMY_TAURI_PACKAGE_OUTPUT="$PWD/App/shell/tauri/packaging/out-qa" npm run preview:dmg:mac -w @memmy/tauri-shell`. Test app from a different folder containing spaces using:

```sh
'<path>.app/Contents/MacOS/memmy-turbo-tauri' --smoke-native-runtime
```

**Release blockers:** 69 remaining native bridge methods, browser/pet/tray parity, CSP currently `null`, agent tool permissions and R1/R2 security approval, full functional native GUI QA, support and installer signing on three OSes. Users must not migrate real Electron data or use sensitive profiles in this Preview. Roll back by using Electron v1.2.4; the Tauri app has a separate bundle ID and data directory.
