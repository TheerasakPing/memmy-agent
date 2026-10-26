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
# Prevent bundling a pre-fix Memory service that blocks the HTTP event loop
# when launching with a large existing preview database.
if [[ ! -f "$runtime/Memory/dist/src/server/tauri-startup-policy.js" ]] || \
   ! grep -q 'tauriManagedMemoryWorkerPolicy' "$runtime/Memory/dist/src/server/index.js"; then
  echo 'Staged Memory runtime is stale: rebuild/stage the large-profile startup policy' >&2
  exit 1
fi
# Fail before packaging if either compiled contract is from a pre-Thai build.
for contract in "$runtime/node_modules/@memmy/local-api-contracts/dist/index.js" \
                "$runtime/App/backend/local-api-contracts/dist/index.js"; do
  if [[ ! -f "$contract" ]] || ! grep -q '"th-TH"' "$contract"; then
    echo "Stale language schema: $contract (rebuild/stage contracts first)" >&2
    exit 1
  fi
done
if [[ ! -f "$runtime/App/backend/dist/src/infrastructure/app-state-store/migrations/0031-thai-app-language.sql" ]]; then
  echo "Thai app-settings database migration missing from staged backend" >&2
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
/usr/libexec/PlistBuddy -c 'Print :NSMicrophoneUsageDescription' "$plist" >/dev/null || {
  echo 'macOS microphone usage declaration missing from packaged Tauri app' >&2; exit 1;
}
node "$root/scripts/internal/shared/verify-browser-extension.mjs" \
  "$root/App/shell/desktop/extensions/memmy-browser" \
  "$out/Memmy Turbo Preview.app/Contents/Resources/browser-extension" >/dev/null || {
  echo 'Bundled Browser Extension differs from original frozen source' >&2; exit 1;
}
echo "Prepared isolated candidate: $out/Memmy Turbo Preview.app"
du -sh "$out/Memmy Turbo Preview.app"
