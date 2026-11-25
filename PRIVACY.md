# Privacy Policy — BiText: Web Translator

Last updated: 2026-11-24

## Summary

BiText: Web Translator is an open-source, privacy-first browser extension. We do not operate any backend servers, do not track your browsing activity, do not collect analytics or telemetry, and never sell or share user data.

## What Data Is Stored Locally

All settings and cached translations are stored exclusively on your device using browser-local storage (never synced to developer servers and never using `chrome.storage.sync`):

- **User Preferences** (`chrome.storage.local`): Active translation engine, target and source languages, visual theme (accent color, paper tone, light/dark mode, translation display style), interface language, and site always-translate / never-translate hostnames.
- **Visual Theme Cache** (`localStorage` on extension pages only): Your accent color, paper tone, and light/dark mode preference are mirrored locally to avoid theme flicker when opening the popup or settings page. No personal or browsing data is stored here.
- **API Credentials (Optional)** (`chrome.storage.local`): If you configure a cloud AI provider (OpenAI, Anthropic, Google Gemini, or a custom OpenAI-compatible endpoint), your API key is stored locally in `chrome.storage.local` and is never sent anywhere except as an authentication header to your chosen provider.
- **Translation Cache (Optional)** (`IndexedDB`): Translated text segments cached locally so revisited pages translate faster and reduce API usage.

## What Data Is Transmitted Off-Device

Text from a web page or your text selection is processed **only when you explicitly trigger translation** (via toolbar click, `Alt+A`, right-click context menu, selection trigger, or a site you explicitly added to your "Always translate" list):

- **Chrome Built-in Translator / Local Ollama / Local LM Studio**: Text stays strictly on your own computer and is never sent to external servers.
- **Cloud AI Providers (OpenAI, Anthropic, Google Gemini, Custom OpenAI-Compatible)**: When you choose a cloud provider and supply your own API key, only the text segments being translated (plus the current page title for translation context) are sent directly from your browser to that provider's API endpoint under your own account and their privacy policy:
  - OpenAI: https://openai.com/policies/privacy-policy
  - Anthropic: https://www.anthropic.com/legal/privacy
  - Google Gemini API: https://ai.google.dev/gemini-api/terms
  - Custom OpenAI-Compatible Server: governed by the operator of the Base URL you enter.

Form inputs (`input`, `textarea`, `select`, password fields, and editable rich-text editors) are automatically excluded from webpage and selection translation. Page translation also leaves out navigation, buttons, sidebars, account names, @handles and bare web addresses, and — when the target language is Chinese — Chinese paragraphs; that text is never sent to any provider.

## Data Sharing

BiText: Web Translator does not collect, sell, rent, or share any user data with third parties.

## Data Retention and Deletion

- Clear cached translations anytime in **Settings → Cache & Data → Clear cache**.
- Erase all saved settings and API keys anytime in **Settings → Cache & Data → Reset to defaults**, or by uninstalling the extension.

## Changes to This Policy

If our data practices ever change, this document will be updated with a new revision date in the public repository.

## Contact

For privacy questions or issues, please open an issue on the project's GitHub repository or contact the publisher email listed on the Chrome Web Store listing.
