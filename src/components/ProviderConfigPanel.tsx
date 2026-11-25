import { useEffect, useRef, useState } from 'preact/hooks';
import { createTranslator, type MessageKey } from '@/core/i18n';
import {
  PORT_OLLAMA_PULL,
  type OllamaPullPortReply,
  type RuntimeMessage,
  type RuntimeReply,
} from '@/core/messaging/protocol';
import type { ProviderId, UserSettings } from '@/core/storage/types';
import { ANTHROPIC_PRESET_MODELS } from '@/core/translation/providers/anthropic';
import { checkChromeBuiltinAvailability } from '@/core/translation/providers/chrome-builtin';
import { GEMINI_PRESET_MODELS } from '@/core/translation/providers/gemini';
import {
  OLLAMA_CORS_COMMANDS,
  RECOMMENDED_OLLAMA_MODELS,
  type OllamaPullProgress,
} from '@/core/translation/providers/ollama';
import { OPENAI_PRESET_MODELS } from '@/core/translation/providers/openai';
import type { ProviderStatus } from '@/core/translation/types';
import { StatusNotice } from './Controls';
import { CheckIcon, CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, RefreshIcon } from './Icons';

export const PROVIDER_LABEL_KEY: Record<ProviderId, MessageKey> = {
  'chrome-builtin': 'providerChromeBuiltin',
  openai: 'providerOpenAI',
  anthropic: 'providerAnthropic',
  gemini: 'providerGemini',
  'openai-compatible': 'providerOpenAICompatible',
  ollama: 'providerOllama',
  lmstudio: 'providerLMStudio',
};

export const PROVIDER_DESC_KEY: Record<ProviderId, MessageKey> = {
  'chrome-builtin': 'providerChromeDesc',
  openai: 'providerOpenAIDesc',
  anthropic: 'providerAnthropicDesc',
  gemini: 'providerGeminiDesc',
  'openai-compatible': 'providerCustomDesc',
  ollama: 'providerOllamaDesc',
  lmstudio: 'providerLMStudioDesc',
};

const LOCAL_ORIGINS = ['http://127.0.0.1/*', 'http://localhost/*'];

function parseOriginPattern(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol === 'https:') return `${u.origin}/*`;
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
      return `http://${u.hostname}/*`;
    }
    return null;
  } catch {
    return null;
  }
}

