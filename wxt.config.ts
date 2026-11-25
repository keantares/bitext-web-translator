import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

const OFFICIAL_API_HOSTS = [
  'https://api.openai.com/*',
  'https://api.anthropic.com/*',
  'https://generativelanguage.googleapis.com/*',
];

const REPOSITORY_URL = 'https://github.com/keantares/bitext-web-translator';

const OPTIONAL_USER_HOSTS = [
  'https://*/*',
  'http://127.0.0.1/*',
  'http://localhost/*',
];

export default defineConfig({
  srcDir: 'src',
  zip: {
    excludeSources: ['test-results/**', 'playwright-report/**', 'coverage/**'],
  },
  vite: () => ({
    plugins: [preact(), tailwindcss()],
  }),
  manifest: ({ browser }) => {
    const base = {
      name: '__MSG_extName__',
      short_name: '__MSG_extShortName__',
      description: '__MSG_extDescription__',
      default_locale: 'en',
      homepage_url: REPOSITORY_URL,
      icons: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
      action: {
        default_title: '__MSG_extShortName__',
        default_icon: {
          16: 'icon/16.png',
          32: 'icon/32.png',
          48: 'icon/48.png',
        },
      },
      permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
      host_permissions: OFFICIAL_API_HOSTS,
      commands: {
        'toggle-page-translation': {
          suggested_key: {
            default: 'Alt+A',
          },
          description: '__MSG_cmdTogglePage__',
        },
      },
    };

    if (browser === 'firefox') {
      return {
        ...base,
        optional_permissions: OPTIONAL_USER_HOSTS,
        browser_specific_settings: {
          gecko: {
            id: 'bitext-web-translator@bitext.dev',
            strict_min_version: '121.0',
            data_collection_permissions: {
              required: ['none'],
            },
          },
        },
      };
    }

    return {
      ...base,
      optional_host_permissions: OPTIONAL_USER_HOSTS,
    };
  },
});
