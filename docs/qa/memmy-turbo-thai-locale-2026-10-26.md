# Thai Locale: Phase 1

## Status / checklist
- [x] Add `th-TH` to Local API `LanguageSchema`, React i18n and display-language types
- [x] Add Thai to Settings language selector and Tauri Preview `system` default
- [x] Translate 74 high-priority UI messages (startup/error, sidebar, Memory navigation, settings, basic Browser and Pet status)
- [x] Keep all other keys safe with English fallback; preserve interpolation parameters
- [x] TypeScript, Thai tests 2/2, frontend build
- [x] Bundle audit, Memory CLI smoke, native Rust supervisor smoke, full isolated Memory+Backend+Agent Gateway E2E
- [x] Ad-hoc codesign and strict verification of staged app; installed alongside untouched Original
- [ ] Translate **all remaining** UI keys (currently thousands; Phase 1 does not mean full Thai coverage)
- [ ] Audit hard-coded strings outside i18n, OS dialogs, backend diagnostics, Agent prompts, locale/date formatting and speech input/output
- [ ] Full human visual QA across all tabs and dialogs, including Thai overflow and fonts
- [ ] Localized Agent/Memory report schema and any provider-specific locale protocol, tested end to end

## Important

English is the fallback for missing Thai strings to avoid unexpectedly displaying Chinese. The Thai strings here are an initial subset and **must not be represented as 100% Thai localization**. Existing legacy Electron app and Original SQLite are not modified.
