#!/bin/bash
set -euo pipefail
# Prototype macOS arm64 bundle with *all* runtime dependencies included.
# This is an unsigned developer preview. The separate QA smoke MUST pass first.
root="$(cd "$(dirname "$0")/../../../.." && pwd)"
pack="$root/App/shell/tauri/packaging"
runtime="$pack/runtime"
out="${MEMMY_TAURI_PACKAGE_OUTPUT:-$pack/out}"
case "$out" in
  "$pack"/out|"$pack"/out-*) ;;
  *) echo 'Package output must be isolated inside packaging/out-*' >&2; exit 1 ;;
esac
source_app="$root/App/shell/tauri/src-tauri/target/debug/bundle/macos/Memmy Turbo Preview.app"
binary="$root/App/shell/tauri/src-tauri/target/release/memmy-turbo-tauri"
if [[ ! -x "$runtime/node" || ! -x "$binary" || ! -d "$source_app" ]]; then
  echo 'Missing staged Node runtime, compiled Rust release binary or Tauri app template' >&2
  exit 1
fi
rm -rf "$out"
mkdir -p "$out"
/bin/cp -cR "$source_app" "$out/Memmy Turbo Preview.app"
/bin/cp -f "$binary" "$out/Memmy Turbo Preview.app/Contents/MacOS/memmy-turbo-tauri"
mkdir -p "$out/Memmy Turbo Preview.app/Contents/Resources"
/bin/cp -cR "$runtime" "$out/Memmy Turbo Preview.app/Contents/Resources/runtime"
plist="$out/Memmy Turbo Preview.app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleShortVersionString 1.2.5-alpha.3' "$plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleVersion 1.2.5' "$plist"
echo "Prepared isolated candidate: $out/Memmy Turbo Preview.app"
du -sh "$out/Memmy Turbo Preview.app"
