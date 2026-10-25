# T2 — Signed Native Tauri Updater (83/85 wired; 4 incomplete behaviors)

## Checklist planner / source audit / independent release gates

- [x] **A1 Source audit:** Electron update flow uses cloud JSON envelope and platform-specific .dmg/.exe download; native Tauri previously returned `not-configured` and had no real progress or install methods. Tauri Plugin Updater v2 verifies Minisign/Ed25519 signature of downloaded updater archives, requires signing keys and target-specific release files. The original React UpdateCoordinator uses check, download/openInstaller and progress callbacks.
- [x] **A2 Rust implementation:** added native Tauri Updater plugin and first-party `main` WebView Rust check/download/install commands. Trust settings are COMPILE-TIME only: MEMMY_TAURI_UPDATER_PUBLIC_KEY, MEMMY_TAURI_UPDATER_ENDPOINT, MEMMY_TAURI_UPDATER_CHANNEL=preview|stable, optional MEMMY_TAURI_UPDATER_ASSET_ORIGIN. No keys or endpoints are invented or committed; without all required settings native update check explicitly returns `not-configured`. Alpha builds reject stable channel and vice versa.
- [x] **A4 URL/authenticity:** manifest and artifact URLs restricted to configured HTTPS origin with no credentials, redirects are rejected at HTTP client. A native plugin manifest check alone never authorizes a renderer-supplied URL: download validates exact version and downloadUrl against the Rust-retained Update object before requesting bytes. The updater plugin verifies signed package bytes before any staging, and progress caps at 99% until signature verification and local staging succeed.
- [x] **A6 real stage/install path:** signed bytes are written as Rust-generated UUID files in an app-owned private update directory, using exclusive create and user-only permissions on Unix, SHA-256 for local tamper evidence, strict file type/size bounds and real path equality. Install invokes the plugin's authenticated `Update::install(bytes)`, not shell/open arbitrary user path. Atomic in-memory flags reject duplicate concurrent downloads and installs. No generic executable from React.
- [x] **A3 React unchanged:** old `checkForUpdates`, `downloadUpdate`, `onUpdateDownloadProgress`, and `openUpdateInstaller` used by original UpdateCoordinator now call typed named native Rust methods and native event. All 14 routes, original styles, dialogs and Electron fallback remain unchanged.
- [x] **A5 unit tests:** new fail-closed signed updater checks, channel isolation, disallowed URL schemes/hosts, exact metadata matching, replay/concurrent install guard, staged-file tamper/symlink detection, progress semantics. Rustls crypto provider regression discovered because introducing updater shares reqwest/rustls with Memory Export; explicitly installed one consistent Rustls ring provider in the Memory Export client and verified existing loopback HTTP test again.
- [x] **A5 local automated QA:** Final Rust library 74/74 PASS (updater-focused 7/7 PASS); locked Rust compile and fmt PASS; React bridge + UpdateCoordinator 13/13 PASS; frontend TypeScript exit 0; renderer smoke 3/3 PASS; bundle audit 6/6 PASS; original React routes 14 unchanged.
- [x] **A5 parity scanner:** 83/85 callable native methods; four PARTIAL_NATIVE_FUNCTIONALITY (signed updater trio and selective clear), two NOT_MIGRATED, so six remain incomplete in full behavior; 14 original React routes unchanged. This is NOT production-ready 97.6%.
- [ ] **A5 signed release E2E:** no actual public signing key, privately signed .app.tar.gz/.nsis.zip updater package or production release endpoint configured. No package was downloaded or installed in real end-to-end testing; do not claim success. Need signed release fixtures and legitimate publisher key provisioned by repo owner, with key rotation policy.
- [ ] **A4 security review:** plugin currently buffers the downloaded artifact in memory before verifying signature, so current 512MiB cap is checked post-download. This needs stronger streaming/fail-fast byte cap against trusted endpoint denial-of-service before enabling production updater; redirect and origin policies should receive independent review. Reboot/restart install behavior must be verified.
- [ ] **A5 native installed GUI:** signed macOS app installer and notarization, Windows 11 x64 NSIS/MSI and Linux AppImage interactive update/rollback and restart tests; full updater status including prepared artifact after app relaunch remains pending.
- [ ] **LEAD release:** BLOCKED. Remaining unwired original APIs are `dragBrowserExtension` and `copyEmbeddedBrowserTabMention`, plus partial Browser Data Clearing, partial Updater methods, Native WebKit vs Agent Playwright shared Computer Use context and cross-platform installed GUI acceptance. releaseReady=false.

## Required release signing configuration

These are build-time **PUBLIC** values (do not store private signer keys in app/repo):

```sh
MEMMY_TAURI_UPDATER_CHANNEL=preview   # or stable, must match app prerelease status
MEMMY_TAURI_UPDATER_PUBLIC_KEY='<minisign/tauri public update key>'
MEMMY_TAURI_UPDATER_ENDPOINT='https://<controlled-update-host>/tauri/{{target}}/{{arch}}/{{current_version}}'
# Optional if release asset CDN uses another separately approved HTTPS origin:
MEMMY_TAURI_UPDATER_ASSET_ORIGIN='https://<controlled-asset-host>'
```

- Release endpoint MUST speak Tauri updater v2 signed JSON format, not legacy Electron `{code,data}` envelope. Signed archive must match Tauri updater target, architecture and installer type; ordinary unsigned .dmg/.exe will be refused.
- This branch intentionally does not switch on a release channel without all trusted inputs; `checkForUpdates()` stays `not-configured` in default dev/preview builds.
- `openUpdateInstaller` only accepts a signed update staged by the SAME native process. Prepared installs across app restarts are not yet implemented or claimed supported.
- Full signature/key E2E, streaming memory cap and human review required before releaseReady may become true.

## Reproduction

- `cargo test --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml --lib`
- `cargo check --locked --manifest-path App/shell/tauri/src-tauri/Cargo.toml`
- `NODE_OPTIONS=--no-experimental-webstorage npm exec --workspace @memmy/frontend-desktop -- vitest run src/tests/tauri-bridge.test.ts src/app/tests/update-coordinator.test.tsx`
- `NODE_OPTIONS='--max-old-space-size=4096 --no-experimental-webstorage' ./node_modules/.bin/tsc -p App/frontend/desktop/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/memmy-frontend-r50.tsbuildinfo`
- `NODE_OPTIONS=--no-experimental-webstorage npm run test:renderer:smoke -w @memmy/tauri-shell`
- `NODE_OPTIONS=--no-experimental-webstorage npm run bundle:audit:test -w @memmy/tauri-shell`
- `node scripts/engineering/tauri-parity.mjs --check`

## Rollback

Stacked Draft PR atop #63. No GUI redesign or Electron shell changes, no signer private key or external updater URL hardcoded in this PR. Keep main unchanged until independent reviewer approval and signed native E2E.
