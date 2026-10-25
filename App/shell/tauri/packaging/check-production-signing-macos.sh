#!/bin/bash
set -euo pipefail
# Strict production Mac release acceptance. Structural/adhoc verification alone
# is never sufficient for Gatekeeper on a downloaded installer.
root="$(cd "$(dirname "$0")/../../../.." && pwd)"
app="${1:-$root/App/shell/tauri/src-tauri/target/debug/bundle/macos/Memmy Turbo Preview.app}"
[[ -d "$app" ]] || { echo 'FAIL: production Mac .app missing' >&2; exit 2; }
/usr/bin/codesign --verify --deep --strict --verbose=2 "$app"
signature="$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1)"
if ! printf '%s\n' "$signature" | /usr/bin/grep -Eq '^Authority=Developer ID Application:'; then
  echo 'BLOCKED: missing Apple-issued Developer ID Application signature; ad-hoc signature is development-only' >&2
  exit 3
fi
/usr/sbin/spctl --assess --type execute --verbose=4 "$app"
/usr/bin/xcrun stapler validate "$app"
echo 'PASS: Developer ID signed, Gatekeeper accepted, notarization ticket verified'