export function ProviderConfigPanel({
  providerId,
  settings,
  onChangeSettings,
  showActivateButton = true,
}: {
  providerId: ProviderId;
  settings: UserSettings;
  onChangeSettings: (next: UserSettings) => void;
  showActivateButton?: boolean;
}) {
  const { locale, t } = createTranslator(settings.appearance.uiLocale);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [localPermGranted, setLocalPermGranted] = useState<boolean | null>(null);
  const [customOriginPattern, setCustomOriginPattern] = useState<string | null>(null);
  const [customPermGranted, setCustomPermGranted] = useState<boolean>(true);
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [corsOs, setCorsOs] = useState<'windows' | 'macos' | 'linux'>('windows');
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<OllamaPullProgress | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullDoneModel, setPullDoneModel] = useState<string | null>(null);
  const [customPullTag, setCustomPullTag] = useState('');
  const pullPortRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(null);

  useEffect(() => {
    setStatus(null);
    setPullError(null);
    setPullDoneModel(null);
    if (providerId === 'ollama' || providerId === 'lmstudio') {
      void browser.permissions
        ?.contains({ origins: LOCAL_ORIGINS })
        .then((granted) => setLocalPermGranted(granted))
        .catch(() => setLocalPermGranted(true));
    }
  }, [providerId]);

  useEffect(() => {
    if (providerId !== 'openai-compatible') return;
    const pattern = parseOriginPattern(settings.providers['openai-compatible'].baseUrl);
    setCustomOriginPattern(pattern);
    if (!pattern) {
      setCustomPermGranted(true);
      return;
    }
    void browser.permissions
      ?.contains({ origins: [pattern] })
      .then((granted) => setCustomPermGranted(granted))
      .catch(() => setCustomPermGranted(true));
  }, [providerId, settings.providers['openai-compatible'].baseUrl]);

  const handleGrantCustomOrigin = () => {
    if (!customOriginPattern) return;
    const req = browser.permissions?.request({ origins: [customOriginPattern] });
    if (!req) {
      setCustomPermGranted(true);
      return;
    }
    void req.then((granted) => setCustomPermGranted(granted));
  };

  useEffect(() => {
    return () => {
      pullPortRef.current?.disconnect();
    };
  }, []);

  const isActive = settings.activeProvider === providerId;

  const updateProviderField = <P extends keyof UserSettings['providers']>(
    provider: P,
    patch: Partial<UserSettings['providers'][P]>,
  ) => {
    onChangeSettings({
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: {
          ...settings.providers[provider],
          ...patch,
        },
      },
    });
  };

  // Must invoke browser.permissions.request synchronously inside click handler (no await before it!)
  const handleGrantLocalPermission = () => {
    const req = browser.permissions?.request({ origins: LOCAL_ORIGINS });
    if (!req) {
      setLocalPermGranted(true);
      return;
    }
    void req.then((granted) => {
      setLocalPermGranted(granted);
    });
  };

  const handleTestCloudOrBuiltin = async () => {
    setTesting(true);
    setStatus(null);
    try {
      if (providerId === 'chrome-builtin') {
        const res = await checkChromeBuiltinAvailability(
          settings.reading.sourceLang,
          settings.reading.targetLang,
        );
        setStatus(res);
      } else {
        const msg: RuntimeMessage = {
          type: 'bt:test-provider',
          settings,
          providerId,
        };
        const reply = (await browser.runtime.sendMessage(msg)) as RuntimeReply;
        if (reply.ok && reply.status) {
          setStatus(reply.status);
          if (reply.status.models) setDetectedModels(reply.status.models);
        } else {
          setStatus({ ok: false, code: 'unknown', message: reply.ok ? '' : reply.error });
        }
      }
    } catch (err) {
      setStatus({ ok: false, code: 'unknown', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleDetectLocal = async (kind: 'ollama' | 'lmstudio') => {
    setTesting(true);
    setStatus(null);
    try {
      const msg: RuntimeMessage =
        kind === 'ollama'
          ? { type: 'bt:ollama-detect', baseUrl: settings.providers.ollama.baseUrl }
          : { type: 'bt:lmstudio-detect', baseUrl: settings.providers.lmstudio.baseUrl };
      const reply = (await browser.runtime.sendMessage(msg)) as RuntimeReply;
      if (reply.ok && reply.status) {
        setStatus(reply.status);
        const models = reply.status.models ?? [];
        setDetectedModels(models);
        const currentModel = settings.providers[kind].model;
        if (models.length > 0 && (!currentModel || !models.includes(currentModel))) {
          updateProviderField(kind, { model: models[0] });
        }
      } else {
        setStatus({ ok: false, code: 'network', message: reply.ok ? '' : reply.error });
      }
    } finally {
      setTesting(false);
    }
  };

  const handlePullOllamaModel = (modelTag: string) => {
    const trimmed = modelTag.trim();
    if (!trimmed) return;
    pullPortRef.current?.disconnect();
    setPullingModel(trimmed);
    setPullProgress({ status: 'starting', percent: 0 });
    setPullError(null);
    setPullDoneModel(null);

    const port = browser.runtime.connect({ name: PORT_OLLAMA_PULL });
    pullPortRef.current = port;
    port.onMessage.addListener((reply: OllamaPullPortReply) => {
      if (reply.type === 'progress') {
        setPullProgress(reply.progress);
      } else if (reply.type === 'done') {
        setPullingModel(null);
        setPullProgress({ status: 'success', percent: 100 });
        setPullDoneModel(trimmed);
        updateProviderField('ollama', { model: trimmed });
        setDetectedModels((prev) => (prev.includes(trimmed) ? prev : [trimmed, ...prev]));
        port.disconnect();
      } else if (reply.type === 'error') {
        setPullingModel(null);
        setPullError(reply.message);
        if (reply.code === 'cors_403') {
          setStatus({ ok: false, code: 'cors_403', httpStatus: 403, message: reply.message });
        }
        port.disconnect();
      }
    });
    port.postMessage({
      type: 'pull',
      baseUrl: settings.providers.ollama.baseUrl,
      model: trimmed,
    });
  };

  const cancelPull = () => {
    pullPortRef.current?.disconnect();
    pullPortRef.current = null;
    setPullingModel(null);
    setPullProgress(null);
  };

  const copyCorsCommand = async () => {
    await navigator.clipboard.writeText(OLLAMA_CORS_COMMANDS[corsOs]).catch(() => {});
    setCopiedCmd(true);
    window.setTimeout(() => setCopiedCmd(false), 1600);
  };

  const inputClass =
    'w-full rounded-[8px] border border-[var(--bt-border)] bg-[var(--bt-surface)] px-3 py-2 text-[13px] text-[var(--bt-text)] placeholder:text-[var(--bt-text-muted)]';

  return (
    <div class="rounded-[14px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-5 space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <h3 class="bt-serif text-[17px] font-semibold text-[var(--bt-text)]">
              {t(PROVIDER_LABEL_KEY[providerId])}
            </h3>
            {isActive && (
              <span class="inline-flex items-center gap-1 rounded-full bg-[var(--bt-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--bt-accent)]">
                <CheckIcon size={12} /> {t('activeBadge')}
              </span>
            )}
          </div>
          <p class="mt-1 text-[13px] text-[var(--bt-text-muted)]">
            {t(PROVIDER_DESC_KEY[providerId])}
          </p>
        </div>

        {showActivateButton && !isActive && (
          <button
            type="button"
            onClick={() => onChangeSettings({ ...settings, activeProvider: providerId })}
            class="rounded-full bg-[var(--bt-accent)] px-4 py-1.5 text-[13px] font-semibold text-[var(--bt-on-accent)] cursor-pointer hover:opacity-95"
          >
            {t('useThisProvider')}
          </button>
        )}
      </div>

      {/* Chrome Built-in */}
      {providerId === 'chrome-builtin' && (
        <div class="space-y-3">
          <button
            type="button"
            onClick={handleTestCloudOrBuiltin}
            disabled={testing}
            class="inline-flex items-center gap-2 rounded-full border border-[var(--bt-border-strong)] bg-[var(--bt-surface-subtle)] px-4 py-1.5 text-[13px] font-medium text-[var(--bt-text)] cursor-pointer hover:border-[var(--bt-accent)]"
          >
            <RefreshIcon size={15} />
            {testing ? t('testingConnection') : t('chromeCheckBtn')}
          </button>

          {status && (
            <StatusNotice
              tone={
                status.code === 'ok'
                  ? 'success'
                  : status.code === 'downloadable' || status.code === 'downloading'
                    ? 'info'
                    : 'warning'
              }
            >
              {status.code === 'ok'
                ? t('chromeAvailable')
                : status.code === 'downloadable'
                  ? t('chromeDownloadable')
                  : status.code === 'downloading'
                    ? t('chromeDownloading')
                    : t('chromeUnavailable')}
            </StatusNotice>
          )}
        </div>
      )}

      {/* Cloud API Providers: OpenAI, Anthropic, Gemini, Custom */}
      {(providerId === 'openai' ||
        providerId === 'anthropic' ||
        providerId === 'gemini' ||
        providerId === 'openai-compatible') && (
        <div class="space-y-3.5">
          {providerId === 'openai-compatible' && (
            <div class="space-y-1.5">
              <label for="bt-base-url" class="block text-[13px] font-medium">
                {t('baseUrlLabel')}
              </label>
              <input
                id="bt-base-url"
                type="url"
                value={settings.providers['openai-compatible'].baseUrl}
                placeholder="https://openrouter.ai/api/v1"
                onInput={(e) =>
                  updateProviderField('openai-compatible', {
                    baseUrl: (e.target as HTMLInputElement).value,
                  })
                }
                class={inputClass}
              />
              <p class="text-[12px] text-[var(--bt-text-muted)]">{t('customLlamaServerTip')}</p>
              {customOriginPattern && !customPermGranted && (
                <button
                  type="button"
                  onClick={handleGrantCustomOrigin}
                  class="mt-1 rounded-full bg-[var(--bt-accent)] px-3.5 py-1 text-[12px] font-semibold text-[var(--bt-on-accent)] cursor-pointer"
                >
                  {t('grantCustomOrigin', { origin: customOriginPattern.replace('/*', '') })}
                </button>
              )}
            </div>
          )}

          <div class="space-y-1">
            <label for={`bt-key-${providerId}`} class="block text-[13px] font-medium">
              {t('apiKeyLabel')}
            </label>
            <div class="flex gap-2">
              <input
                id={`bt-key-${providerId}`}
                type={showKey ? 'text' : ('password' as 'text')}
                autocomplete="off"
                spellcheck={false}
                value={settings.providers[providerId].apiKey}
                placeholder={t('apiKeyPlaceholder')}
                onInput={(e) =>
                  updateProviderField(providerId, {
                    apiKey: (e.target as HTMLInputElement).value,
                  })
                }
                class={`${inputClass} flex-1 bt-mono`}
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? t('hideKey') : t('showKey')}
                class="inline-flex items-center gap-1 rounded-[8px] border border-[var(--bt-border)] px-3 text-[12px] text-[var(--bt-text-muted)] cursor-pointer hover:text-[var(--bt-text)]"
              >
                {showKey ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                {showKey ? t('hideKey') : t('showKey')}
              </button>
            </div>
            <p class="text-[12px] text-[var(--bt-text-muted)]">{t('apiKeyHint')}</p>
          </div>

          <div class="space-y-1.5">
            <label for={`bt-model-${providerId}`} class="block text-[13px] font-medium">
              {t('modelLabel')}
            </label>
            {providerId !== 'openai-compatible' && (
              <div class="flex flex-wrap gap-1.5 mb-1.5">
                {(providerId === 'openai'
                  ? OPENAI_PRESET_MODELS
                  : providerId === 'anthropic'
                    ? ANTHROPIC_PRESET_MODELS
                    : GEMINI_PRESET_MODELS
                ).map((preset) => {
                  const picked = settings.providers[providerId].model === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => updateProviderField(providerId, { model: preset })}
                      class={`rounded-full border px-2.5 py-0.5 text-[12px] bt-mono cursor-pointer transition-colors ${
                        picked
                          ? 'border-[var(--bt-accent)] bg-[var(--bt-accent-soft)] text-[var(--bt-accent)] font-semibold'
                          : 'border-[var(--bt-border)] text-[var(--bt-text-muted)] hover:text-[var(--bt-text)]'
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              id={`bt-model-${providerId}`}
              type="text"
              value={settings.providers[providerId].model}
              placeholder={t('customModelPlaceholder')}
              onInput={(e) =>
                updateProviderField(providerId, {
                  model: (e.target as HTMLInputElement).value,
                })
              }
              class={`${inputClass} bt-mono`}
            />
          </div>

          <div class="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestCloudOrBuiltin}
              disabled={testing}
              class="inline-flex items-center gap-2 rounded-full border border-[var(--bt-border-strong)] bg-[var(--bt-surface-subtle)] px-4 py-1.5 text-[13px] font-medium text-[var(--bt-text)] cursor-pointer hover:border-[var(--bt-accent)]"
            >
              <RefreshIcon size={15} />
              {testing ? t('testingConnection') : t('testConnection')}
            </button>
          </div>

          {status && (
            <StatusNotice tone={status.ok ? 'success' : 'error'}>
              {status.ok ? t('connectionOk') : status.message || status.code}
            </StatusNotice>
          )}
        </div>
      )}

      {/* Local Ollama */}
      {providerId === 'ollama' && (
        <div class="space-y-4">
          <div class="rounded-[10px] border border-[var(--bt-border)] bg-[var(--bt-surface-subtle)] p-3.5 text-[12px] space-y-1.5 leading-relaxed">
            <div class="font-semibold text-[var(--bt-text)]">{t('ollamaSetupTitle')}</div>
            <p class="text-[var(--bt-text-muted)]">
              {t('ollamaSetupStep1')}{' '}
              <a
                href="https://ollama.com"
                target="_blank"
                rel="noopener noreferrer"
                class="font-medium text-[var(--bt-accent)] underline"
              >
                ollama.com
              </a>
            </p>
            <p class="text-[var(--bt-text-muted)]">{t('ollamaSetupStep2')}</p>
            <details class="pt-1">
              <summary class="cursor-pointer font-medium text-[var(--bt-text)]">
                {t('ollamaExistingGgufTitle')}
              </summary>
              <p class="mt-1.5 text-[var(--bt-text-muted)]">{t('ollamaExistingGgufDesc')}</p>
              <pre class="mt-1.5 rounded-[7px] border border-[var(--bt-border)] bg-[var(--bt-surface)] px-2.5 py-1.5 bt-mono text-[11px] overflow-x-auto">
                ollama create my-qwen -f Modelfile
              </pre>
            </details>
          </div>

          <div class="space-y-1">
            <label for="bt-ollama-url" class="block text-[13px] font-medium">
              {t('baseUrlLabel')}
            </label>
            <input
              id="bt-ollama-url"
              type="url"
              value={settings.providers.ollama.baseUrl}
              onInput={(e) =>
                updateProviderField('ollama', { baseUrl: (e.target as HTMLInputElement).value })
              }
              class={`${inputClass} bt-mono`}
            />
          </div>

          <div class="flex flex-wrap items-center gap-2">
            {localPermGranted === false && (
              <button
                type="button"
                onClick={handleGrantLocalPermission}
                class="rounded-full bg-[var(--bt-accent)] px-4 py-1.5 text-[13px] font-semibold text-[var(--bt-on-accent)] cursor-pointer"
              >
                {t('grantLocalPermission')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleDetectLocal('ollama')}
              disabled={testing}
              class="inline-flex items-center gap-2 rounded-full border border-[var(--bt-border-strong)] bg-[var(--bt-surface-subtle)] px-4 py-1.5 text-[13px] font-medium text-[var(--bt-text)] cursor-pointer hover:border-[var(--bt-accent)]"
            >
              <RefreshIcon size={15} />
              {testing ? t('testingConnection') : t('detectOllamaBtn')}
            </button>
          </div>

          {/* 403 CORS Guidance */}
          {status && status.code === 'cors_403' && (
            <div class="rounded-[12px] border border-[var(--bt-warning)]/40 bg-[var(--bt-warning-soft)] p-4 space-y-2.5 text-[13px]">
              <div class="font-semibold text-[var(--bt-warning)]">{t('ollamaCorsTitle')}</div>
              <p class="text-[var(--bt-text)] leading-relaxed">{t('ollamaCorsDesc')}</p>
              <div class="flex gap-1.5 text-[12px]">
                {(['windows', 'macos', 'linux'] as const).map((os) => (
                  <button
                    key={os}
                    type="button"
                    onClick={() => setCorsOs(os)}
                    class={`rounded-md px-2.5 py-1 capitalize cursor-pointer ${
                      corsOs === os
                        ? 'bg-[var(--bt-surface)] font-semibold text-[var(--bt-text)] border border-[var(--bt-border)]'
                        : 'text-[var(--bt-text-muted)]'
                    }`}
                  >
                    {os === 'macos' ? 'macOS' : os}
                  </button>
                ))}
              </div>
              <div class="relative rounded-[8px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-3 pr-20 bt-mono text-[12px] whitespace-pre-wrap break-all">
                {OLLAMA_CORS_COMMANDS[corsOs]}
                <button
                  type="button"
                  onClick={copyCorsCommand}
                  class="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md border border-[var(--bt-border)] bg-[var(--bt-surface-subtle)] px-2 py-1 text-[11px] font-sans cursor-pointer"
                >
                  <CopyIcon size={13} />
                  {copiedCmd ? t('copied') : t('copy')}
                </button>
              </div>
            </div>
          )}

          {status && status.code !== 'cors_403' && (
            <StatusNotice tone={status.ok ? 'success' : 'error'}>
              {status.ok
                ? detectedModels.length > 0
                  ? `${t('connectionOk')} (${detectedModels.length})`
                  : t('noModelsFound')
                : status.code === 'network'
                  ? t('ollamaNotRunning')
                  : status.message || status.code}
            </StatusNotice>
          )}

          {/* Installed model select or manual input */}
          <div class="space-y-1.5">
            <label for="bt-ollama-model" class="block text-[13px] font-medium">
              {t('installedModels')}
            </label>
            {detectedModels.length > 0 && (
              <select
                id="bt-ollama-model"
                value={settings.providers.ollama.model}
                onChange={(e) =>
                  updateProviderField('ollama', { model: (e.target as HTMLSelectElement).value })
                }
                class={`${inputClass} bt-mono`}
              >
                {detectedModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            <input
              type="text"
              value={settings.providers.ollama.model}
              placeholder="qwen2.5:3b"
              onInput={(e) =>
                updateProviderField('ollama', { model: (e.target as HTMLInputElement).value })
              }
              class={`${inputClass} bt-mono`}
            />
          </div>

          {/* One-click download recommended local translation models */}
          <div class="rounded-[12px] border border-[var(--bt-border)] bg-[var(--bt-surface-subtle)] p-4 space-y-3">
            <div class="text-[13px] font-semibold text-[var(--bt-text)]">
              {t('recommendedModelsTitle')}
            </div>
            <div class="space-y-2">
              {RECOMMENDED_OLLAMA_MODELS.map((rec) => {
                const installed = detectedModels.some(
                  (m) => m === rec.name || m.startsWith(`${rec.name}-`),
                );
                const isPulling = pullingModel === rec.name;
                return (
                  <div
                    key={rec.name}
                    class="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--bt-border)] bg-[var(--bt-surface)] px-3 py-2.5"
                  >
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="bt-mono text-[13px] font-semibold text-[var(--bt-text)]">
                          {rec.name}
                        </span>
                        <span class="text-[11px] text-[var(--bt-text-muted)]">{rec.sizeLabel}</span>
                        {rec.recommended && (
                          <span class="rounded-full bg-[var(--bt-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--bt-accent)]">
                            {t('recommendedTag')}
                          </span>
                        )}
                      </div>
                      <p class="text-[12px] text-[var(--bt-text-muted)] mt-0.5">
                        {locale === 'zh-TW' ? rec.noteZhTw : rec.noteEn}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(pullingModel)}
                      onClick={() => handlePullOllamaModel(rec.name)}
                      class="inline-flex items-center gap-1.5 rounded-full border border-[var(--bt-accent)] px-3 py-1 text-[12px] font-medium text-[var(--bt-accent)] cursor-pointer hover:bg-[var(--bt-accent-soft)] disabled:opacity-50"
                    >
                      <DownloadIcon size={14} />
                      {isPulling ? t('downloadingModel', { model: rec.name }) : installed ? t('useThisProvider') : t('downloadModel')}
                    </button>
                  </div>
                );
              })}
            </div>

            <div class="flex gap-2">
              <input
                type="text"
                value={customPullTag}
                placeholder={t('customOllamaPlaceholder')}
                onInput={(e) => setCustomPullTag((e.target as HTMLInputElement).value)}
                class={`${inputClass} flex-1 bt-mono`}
              />
              <button
                type="button"
                disabled={!customPullTag.trim() || Boolean(pullingModel)}
                onClick={() => handlePullOllamaModel(customPullTag)}
                class="rounded-full bg-[var(--bt-accent)] px-4 py-1.5 text-[12px] font-semibold text-[var(--bt-on-accent)] cursor-pointer disabled:opacity-50"
              >
                {t('downloadModel')}
              </button>
            </div>

            {pullingModel && pullProgress && (
              <div class="rounded-[10px] border border-[var(--bt-border)] bg-[var(--bt-surface)] p-3 space-y-2">
                <div class="flex items-center justify-between text-[12px]">
                  <span>
                    {t('downloadingModel', { model: pullingModel })} ({pullProgress.status}
                    {typeof pullProgress.percent === 'number' ? ` ${pullProgress.percent}%` : ''})
                  </span>
                  <button
                    type="button"
                    onClick={cancelPull}
                    class="text-[var(--bt-danger)] cursor-pointer underline"
                  >
                    {t('cancel')}
                  </button>
                </div>
                <progress
                  class="w-full h-2"
                  max={100}
                  value={pullProgress.percent}
                />
              </div>
            )}

            {pullDoneModel && (
              <StatusNotice tone="success">
                {t('downloadDone', { model: pullDoneModel })}
              </StatusNotice>
            )}
            {pullError && <StatusNotice tone="error">{pullError}</StatusNotice>}
          </div>
        </div>
      )}

      {/* Local LM Studio */}
      {providerId === 'lmstudio' && (
        <div class="space-y-3.5">
          <div class="rounded-[10px] border border-[var(--bt-border)] bg-[var(--bt-surface-subtle)] p-3.5 text-[12px] space-y-1.5 leading-relaxed">
            <div class="font-semibold text-[var(--bt-text)]">{t('lmstudioSetupTitle')}</div>
            <p class="text-[var(--bt-text-muted)]">
              {t('lmstudioSetupStep1')}{' '}
              <a
                href="https://lmstudio.ai"
                target="_blank"
                rel="noopener noreferrer"
                class="font-medium text-[var(--bt-accent)] underline"
              >
                lmstudio.ai
              </a>
            </p>
            <p class="text-[var(--bt-text-muted)]">{t('lmstudioSetupStep2')}</p>
            <p class="text-[var(--bt-text-muted)]">{t('lmstudioSetupStep3')}</p>
          </div>

          <div class="space-y-1">
            <label for="bt-lms-url" class="block text-[13px] font-medium">
              {t('baseUrlLabel')}
            </label>
            <input
              id="bt-lms-url"
              type="url"
              value={settings.providers.lmstudio.baseUrl}
              onInput={(e) =>
                updateProviderField('lmstudio', { baseUrl: (e.target as HTMLInputElement).value })
              }
              class={`${inputClass} bt-mono`}
            />
          </div>

          <div class="flex flex-wrap items-center gap-2">
            {localPermGranted === false && (
              <button
                type="button"
                onClick={handleGrantLocalPermission}
                class="rounded-full bg-[var(--bt-accent)] px-4 py-1.5 text-[13px] font-semibold text-[var(--bt-on-accent)] cursor-pointer"
              >
                {t('grantLocalPermission')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleDetectLocal('lmstudio')}
              disabled={testing}
              class="inline-flex items-center gap-2 rounded-full border border-[var(--bt-border-strong)] bg-[var(--bt-surface-subtle)] px-4 py-1.5 text-[13px] font-medium text-[var(--bt-text)] cursor-pointer hover:border-[var(--bt-accent)]"
            >
              <RefreshIcon size={15} />
              {testing ? t('testingConnection') : t('detectLMStudioBtn')}
            </button>
          </div>

          <p class="text-[12px] text-[var(--bt-text-muted)]">{t('lmstudioCorsHint')}</p>

          {status && (
            <StatusNotice tone={status.ok ? 'success' : 'error'}>
              {status.ok
                ? `${t('connectionOk')} (${detectedModels.length})`
                : status.code === 'network'
                  ? t('lmstudioNotRunning')
                  : status.message || status.code}
            </StatusNotice>
          )}

          <div class="space-y-1">
            <label for="bt-lms-model" class="block text-[13px] font-medium">
              {t('modelLabel')}
            </label>
            {detectedModels.length > 0 ? (
              <select
                id="bt-lms-model"
                value={settings.providers.lmstudio.model}
                onChange={(e) =>
                  updateProviderField('lmstudio', { model: (e.target as HTMLSelectElement).value })
                }
                class={`${inputClass} bt-mono`}
              >
                {detectedModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="bt-lms-model"
                type="text"
                value={settings.providers.lmstudio.model}
                placeholder={t('customModelPlaceholder')}
                onInput={(e) =>
                  updateProviderField('lmstudio', { model: (e.target as HTMLInputElement).value })
                }
                class={`${inputClass} bt-mono`}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
