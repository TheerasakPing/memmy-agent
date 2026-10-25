#!/bin/bash
set -euo pipefail
# Developer-only macOS ARM64 image: valid ad-hoc resources seal, but NOT
# Developer ID signed, NOT notarized, NOT accepted by Gatekeeper by default.
root="$(cd "$(dirname "$0")/../../../.." && pwd)"
pack="$root/App/shell/tauri/packaging"
source_app="$root/App/shell/tauri/src-tauri/target/debug/bundle/macos/Memmy Turbo Preview.app"
out="$pack/out-unsigned"
dmg="$out/Memmy-Turbo-Tauri-1.2.5-alpha.3-macOS-arm64-ADHOC-UNNOTARIZED-DEVELOPER-PREVIEW.dmg"
[[ "$(uname -s)" == 'Darwin' && "$(uname -m)" == 'arm64' ]] || { echo 'macOS arm64 required' >&2; exit 2; }
[[ -x "$source_app/Contents/MacOS/memmy-turbo-tauri" ]] || { echo 'Native Tauri Debug app missing' >&2; exit 2; }
node "$pack/audit-bundle.mjs" "$source_app"
# Stage OUTSIDE repository to rule out ancestor node_modules resolution.
case "$root" in
  /Volumes/*) temp_base="/Volumes/$(printf '%s' "$root" | cut -d/ -f3)" ;;
  *) temp_base="${TMPDIR:-/tmp}" ;;
esac
stage="$(mktemp -d "$temp_base/memmy-adhoc-stage-XXXXXX")"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT
app="$stage/Memmy Turbo Preview.app"
/bin/cp -cR "$source_app" "$app"
ln -s /Applications "$stage/Applications"
# Apple code signature must seal AFTER all Runtime, plugins and resources
# have been staged. Tauri's --no-sign produces only a linker signature
# and fails codesign --verify --deep --strict for the complete bundle.
/usr/bin/codesign --force --deep --sign - --timestamp=none "$app"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$app"
node "$pack/audit-bundle.mjs" "$app"
NODE_OPTIONS=--no-experimental-webstorage node "$pack/smoke-macos-app.mjs" "$app"
NODE_OPTIONS=--no-experimental-webstorage node "$pack/smoke-macos-services.mjs" "$app"
NODE_OPTIONS=--no-experimental-webstorage node "$pack/smoke-macos-native-supervisor.mjs" "$app"
mkdir -p "$out"
rm -f "$dmg"
/usr/bin/hdiutil create -ov -volname 'Memmy Turbo Adhoc Developer Preview' \
  -srcfolder "$stage" -format UDZO "$dmg"
/usr/bin/hdiutil verify "$dmg"
# Inspect the actual read-only mounted distribution, including code seal.
bash "$pack/smoke-mounted-dmg-macos.sh" "$dmg" --require-valid-code-signature
echo 'ADHOC-DEVELOPER-PREVIEW DMG created and mounted E2E verified:'
echo "$dmg"
echo 'WARNING: Gatekeeper still rejects unnotarized/ad-hoc code; this is NOT a production installer.'
