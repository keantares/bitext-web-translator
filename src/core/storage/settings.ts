import { DEFAULT_SETTINGS, type ProviderId, type UserSettings } from './types';

const STORAGE_KEY = 'bitext:settings:v1';

interface StorageAreaLike {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface StorageApiLike {
  local: StorageAreaLike;
  onChanged?: {
    addListener(cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
    removeListener(cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
  };
}

function getStorageApi(): StorageApiLike | null {
  const g = globalThis as {
    browser?: { storage?: StorageApiLike };
    chrome?: { storage?: StorageApiLike };
  };
  return g.browser?.storage ?? g.chrome?.storage ?? null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeSettings(partial?: Partial<UserSettings> | null): UserSettings {
  if (!isPlainObject(partial)) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const p = partial as Partial<UserSettings>;
  const providers = p.providers ?? ({} as Partial<UserSettings['providers']>);
  return {
    onboardingCompleted:
      typeof p.onboardingCompleted === 'boolean'
        ? p.onboardingCompleted
        : DEFAULT_SETTINGS.onboardingCompleted,
    activeProvider: p.activeProvider ?? DEFAULT_SETTINGS.activeProvider,
    providers: {
      openai: { ...DEFAULT_SETTINGS.providers.openai, ...(providers.openai ?? {}) },
      anthropic: { ...DEFAULT_SETTINGS.providers.anthropic, ...(providers.anthropic ?? {}) },
      gemini: { ...DEFAULT_SETTINGS.providers.gemini, ...(providers.gemini ?? {}) },
      'openai-compatible': {
        ...DEFAULT_SETTINGS.providers['openai-compatible'],
        ...(providers['openai-compatible'] ?? {}),
      },
      ollama: { ...DEFAULT_SETTINGS.providers.ollama, ...(providers.ollama ?? {}) },
      lmstudio: { ...DEFAULT_SETTINGS.providers.lmstudio, ...(providers.lmstudio ?? {}) },
    },
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      ...(p.appearance ?? {}),
    },
    reading: {
      ...DEFAULT_SETTINGS.reading,
      ...(p.reading ?? {}),
      alwaysTranslateHosts: Array.isArray(p.reading?.alwaysTranslateHosts)
        ? [...new Set(p.reading.alwaysTranslateHosts.map((h) => h.trim().toLowerCase()).filter(Boolean))]
        : [...DEFAULT_SETTINGS.reading.alwaysTranslateHosts],
      neverTranslateHosts: Array.isArray(p.reading?.neverTranslateHosts)
        ? [...new Set(p.reading.neverTranslateHosts.map((h) => h.trim().toLowerCase()).filter(Boolean))]
        : [...DEFAULT_SETTINGS.reading.neverTranslateHosts],
    },
    cache: {
      ...DEFAULT_SETTINGS.cache,
      ...(p.cache ?? {}),
    },
  };
}

export async function getSettings(): Promise<UserSettings> {
  const storage = getStorageApi();
  if (!storage) return structuredClone(DEFAULT_SETTINGS);
  const raw = await storage.local.get(STORAGE_KEY);
  return mergeSettings(raw[STORAGE_KEY] as Partial<UserSettings> | undefined);
}

let writeChain: Promise<unknown> = Promise.resolve();

export async function saveSettings(next: UserSettings): Promise<UserSettings> {
  const normalized = mergeSettings(next);
  const storage = getStorageApi();
  if (storage) {
    const task = writeChain.then(() => storage.local.set({ [STORAGE_KEY]: normalized }));
    writeChain = task.catch(() => {});
    await task;
  }
  return normalized;
}

export async function updateSettings(
  updater: (current: UserSettings) => UserSettings,
): Promise<UserSettings> {
  let result!: UserSettings;
  const task = writeChain.then(async () => {
    const current = await getSettings();
    const next = mergeSettings(updater(current));
    const storage = getStorageApi();
    if (storage) {
      await storage.local.set({ [STORAGE_KEY]: next });
    }
    result = next;
  });
  writeChain = task.catch(() => {});
  await task;
  return result;
}

export async function resetSettings(): Promise<UserSettings> {
  return saveSettings(structuredClone(DEFAULT_SETTINGS));
}

export function subscribeSettings(listener: (settings: UserSettings) => void): () => void {
  const storage = getStorageApi();
  if (!storage?.onChanged) return () => {};
  const handler = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !(STORAGE_KEY in changes)) return;
    listener(mergeSettings(changes[STORAGE_KEY].newValue as Partial<UserSettings> | undefined));
  };
  storage.onChanged.addListener(handler);
  return () => storage.onChanged?.removeListener(handler);
}

export function exportSettingsJson(settings: UserSettings, includeApiKeys: boolean): string {
  const copy = mergeSettings(settings);
  if (!includeApiKeys) {
    copy.providers.openai.apiKey = '';
    copy.providers.anthropic.apiKey = '';
    copy.providers.gemini.apiKey = '';
    copy.providers['openai-compatible'].apiKey = '';
  }
  return JSON.stringify(copy, null, 2);
}

export function importSettingsJson(json: string, current: UserSettings): UserSettings {
  const parsed = JSON.parse(json) as Partial<UserSettings>;
  const merged = mergeSettings(parsed);
  // Preserve existing keys when the imported file omitted them intentionally
  if (!merged.providers.openai.apiKey && current.providers.openai.apiKey) {
    merged.providers.openai.apiKey = current.providers.openai.apiKey;
  }
  if (!merged.providers.anthropic.apiKey && current.providers.anthropic.apiKey) {
    merged.providers.anthropic.apiKey = current.providers.anthropic.apiKey;
  }
  if (!merged.providers.gemini.apiKey && current.providers.gemini.apiKey) {
    merged.providers.gemini.apiKey = current.providers.gemini.apiKey;
  }
  if (!merged.providers['openai-compatible'].apiKey && current.providers['openai-compatible'].apiKey) {
    merged.providers['openai-compatible'].apiKey = current.providers['openai-compatible'].apiKey;
  }
  return merged;
}

export function isProviderConfigured(settings: UserSettings, id: ProviderId): boolean {
  switch (id) {
    case 'chrome-builtin':
      return true;
    case 'openai':
      return Boolean(settings.providers.openai.apiKey.trim() && settings.providers.openai.model.trim());
    case 'anthropic':
      return Boolean(settings.providers.anthropic.apiKey.trim() && settings.providers.anthropic.model.trim());
    case 'gemini':
      return Boolean(settings.providers.gemini.apiKey.trim() && settings.providers.gemini.model.trim());
    case 'openai-compatible':
      return Boolean(
        settings.providers['openai-compatible'].baseUrl.trim() &&
          settings.providers['openai-compatible'].model.trim(),
      );
    case 'ollama':
      return Boolean(settings.providers.ollama.baseUrl.trim() && settings.providers.ollama.model.trim());
    case 'lmstudio':
      return Boolean(settings.providers.lmstudio.baseUrl.trim() && settings.providers.lmstudio.model.trim());
  }
}

export function getProviderDisplayModel(settings: UserSettings, id: ProviderId): string {
  switch (id) {
    case 'chrome-builtin':
      return '';
    case 'openai':
      return settings.providers.openai.model;
    case 'anthropic':
      return settings.providers.anthropic.model;
    case 'gemini':
      return settings.providers.gemini.model;
    case 'openai-compatible':
      return settings.providers['openai-compatible'].model;
    case 'ollama':
      return settings.providers.ollama.model;
    case 'lmstudio':
      return settings.providers.lmstudio.model;
  }
}
