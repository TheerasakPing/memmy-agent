#!/bin/bash
set -euo pipefail
# Final unsigned Developer Preview ACCEPTANCE on the actual compressed disk image.
# This must NEVER be bypassed by testing only an .app still under source/target.
root="$(cd "$(dirname "$0")/../../../.." && pwd)"
pack="$root/App/shell/tauri/packaging"
dmg="${1:-}"
# Resolve npm --workspace relative DMG paths against the repo root.
if [[ "$dmg" != /* ]]; then dmg="$root/$dmg"; fi
[[ "$(uname -s)" == 'Darwin' ]] || { echo 'macOS disk image smoke requires Darwin' >&2; exit 2; }
[[ -f "$dmg" ]] || { echo 'actual DMG path missing' >&2; exit 2; }
mountpoint="$(mktemp -d /tmp/memmy-mounted-runtime-XXXXXX)"
mounted=0
cleanup() {
  if [[ "$mounted" == 1 ]]; then
    /usr/bin/hdiutil detach "$mountpoint" -quiet >/dev/null 2>&1 || \
      echo 'WARNING: failed to unmount Developer Preview DMG' >&2
  fi
  rmdir "$mountpoint" >/dev/null 2>&1 || true
}
trap cleanup EXIT
/usr/bin/hdiutil attach -readonly -nobrowse -mountpoint "$mountpoint" "$dmg" >/dev/null
mounted=1
app="$mountpoint/Memmy Turbo Preview.app"
[[ -x "$app/Contents/MacOS/memmy-turbo-tauri" ]] || { echo 'Mounted Tauri GUI missing' >&2; exit 1; }
node "$pack/audit-bundle.mjs" "$app"
NODE_OPTIONS=--no-experimental-webstorage node "$pack/smoke-macos-app.mjs" "$app"
NODE_OPTIONS=--no-experimental-webstorage node "$pack/smoke-macos-services.mjs" "$app"
NODE_OPTIONS=--no-experimental-webstorage node "$pack/smoke-macos-native-supervisor.mjs" "$app"
echo 'PASS: mounted read-only unsigned DMG, actual CLI, bundled Agent Gateway and Rust supervisor'
