# Chrome Web Store Listing — BiText: Web Translator

## Store Listing

**Extension Name** [REQUIRED]
- English (`en`): `BiText: Web Translator`
- Traditional Chinese (`zh_TW`): `BiText：網頁翻譯器`

**Short Description** [REQUIRED]
- English (128 chars):
  `Read foreign web pages in bilingual or translation-only view using Chrome built-in AI, OpenAI, Claude, Gemini, or local Ollama.`
- Traditional Chinese (64 chars):
  `支援雙語對照與框選翻譯的網頁翻譯器，可自由選擇 Chrome 內建離線翻譯、OpenAI、Claude、Gemini 或本機 Ollama 模型。`

**Detailed Description** [REQUIRED]

```text
BiText: Web Translator lets you read foreign-language web pages comfortably in bilingual paragraph-by-paragraph view or translation-only mode, right inside your browser.

FEATURES
• Full-page bilingual reading — Press Alt+A or click the toolbar icon to show translations right below each paragraph while keeping original links, bold text, and inline code intact.
• Instant display switching — Switch smoothly between Bilingual view, Translation-only view, and the original page at any time.
• Selection translation — Highlight any phrase or paragraph to translate in a clean floating card with one-click copy. Choose between clicking a subtle trigger icon or translating immediately on drag.
• Choose your own translation engine — Use free offline Chrome built-in translation with zero setup, connect your own API key for OpenAI, Anthropic Claude, Google Gemini, or a custom OpenAI-compatible endpoint, or connect private local models via Ollama or LM Studio.
• Content only — Translates articles and posts, and leaves menus, buttons, sidebars, account names and web addresses as written. With a Chinese target, Chinese paragraphs stay untouched and are never sent for translation.
• Calm editorial reading themes — Personalize 5 low-glare accent colors, Warm Ivory or Cool Paper surfaces, light or dark mode, and 4 translation highlight styles.

HOW TO USE
1. Install BiText and pick your preferred translation engine in the welcome guide (Chrome built-in offline translation works right away with no API key).
2. Open any foreign article and press Alt+A, click "Translate this page" in the toolbar menu, or right-click to translate.
3. Highlight any text to translate specific words or paragraphs.

PRIVACY
BiText collects zero analytics, zero browsing history, and has no backend server of its own. Your API keys and preferences remain strictly in local browser storage. When using Chrome built-in translation or local Ollama/LM Studio, your text never leaves your device.

PERMISSIONS
• Access to websites you visit — Required to display bilingual translations directly inside articles, support your "Always translate" site list, and translate highlighted text. Translation runs only when you trigger it or on sites you explicitly add.
• Access to OpenAI, Anthropic, and Google Gemini API domains — Allows sending translation requests directly to the official cloud AI provider you choose.
• Optional localhost / custom server access — Requested only if you explicitly configure local Ollama, LM Studio, or a custom API server.

SUPPORT
Open-source under the MIT License. Source code, bug reports and feature requests: https://github.com/keantares/bitext-web-translator

Version 0.1.0 — Initial open-source release.
```

**Category** [REQUIRED]
`Productivity`

**Single Purpose** [REQUIRED]
`Translates text on web pages into the user's preferred language in bilingual, translation-only, or selection popover views.`

**Primary Language** [REQUIRED]
`English` (with localized `zh_TW` listing)

---

## Graphics & Assets

| Asset | Dimensions | Filename |
|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | `public/icon/128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 PNG | `docs/screenshots/bilingual-page.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 PNG | `docs/screenshots/appearance-dark.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 PNG | `docs/screenshots/onboarding.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 PNG | `docs/store/promo-small-440x280.png` |

### Screenshot Notes
- `bilingual-page.png`: Shows an English article translated paragraph-by-paragraph with Forest Teal left accent bars, clickable translated links, and preserved inline code.
- `appearance-dark.png`: Shows dark-mode editorial Appearance settings with Brick Red accent, Cool Paper surface, and live preview.
- `onboarding.png`: Shows the welcome setup wizard with Chrome Built-in, Cloud AI, and Local Ollama choices.
- `promo-small-440x280.png`: Editorial Warm Ivory & Forest Teal store tile.

---

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | Stores user preferences (selected translation engine, language pair, visual theme, site allow/deny lists) and optional user-provided API keys locally in `chrome.storage.local`. |
| `activeTab` | permissions | Allows detecting the active tab's language and toggling webpage or selection translation when the user clicks the toolbar icon, presses `Alt+A`, or clicks a right-click context menu item. |
| `scripting` | permissions | Injects the translation content script and stylesheet on demand into tabs that were already open before the extension was installed or updated. |
| `contextMenus` | permissions | Adds right-click menu options so users can translate the current webpage or selected text directly from the context menu. |
| `https://api.openai.com/*` | host_permissions | Sends translation requests directly to OpenAI's official API when the user selects OpenAI and enters their own API key. |
| `https://api.anthropic.com/*` | host_permissions | Sends translation requests directly to Anthropic's official Claude Messages API when the user selects Anthropic and enters their own API key. |
| `https://generativelanguage.googleapis.com/*` | host_permissions | Sends translation requests directly to Google's official Gemini API when the user selects Google Gemini and enters their own API key. |
| `https://*/*`, `http://127.0.0.1/*`, `http://localhost/*` | optional_host_permissions | Requested on demand via user click only if the user configures a custom OpenAI-compatible API endpoint or a local Ollama / LM Studio server on their computer. |
| `http://*/*`, `https://*/*` | content_scripts | Injects the lightweight page & selection translator script so users can translate any webpage on demand, use selection translation, or enable automatic translation for specific hostnames. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes — Website content is transmitted off-device **only** when the user actively triggers translation while using a user-configured external Cloud AI API. No data is ever sent to or collected by the extension developer.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|---|---|---|---|---|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No (user API keys stored locally only) | Sent only as auth header to the user's chosen AI provider | Authenticate user's own API requests | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | No | No | — | No |
| User activity | No | No | — | No |
| Website content | Only when user triggers translation | Only if user chooses a Cloud AI provider (not for Chrome Built-in, Ollama or LM Studio) | Perform user-requested text translation | Sent solely to the translation API provider chosen by the user |

### Data Use Certification
- Data is not sold to third parties.
- Data is not used for purposes unrelated to the extension's core functionality.
- Data is not used for creditworthiness or lending purposes.

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
`https://github.com/keantares/bitext-web-translator/blob/main/PRIVACY.md`

---

## Distribution & Developer Info

- **Visibility**: Public
- **Regions**: All regions
- **Homepage URL**: `https://github.com/keantares/bitext-web-translator`
- **Support URL**: `https://github.com/keantares/bitext-web-translator/issues`

---

## Version History

| Version | Date | Changes |
|---|---|---|
| 0.1.0 | 2026-11-25 | Initial release. |
