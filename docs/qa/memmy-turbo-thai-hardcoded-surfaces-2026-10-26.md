# Thai completion — uncatalogued UI surfaces

Owner: desktop/i18n + extension; reviewer: isolated startup, native, and Memory smoke gates.

## Checklist
- [x] Re-run explicit catalog audit: 2266/2266 Thai source keys, no unknown keys or placeholder drift
- [x] Fix welcome/first-encounter relay and report prompt previously hardcoded to English when locale was not Chinese
- [x] Fix startup error screen `th-TH` selection; avoid startup regression when React providers are unavailable
- [x] Add Thai-localized Browser Extension popup for browser UI language `th`, retaining Chinese behavior for other locales
- [x] Keep English UI static-copy test covering only production non-catalog files; exempt Thai catalog files
- [x] TypeScript and selected UI/first-encounter/i18n suite: 19 tests pass
- [x] Frontend Vite and Tauri Debug bundle build pass
- [x] Staged app relocatability audit, native Rust supervisor smoke, full isolated Memory/Backend/Gateway E2E pass
- [x] Ad hoc signed/staged strict verification, installed with rollback preserving Original
- [x] Live Preview Memory Health (6), Bootstrap BYOK (2), Agent Sources (2), zero failures
- [ ] Full manual UI navigation/Thai text overflow across all screens including native OS dialogs
- [ ] Translate browser-extension permission/reason strings delivered by Chrome debugger, third-party services and CLI help consistently
- [ ] Perform real Thai LLM response QA with configured user model and Thai ASR/TTS per provider

## Scope qualification

Explicit desktop i18n coverage is 100% (2266 keys), **not** complete localization of arbitrary model output, native third-party dialogs, OS provider errors or uncatalogued messages. This round closes several concrete gaps but leaves human/native QA as open verification items.

Installed app: `~/Applications/Memmy Turbo Preview.app`; rollback `~/Applications/.memmy-preview-rollback-before-thai-finalpatch-20261026.app`. Original `/Applications/Memmy.app`, and its SQLite data, untouched. The Preview remains BYOK/local-only.
