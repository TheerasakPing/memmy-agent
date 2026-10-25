# T5 — Complete Agent-private dependencies in packaged Runtime + real bundled service E2E

## Planner / delegated lanes / lead acceptance (2026-10-25)

- [x] **A1 Source audit**: prior Tauri macOS arm64 Developer Preview passed structural bundle and Memory CLI smoke, but direct real bundled Memory → Local API → Agent Gateway E2E failed with `ERR_MODULE_NOT_FOUND: Cannot find package '@anthropic-ai/sdk'` from `App/memmy-agent/dist/providers/anthropic-provider.js`.
- [x] **A1 Root-cause analysis**: `App/memmy-agent/node_modules` and root `node_modules` are DISTINCT. The original root-deduplication replaced Agent-local modules with a relative symlink; audit passed even though many Agent-specific provider packages were missing. Installed checkout had hundreds of Agent-local packages not in root; others had different versions. Root-only package staging did not provide runtime feature parity.
- [x] **A6 Packaging fix**: stage the contents of both real root and Agent-private node_modules trees, preserving Node's package-local resolution order and private dependency versions. NEVER copy external *source symlink* itself; audit all staged symlinks to ensure link destinations remain inside shipped Runtime.
- [x] **A4 Release gate hardening**: required nested Anthropic SDK, OpenAI SDK and AWS Bedrock Runtime package manifests added to real `auditBundle()` acceptance; negative missing SDK test added to packaging suite. Any absent dependency fails release early rather than giving users a broken Agent.
- [x] **A5 Real staged Runtime:** preview:stage PASS with SHA-256 checked official Node and private Agent runtime, full recursive internal symlink audit PASS. Agent private modules contain hundreds of distinct or differently versioned packages versus root and are not harmless copies.
- [x] **A5 Test harness**: existing real `gateway.test.mjs` can now use `MEMMY_TAURI_BUNDLED_RUNTIME` to spawn actual bundled Node+Memory/Backend/Gateway files while source test mode remains unchanged; tests assert every spawned process used packaged Node and sidecar scripts.
- [x] **A4 Security and process hygiene**: new `bundle:smoke:services:mac` script audits actual `.app`, launches E2E using an isolated disposable HOME and strictly allowlisted environment (never current shell API keys/cloud logins), and cleans up its child process group and HOME. Test now has bounded Memory health probes and graceful sidecar cleanup even when startup fails.
- [x] **A5 Real rebuilt unsigned macOS ARM64 preview:** Tauri Debug App Build PASS. Genuine .app 1.78 GiB (~2.1 GB decimal), Mach-O arm64; full actual Bundle Audit ok:true/errors:[] PASS; bundled Node + compiled Memory CLI Smoke PASS.
- [x] **A5 Real bundled Memory to Local API to Agent Gateway E2E:** bundle:smoke:services:mac PASS, ok:true, authenticatedGateway:true, exitCode:0, timedOut:false, tested 1/1 PASS. Validated unauthorized WebUI HTTP 401, authorized HTTP 200, real service readiness and loopback-only websocket settings. All three processes use real .app bundled Node and sidecar scripts, not checkout binaries. Temporary isolated HOME and allowlisted environment prevent inheriting current user credentials.
- [x] **A5 Source regressions:** sidecar:test 12/12 PASS. Both source and real bundled runtime modes accepted. Bundle Audit negative tests 6/6 PASS, renderer smoke 3/3 PASS, parity 84/85 with 14 original React routes.
- [x] **A5 Reporter correction:** Node 26 spec reporter uses info-icon pass/fail format instead of older TAP hash-prefixed pass/fail lines; first bundled E2E returned false despite actual process success 1/1. Harness corrected and rerun: ok:true.
- [ ] **A5 Cross-platform / GUI:** unsigned debug .app only; real Finder-opened macOS interactive WebKit/native Rust supervisor GUI E2E NOT yet verified. Windows 11 x64/Linux installers, notarization and installed GUI acceptance remain pending.
- [ ] **A4 independent security review**: private dependencies licensing/supply chain/provenance, Native SQLite ABI on clean machine, sidecar credential isolation, path/TOCTOU, local Agent access.
- [ ] **Lead production release**: blocked by real Native OS extension folder drag, WebKit/Agent same-session Computer Use, signed native updater feed and cookie/cache clearing parity, Native GUI E2E and independent approval. `releaseReady=false`; PR must remain Draft.

## Reproduce

- `NODE_OPTIONS=--no-experimental-webstorage npm run bundle:audit:test -w @memmy/tauri-shell`
- `NODE_OPTIONS=--no-experimental-webstorage npm run preview:stage -w @memmy/tauri-shell`
- Build macOS ARM64 Developer Preview with documented public legal-origin config and `tauri build --debug --bundles app --config packaging/tauri-bundled.conf.json --no-sign --ci`
- `NODE_OPTIONS=--no-experimental-webstorage npm run bundle:smoke:services:mac -w @memmy/tauri-shell`
- `node scripts/engineering/tauri-parity.mjs --check` — should remain 84/85 bridged, 5 partial, 1 unported, 14 React routes unchanged

## Rollback

New stacked Draft PR based on #66; previous app 1.01 GiB lacked runtime provider dependencies and is NOT fit to distribute. This work fixes bundled Agent service startup without changing React UI or original Electron shell. No automatic merge to main.
