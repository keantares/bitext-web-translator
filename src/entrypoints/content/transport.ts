import type { ResolvedLocale } from '@/core/i18n';
import {
  PORT_TRANSLATE,
  type PortTranslateMessage,
  type PortTranslateReply,
  type RuntimeMessage,
} from '@/core/messaging/protocol';
import type { UserSettings } from '@/core/storage/types';
import { ChromeBuiltinClient } from '@/core/translation/providers/chrome-builtin';
import {
  TranslationError,
  type ErrorCode,
  type TranslateFormat,
  type TranslateItem,
  type TranslatedItem,
} from '@/core/translation/types';

export function formatErrorMessage(code: ErrorCode, locale: ResolvedLocale, fallback?: string): string {
  const zh = locale === 'zh-TW';
  switch (code) {
    case 'missing_key':
      return zh ? '尚未設定 API 金鑰，請先到設定頁填寫。' : 'API key is not configured yet. Open Settings to add it.';
    case 'missing_model':
      return zh ? '尚未選擇翻譯模型，請到設定頁選擇。' : 'No translation model selected. Choose one in Settings.';
    case 'missing_url':
      return zh ? '尚未填寫 API 網址，請到設定頁設定。' : 'API endpoint URL is missing. Configure it in Settings.';
    case 'auth_failed':
      return zh ? 'API 金鑰驗證失敗，請檢查設定是否正確。' : 'API authentication failed. Please check your key in Settings.';
    case 'rate_limited':
      return zh ? '請求過於頻繁或額度已滿，請稍後重試。' : 'Rate limit or quota reached. Please try again shortly.';
    case 'cors_403':
      return zh
        ? '本機模型拒絕連線（HTTP 403），請到設定頁檢視 CORS 設定步驟。'
        : 'Local model rejected browser origin (HTTP 403). Open Settings for CORS setup.';
    case 'network':
      return zh ? '無法連線到翻譯服務，請檢查網路或本機服務是否啟動。' : 'Could not reach the translation server. Check network or local service.';
    case 'unavailable':
      return zh
        ? '目前瀏覽器或語言組合不支援 Chrome 內建翻譯，請改用其他引擎。'
        : 'Chrome Built-in Translator is unavailable for this browser or language pair. Switch provider in Settings.';
    case 'aborted':
      return zh ? '已取消翻譯。' : 'Translation cancelled.';
    default:
      return fallback || (zh ? '翻譯失敗，請重試。' : 'Translation failed. Please retry.');
  }
}

type PortTranslatePayload = PortTranslateMessage extends infer M
  ? M extends PortTranslateMessage
    ? Omit<M, 'id'>
    : never
  : never;

export class ContentTransport {
  private port: ReturnType<typeof browser.runtime.connect> | null = null;
  private seq = 0;
  private readonly pending = new Map<
    number,
    { resolve: (reply: PortTranslateReply) => void; reject: (err: unknown) => void }
  >();
  private readonly builtinClient = new ChromeBuiltinClient();

  private ensurePort() {
    if (this.port) return this.port;
    const opened = browser.runtime.connect({ name: PORT_TRANSLATE });
    this.port = opened;
    opened.onMessage.addListener((reply: PortTranslateReply) => {
      const entry = this.pending.get(reply.id);
      if (!entry) return;
      this.pending.delete(reply.id);
      entry.resolve(reply);
    });
    opened.onDisconnect.addListener(() => {
      if (this.port !== opened) return;
      this.port = null;
      const err = new TranslationError('network', 'Background connection disconnected');
      for (const entry of this.pending.values()) {
        entry.reject(err);
      }
      this.pending.clear();
    });
    return opened;
  }

  private sendPort(payload: PortTranslatePayload): Promise<PortTranslateReply> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      try {
        this.ensurePort().postMessage({ ...payload, id });
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async translateItems(params: {
    settings: UserSettings;
    items: TranslateItem[];
    sourceLang: string;
    targetLang: string;
    format: TranslateFormat;
    priority: 1 | 2;
    context?: string;
    signal?: AbortSignal;
    onBuiltinDownload?: (percent: number) => void;
  }): Promise<TranslatedItem[]> {
    if (params.settings.activeProvider === 'chrome-builtin') {
      const res = await this.builtinClient.translateBatch(
        {
          items: params.items,
          sourceLang: params.sourceLang,
          targetLang: params.targetLang,
          format: 'text',
          context: params.context,
          signal: params.signal,
        },
        params.onBuiltinDownload,
      );
      // Normalize Taiwan Traditional phrasing offline via background OpenCC when targeting zh-TW
      if (params.targetLang === 'zh-TW') {
        const joined = res.items.map((item) => item.text);
        let sep = '\u001f';
        while (joined.some((s) => s.includes(sep))) sep += '\u001e';
        const converted = await this.convertText(joined.join(sep), true).catch(() => null);
        if (converted) {
          const parts = converted.split(sep);
          if (parts.length === res.items.length) {
            return res.items.map((item, idx) => ({
              ...item,
              text: parts[idx] ?? item.text,
            }));
          }
        }
      }
      return res.items;
    }

    const reply = await this.sendPort({
      type: 'translate',
      items: params.items,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      format: params.format,
      priority: params.priority,
      context: params.context,
    });
    if (!reply.ok) {
      throw new TranslationError(reply.code, reply.message, { httpStatus: reply.httpStatus });
    }
    return reply.items ?? [];
  }

  async convertText(text: string, useTaiwanPhrases = true): Promise<string> {
    const reply = await this.sendPort({
      type: 'convert',
      text,
      useTaiwanPhrases,
    });
    if (!reply.ok || typeof reply.text !== 'string') {
      throw new TranslationError(reply.ok ? 'invalid_response' : reply.code, 'Conversion failed');
    }
    return reply.text;
  }

  async openOptions(section?: string): Promise<void> {
    const msg: RuntimeMessage = { type: 'bt:open-options', section };
    await browser.runtime.sendMessage(msg).catch(() => {});
  }

  async updateBadge(text: string): Promise<void> {
    const msg: RuntimeMessage = { type: 'bt:badge', text };
    await browser.runtime.sendMessage(msg).catch(() => {});
  }

  disconnect(): void {
    this.port?.disconnect();
    this.port = null;
    this.pending.clear();
  }
}
