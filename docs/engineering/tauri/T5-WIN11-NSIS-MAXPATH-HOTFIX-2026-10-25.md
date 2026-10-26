# Windows 11 x64 NSIS hotfix — MAX_PATH write failure (user screenshot, 2026-10-25)

## Incident / Source audit

User-installed **unsigned Windows 11 x64 Developer Preview** (release tag `tauri-v2-win11-x64-v1.2.5-alpha.3-20261025`) failed part-way through NSIS installation with **Error opening file for writing** for:

`C:\Users\Administrator\AppData\Local\MemmyTurboPreview\runtime\App\memmy-agent\node_modules\openclaw\node_modules\@mistralai\mistralai\esm\models\operations\getchatcompletionfieldoptionscountsv1observabilitychatcompletionfieldsfieldnameoptionscountspost.d.ts.map`

Root cause established by measuring EVERY unpacked file of the actual NSIS staging Runtime against the exact reported Windows Administrator install directory. 127,926 staged regular files; 2 paths greater than the classic Win32 259-character maximum, including the screenshot's `.d.ts.map` (262 characters). There are 61 paths at least 240 characters. `MAX_PATH` is a real Windows Installer compatibility constraint, not a permissions/access-control exception. Never tell users to Ignore the file, disable Windows Defender, or repeatedly Retry.

## Team lanes / checklist

- [x] **A1 audit:** reproducibly measured path lengths and classified offenders. The error occurs while NSIS writes optional TypeScript declaration source-map metadata in a deeply nested Mistral SDK inside OpenClaw dependencies. The file is not executed at runtime.
- [x] **A2 packaging fix:** `trim-windows-node-modules.mjs` prunes ONLY non-executable `.map`, `.d.ts`, `.d.cts`, `.d.mts` within Node dependency directories, leaves actual `.js/.cjs/.mjs`, `.ts` source and manifests untouched. On real Windows staged payload, removed **49,091 non-runtime files** while retaining **76,324 regular dependency files**, including actual Mistral `.js` implementation.
- [x] **A2 path guard:** default NSIS installation path changed to `%LOCALAPPDATA%\Memmy` to avoid the user's previous incomplete `%LOCALAPPDATA%\MemmyTurboPreview` location. NSIS rejects a user-supplied install directory whose prefix length exceeds 46 characters *before* writing any payload (clear UI error rather than partial app). The trimmed real Administrator profile's longest path is **244 characters**, meeting conservatively chosen maximum **248**.
- [x] **A4 negative security and behavior tests:** Node tests prove declaration/source-map pruning leaves executable `.js` and TypeScript source intact and that a genuinely long `.js` executable filename is **rejected**, not silently deleted. Tests **2/2 PASS**. Existing React 14 routes and native 84/85 API bridge unchanged.
- [x] **A5 Windows CI:** required `node --test trim-windows-node-modules.test.mjs` and prune/pass/fail path audit inserted after staging actual Windows-native Node dependencies, before NSIS construction.
- [x] **A5 real patched NSIS:** Build new distinct `MAXPATH-FIX-DEVELOPER-PREVIEW-Setup.exe` with NSIS Deflate solid compression, EXIT 0. `7z t` reports Everything is Ok; **78,854** extracted files totaling 1,606,407,597 bytes, Setup.exe **370,060,992 bytes (353 MiB)**. Directly enumerated the actual NSIS archive and verified original offending `.d.ts.map` file ABSENT, all retained archive paths in `C:\Users\Administrator\AppData\Local\Memmy` at most **244** characters with ZERO paths over 248. Verified Tauri Windows EXE, Node.exe, better-sqlite3 native PE, sqlite-vec DLL, compiled Agent and Browser extension entries all PRESENT. Other harmless short Source Maps in non-dependency folders retained. SHA-256 `ade76a2c52ddb5a8a25157bdceaa8630b91be104c33db97177f5b565dcd3dbe9`.
- [x] **A5 public download:** distinct GitHub **Pre-release** `https://github.com/TheerasakPing/memmy-agent/releases/tag/tauri-v2-win11-x64-v1.2.5-alpha.3-maxpath-hotfix1-20261025`. Actual uploaded Setup.exe 370,060,992 bytes, SHA256SUMS-MAXPATH-FIX.txt 148 bytes, both GitHub asset `state=uploaded`. Downloaded the checksum asset back from GitHub and verified it matched local tested installer SHA-256 exactly.
- [ ] **A5 actual Windows 11 acceptance:** clean per-user installation by executing new Setup on Windows 11 x64 and clicking native React/WebView2 GUI; separate memory and Gateway authenticated E2E, uninstall. Cross-build and archive tests cannot certify Windows installer lifecycle.
- [ ] **A4 independent human security review:** provenance and licensing of native Windows packages and compatibility of NSIS path guard with nonstandard usernames and legacy MAX_PATH policy.
- [ ] **Lead production:** releaseReady=false; real Authenticode trust, remaining native Browser/Agent parity gaps and independent Windows GUI E2E pending. PR #71 remains Draft, production main untouched.

## User-facing recovery

1. **Abort** previous installation instead of Ignore / Retry.
2. Download the new distinct MAXPATH-FIX Preview from its verified GitHub Pre-release when published (not the old alpha.3 asset).
3. New setup uses `%LOCALAPPDATA%\Memmy`; existing incomplete `%LOCALAPPDATA%\MemmyTurboPreview` can be inspected and cleaned separately **after** backing up any previous data if present. The new installer does not mutate that previous directory.
4. On any further write error, capture the full path and Windows version; do not disable security protections to force it.
