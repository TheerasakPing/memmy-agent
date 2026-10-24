# T2 Rust-managed Local API: development-only proof, 2026-10-24

**Status: PARTIAL / NO RELEASE SIGNOFF.** Branch is stacked on PR #30. Original
React route/page/CSS source remains unchanged; Electron production is unchanged.

## Implemented

- Tauri's `getRuntimeConfig()` invokes a Rust async command that lazily starts the
  fixed repository Node sidecar in development. It never runs a renderer-supplied
  command or accepts a renderer-controlled executable path.
- Rust owns the child handle, validates an unlogged private-pipe readiness JSON
  (HTTP loopback only, nonempty 32+-character session token), checks process
  liveness, and stops it on main-window destruction. stdin close requests
  graceful shutdown; a bounded timeout is followed by force termination.
- The Node sidecar instantiates **the existing** `@memmy/backend` Local API, on
  loopback/ephemeral port, with Tauri-specific **exact** origin allowlist, a
  separately scoped app data directory and a freshly rotated local auth token.
- The sidecar refuses remote Memory origins, requires a healthy explicitly
  configured Memory service, and refuses to guess a Cloud gateway. This is
  **not** native-managed Memory or Agent yet; no fake backends are used by the
  application. The Node E2E uses an isolated health **fixture** to test the
  Local API only and cannot certify Memory correctness.
- Readiness credentials are sent over the parent/child stdout pipe and never
  forwarded to renderer logs. The standard local backend config file is
  owner-only and deleted on controlled exit. Rust never accepts a stale file
  as evidence of a living child.

## Developer startup (not for production)

Build backend with `npm run backend:build -w @memmy/tauri-shell`, start a real
Memory service on a dedicated loopback endpoint (and token), then:

```sh
MEMMY_TAURI_DEV_BACKEND=1 \
MEMMY_MEMORY_LAYER_URL=http://127.0.0.1:<memory-port> \
MEMMY_MEMORY_LAYER_TOKEN=<private-memory-token> \
MEMMY_CLOUD_SERVICE=<configured-cloud-gateway> \
npm run tauri:dev -w @memmy/tauri-shell
```

Replace angle-bracket placeholders locally; **never commit or log secrets**.
The existing Memory service must already be healthy at `/api/v1/health`.
Native backend startup is currently a debug-only opt-in. In a release build
it deliberately returns a clear error until a signed bundled binary and
Memory+Agent lifecycle are implemented. Do not promote this to production.

## Gate evidence

| Gate | Status |
| --- | --- |
| `npm run build -w @memmy/backend` | PASS on Mac arm64 |
| Node Local API smoke, CORS, missing/stale token, process stop, restart | PASS 2/2 tests with isolated Memory health fixture |
| Existing `App/backend/src/tests/index.test.ts` regression | PASS 31/31 tests |
| Tauri bridge parity inventory | PASS 16/85 methods, 14 preserved React routes |
| Rust cargo check (debug Mac arm64) | PASS (native Rust development bootstrap) |
| Rust cargo test (Mac arm64) | PASS 5/5 tests |
| Real Memory service integration / Agent gateway | NOT VERIFIED |
| Signed packaged app with bundled Node+Memory sidecars | NOT IMPLEMENTED |
| Native macOS/Windows/Linux UI screenshot E2E | NOT RUN |
| A1 independent Security, A5 QA and LEAD acceptance | NOT RECEIVED |

## Release blockers and rollback

- No cross-platform signed `externalBin` sidecar or updater. Release builds fail closed.
- Native-managed Memory and Agent startup, crash supervision, user-data import,
  rollback, CLI install, tray/pet/browser parity, signed E2E are still required.
- CSP is still `null` in the bootstrap (P0 security gate); must harden before release.
- CI dispatch is blocked by GitHub Actions issue #26. CI YAML presence is not proof.
- Revert the stacked T2 branch without changing Electron production or existing
  user databases; new Tauri data is namespaced separately.
