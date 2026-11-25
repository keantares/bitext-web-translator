# AGENTS.md

Project rules for AI coding agents (and humans) working on BiText: Web Translator. See also [CONTRIBUTING.md](CONTRIBUTING.md).

## Project

- Browser extension for bilingual or translation-only reading of web pages, plus selection translation.
- Stack: WXT, TypeScript, Preact, Tailwind CSS, opencc-js. Chrome MV3 is the main target; the Firefox MV3 build is kept working but is not published.
- `src/core/` holds the translation engine, storage, i18n and DOM paragraph logic; `src/entrypoints/` holds the background worker, content scripts, popup, options and onboarding pages.

## Commands

Requires Node.js 22.12 or later.

```bash
npm ci
npm run typecheck
npm test                 # Vitest unit tests (happy-dom)
npm run build            # Chrome MV3 -> .output/chrome-mv3
npm run build:firefox    # Firefox MV3 -> .output/firefox-mv3
npm run test:e2e         # Playwright, loads .output/chrome-mv3; run `npm run build` first
npm run zip              # store packages in .output/
```

The E2E test launches Playwright's Chromium on Windows and the installed Google Chrome (`channel: 'chrome'`) elsewhere.

## Hard rules

1. **Manifest V3.** The background service worker keeps no state in module globals: read `chrome.storage.local` inside each handler, and register every listener synchronously at the top level.
2. **No HTML strings or dynamic code.** No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function` or remote code. Build DOM and SVG with `createElement`, `createElementNS` and `textContent`.
3. **Least privilege.** Required `host_permissions` list only the three official API hosts (OpenAI, Anthropic, Google Gemini). Custom and localhost endpoints stay in `optional_host_permissions` (`optional_permissions` on Firefox). Call `browser.permissions.request()` before any `await` in the click handler.
4. **Keep the core independent.** `src/core/translation/` must not depend on the page DOM or on any UI.
5. **Permissions and privacy.** Any change to permissions or to what data leaves the device must update `PRIVACY.md` and `CHROMEWEBSTORE.md` in the same change.
6. **Two UI languages.** Every UI string goes into both `en` and `zh-TW` in `src/core/i18n/messages.ts`; a unit test checks the keys match. `zh-TW` uses Taiwan Traditional Chinese phrasing.
7. Code and comments in English. Never commit API keys, tokens or personal data.
8. When a dependency bundled into the extension is added or upgraded, update `public/THIRD_PARTY_NOTICES.txt`.
9. **Test data is fictional.** Tests, fixtures, screenshots and docs use made-up names, handles, posts and sites (for example `example.com` or `Sample Writer`). Never copy real accounts, posts, URLs or other content seen while browsing into the repository. Do not commit test outputs, logs, screenshots of real sites or one-off verification scripts; `test-results/` and `playwright-report/` are git-ignored.

## Page translation behavior to keep

- Translate content only. Navigation, controls, tabs, menus, footers, search areas, sidebars outside articles, short link-only text, account names, @handles and bare web addresses stay as written (`isFunctionalText` and `isAccountText` in `src/core/dom/paragraphs.ts`).
- With a Chinese target language, Chinese paragraphs (Simplified or Traditional) are left as written and never sent for translation (`isPredominantlyChinese`).
- One blank line (`1lh`) separates the original from its translation (`src/entrypoints/content/page.css`).

## Before you finish

- `npm run typecheck`, `npm test` and `npm run build` pass; also run `npm run test:e2e` after changing content scripts or page behavior.
- For a release, bump `version` in `package.json` and add a row to the version history in `CHROMEWEBSTORE.md`.
