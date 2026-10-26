# T5 — macOS installation blocker: broken resource signature and missing Developer ID / notarization

## Source audit and facts verified on connected macOS ARM64 (October 25, 2026)

- [x] **A1 inspect exact built Developer Preview (PR #69):** `.app` Mach-O arm64, `CFBundleIdentifier=com.theerasakping.memmy.turbo.preview`. The previous Tauri `tauri build --debug --no-sign` generated `Signature=adhoc`, `TeamIdentifier=not set`, `Sealed Resources=none`. This is a linker signature, **not a sealed installable app signature**.
- [x] **A1 actual macOS rejection:** `/usr/bin/codesign --verify --deep --strict` failed (exit 1): `code has no resources but signature indicates they must be present`. `/usr/sbin/spctl --assess --type execute` also failed (exit 1). The DMG image checksum had passed; integrity of a disk image does NOT imply Gatekeeper/Code Signing acceptance for its contained app.
- [x] **A1 signing prerequisites:** `/usr/bin/security find-identity -v -p codesigning` returned **0 valid signing identities** on this connected Mac. A genuine public-installation-ready Developer ID+notarized image cannot be produced from this host until the project owner configures Apple's distribution certificate and notarization authorization. Never invent private keys or claim Apple approval.
- [x] **A6 ad-hoc development seal:** Running `/usr/bin/codesign --force --deep --sign - --timestamp=none` on a complete staged `.app` and then `/usr/bin/codesign --verify --deep --strict --verbose=2` succeeded with exit 0. This fixes missing resource sealing for developer testing. However macOS `spctl --assess --type execute` then still rejected (exit 3), because ad-hoc is not Developer ID; **this is NOT a production installation pass**.
- [x] **A6 separate developer packaging workflow:** `create-preview-dmg-adhoc-macos.sh` clones source app outside the Git workspace on same APFS volume, signs the complete cloned app with an explicit development ad-hoc signature, verifies code integrity, runs real Memory CLI, bundled Gateway auth E2E and Rust supervisor start/stop, and only then creates a **distinct** ADHOC-UNNOTARIZED `.dmg`. Contains a Finder-friendly `/Applications` link. Does not modify the original user's installed Memmy app.
- [x] **A4 honest strict production release gate:** `check-production-signing-macos.sh` requires valid sealed signature, actual Apple `Developer ID Application` authority, macOS Gatekeeper `spctl` acceptance, and `xcrun stapler validate`. The current app must and **does fail closed with exit 3**, explicitly saying Apple-issued Developer ID signature is missing. This prevents falsely marking a development ad-hoc `.app` as installable production release.
- [x] **A5 staged app tests:** newly ad-hoc sealed standalone app passed `codesign --verify --deep --strict`, real bundle audit, actual private Dependency/Memory CLI, authenticated Agent Gateway and Rust supervisor headless process. No real user profile or Finder GUI touched.
- [x] **A5 actual rebuilt ad-hoc Developer Preview `.dmg`:** new distinct ADHOC-UNNOTARIZED disk image built successfully, `hdiutil verify` VALID; code signature of its ACTUAL READ-ONLY mounted `.app` `codesign --verify --deep --strict` PASS; real bundled Memory CLI PASS; Agent Gateway E2E PASS 1/1 (`authenticatedGateway:true`); native Rust supervisor start/stop PASS (`nativeStartedAndStopped:true`, exitCode:0), clean unmount. Includes an Applications symlink for Finder drag-and-drop. Artifact 1,422,716,445 bytes (~1.3 GiB), SHA-256 `b5153e1c38c5c70f2a265fe6fd07d74fa60c80f954393ec6dae6c4d431f63c90`. This is NOT Gatekeeper acceptance.
- [ ] **A5 actual clean-user GUI E2E:** opening/clicking Native WebKit app in a separate clean macOS account/VM; no current-user GUI invocation because `NSHomeDirectory()` still resolves to real profile despite environment HOME override.
- [ ] **A6 true macOS production distribution:** Apple Developer Program Account Holder must provision `Developer ID Application` certificate in trusted build-machine Keychain/CI secret; sign nested executables with Hardened Runtime + secure timestamps; notarize final DMG using `xcrun notarytool`, staple the approved ticket, verify Gatekeeper on a quarantined clean test Mac. This cannot be faked by ad-hoc signing or by suppressing Gatekeeper.
- [ ] **Independent security review / release lead signoff:** app bundle entitlements/embedded dynamic libraries/Sandbox, update signing vs Apple signature and actual installed native browser/Agent GUI behaviors; production `releaseReady=false` until evidence exists.

## Repeatable commands

- `npm run preview:dmg:adhoc:mac -w @memmy/tauri-shell` — real standalone ADHOC-UNNOTARIZED Developer Preview ONLY
- `npm run release:gate:mac -w @memmy/tauri-shell` — correctly rejects existing ad-hoc app with exit 3: missing Apple-issued Developer ID Application (zero valid signing identities on build host)
- `codesign --verify --deep --strict 'path/to/Memmy Turbo Preview.app'` — checks seal integrity, not Developer ID trust
- `spctl --assess --type execute --verbose=4 'path/to/Memmy Turbo Preview.app'` — Gatekeeper assessment (ad-hoc expected rejection)

## Important for communication

- Original API bridging (84/85) and backend/DMG E2E success are **not installation readiness**; an app can function in headless mode while macOS blocks its GUI launch on security grounds.
- The previous file `...-UNSIGNED-DEVELOPER-PREVIEW.dmg` is superseded and must NOT be advertised as a working macOS installer. The ad-hoc preview is suitable for controlled development testing only, subject to users' own OS authorization; do not advise turning off Gatekeeper globally.
- For public users the required next step is valid Developer ID + notarization, not another fake green build or another undocumented signing workaround.

## Verified ad-hoc preview output

- Local build-host path: `App/shell/tauri/packaging/out-unsigned/Memmy-Turbo-Tauri-1.2.5-alpha.3-macOS-arm64-ADHOC-UNNOTARIZED-DEVELOPER-PREVIEW.dmg`
- No public GitHub Release/download was created. File is local to connected Mac; installation is NOT normal Gatekeeper-approved production.
- Correct distribution requires Developer ID Application certificate, hardened runtime, Apple notarytool approval/ticket and clean-account GUI E2E. Never ask for certificate private keys in chat.
