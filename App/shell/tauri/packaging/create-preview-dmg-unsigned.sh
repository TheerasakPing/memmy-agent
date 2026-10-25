#!/bin/bash
set -euo pipefail
# Unsigned DEVELOPMENT preview only. Uses the *actual* Tauri Debug app
# verified with the complete bundled Memory/Backend/Agent Gateway E2E.
# Never substitute a source checkout, stale out-review artifact or release binary.
root="$(cd "$(dirname "$0")/../../../.." && pwd)"
pack="$root/App/shell/tauri/packaging"
app="$root/App/shell/tauri/src-tauri/target/debug/bundle/macos/Memmy Turbo Preview.app"
out="$pack/out-unsigned"
dmg="$out/Memmy-Turbo-Tauri-1.2.5-alpha.3-macOS-arm64-UNSIGNED-DEVELOPER-PREVIEW.dmg"
[[ "$(uname -s)" == 'Darwin' && "$(uname -m)" == 'arm64' ]] || { echo 'macOS arm64 required' >&2; exit 2; }
[[ -x "$app/Contents/MacOS/memmy-turbo-tauri" ]] || { echo 'Tauri native Debug app missing' >&2; exit 2; }
[[ -x "$app/Contents/Resources/runtime/node" ]] || { echo 'Bundled Node missing' >&2; exit 2; }

# Both probes must pass before creating a disk image. These do not depend on
# an external npm/node executable for the actual managed service processes.
node "$pack/audit-bundle.mjs" "$app"
# This MUST run from a real copy OUTSIDE the source checkout: a staged app
# still under target/debug/bundle can accidentally use ancestor node_modules.
NODE_OPTIONS=--no-experimental-webstorage node "$pack/smoke-macos-relocated.mjs" "$app"

mkdir -p "$out"
rm -f "$dmg"
/usr/bin/hdiutil create -ov -volname 'Memmy Turbo Unsigned Dev Preview' \
  -srcfolder "$app" -format UDZO "$dmg"
/usr/bin/hdiutil verify "$dmg"
echo 'UNSIGNED development disk image successfully verified:'
echo "$dmg"
echo 'NOT notarized, NOT Developer ID signed, NOT production-ready.'
