# Contributing to BiText: Web Translator

Thank you for considering contributing to BiText!

## Development Setup

1. Install Node.js 22.12 or later.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run checks before opening a pull request:
   ```bash
   npm run typecheck
   npm test
   npm run build
   npm run build:firefox
   npm run test:e2e
   ```

## Architecture Notes

- **`src/core/`** is UI-agnostic and intentionally decoupled from browser extension UI pages so translation providers, prompts, OpenCC, and cache logic can be tested directly in Vitest and reused across future companion projects.
- **Adding a new translation provider**:
  1. Implement `TranslationProvider` in `src/core/translation/providers/`.
  2. Wire it in `src/core/translation/engine.ts` and `src/core/storage/types.ts`.
  3. Add unit tests with mocked `fetch` responses in `tests/unit/providers.test.ts`.
  4. Add localized labels in both `en` and `zh-TW` inside `src/core/i18n/messages.ts`.
- **Coding conventions**:
  - Code and comments in English; user-facing UI strings localized in both `en` and `zh-TW` (Taiwan phrasing).
  - Never commit API keys, secrets, or personal test profiles.
  - When adding or upgrading a dependency that ships inside the extension, update `public/THIRD_PARTY_NOTICES.txt`.
  - Keep MV3 service worker stateless (`src/entrypoints/background.ts` reads settings from storage on demand).
