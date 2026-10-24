#!/bin/bash
set -euo pipefail
# Developer preview ONLY: ad-hoc signature, no Apple Developer ID or notarization.
root="$(cd "$(dirname "$0")/../../../.." && pwd)"
pack="$root/App/shell/tauri/packaging"
out="${MEMMY_TAURI_PACKAGE_OUTPUT:-$pack/out}"
case "$out" in "$pack"/out|"$pack"/out-*) ;; *) echo 'Invalid package output' >&2; exit 2;; esac
bundle="$out/Memmy Turbo Preview.app"
[[ -x "$bundle/Contents/MacOS/memmy-turbo-tauri" ]] || { echo 'Missing preview app' >&2; exit 2; }
/usr/bin/codesign --force --deep --sign - --timestamp=none "$bundle"
/usr/bin/codesign --verify --deep --strict "$bundle"
"$bundle/Contents/MacOS/memmy-turbo-tauri" --smoke-native-runtime
/usr/bin/hdiutil create -ov -volname 'Memmy Turbo Preview alpha3' -srcfolder "$bundle" -format UDZO "$out/Memmy-Turbo-Tauri-1.2.5-alpha.3-macOS-arm64-UNNOTARIZED.dmg"
echo 'Developer preview disk image created; not notarized or suitable for production use.'
