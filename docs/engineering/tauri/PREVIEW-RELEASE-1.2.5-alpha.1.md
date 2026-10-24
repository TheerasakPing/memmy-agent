# Memmy Turbo v1.2.5-alpha.1 — Tauri v2 source preview

**Preview only. This is NOT a production-ready replacement for Memmy v1.2.4.**

## What is included

- New **Rust/Tauri v2** desktop host with the **existing React frontend source**, all 14 original routes present in source and window chrome/size scaffold.
- Rust-backed implementation for 16/85 callable Electron preload bridge methods. Other 69 methods remain missing or blocked (never claimed functional).
- Development-only **Rust-supervised real Memory SQLite and Local API sidecars** with private, separate Tauri user data, loopback-only endpoints and rotating session tokens.
- Unit/contract and targeted process smoke evidence in `T0-QA-RESULTS-2026-10-24.md`, `T1-OS-PARITY-2026-10-24.md`, `T2-LOCAL-API-RUNTIME-2026-10-24.md` and `T2-REAL-MEMORY-SUPERVISOR-2026-10-24.md`.
- `App/shell/tauri` is an additive preview workspace. The old Electron desktop and root product remain v1.2.4 and are not removed or silently replaced.

## Run the source preview on a Mac with development tools

```sh
npm ci
npm rebuild better-sqlite3 sqlite-vec --foreground-scripts
npm run memory:build
npm run build -w @memmy/backend
MEMMY_TAURI_DEV_BACKEND=1 MEMMY_TAURI_DEV_MEMORY=1 \
MEMMY_CLOUD_SERVICE=https://api.memmy.cn \
MEMMY_LEGAL_CN_BASE_URL=https://memmy.cn \
MEMMY_LEGAL_INTL_BASE_URL=https://memmy.bot \
npm run tauri:dev -w @memmy/tauri-shell
```

The cloud origin is an example; use the appropriate configuration. This starts real Memory + Local API, **not** the full Agent Gateway/browser/pet experience. UI navigation can render but some tabs/actions are not functional. The debug build still requires Node/Rust and should not hold important data.

## Remaining P0 release blockers

- Port full Agent Gateway, Pet/Tray, Embedded Browser/Computer Use, and remaining 69 native bridge methods.
- Resolve disabled GitHub Actions (#26), execute independent cross-platform E2E/Smoke/screenshot parity, security review and LEAD approval.
- Implement signed bundled backend/Memory/Agent sidecars, installer verification, data migration/rollback and updater.
- Harden Tauri CSP (currently `null`) and validate R1/R2 tenant-isolation changes separately.

**Shipping status:** `releaseReady=false`; do not publish unsigned debug bundles as a usable installer. A source preview tag/release does not imply production QA or feature parity.
