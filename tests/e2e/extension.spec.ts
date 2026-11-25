import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

declare const chrome: {
  tabs: {
    query(q: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, msg: unknown, opts?: { frameId?: number }): Promise<unknown>;
  };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const extensionPath = path.join(rootDir, '.output', 'chrome-mv3');
const fixturesDir = path.join(__dirname, 'fixtures');
const screenshotsDir = path.join(rootDir, 'test-results', 'screenshots');

function translateMockText(input: string): string {
  // Preserve <seg id="N">...</seg> and <bN>...</bN> markers deterministically
  if (input.includes('<seg id=')) {
    return input.replace(/<seg id="(\d+)">([\s\S]*?)<\/seg>/gu, (_m, id: string, body: string) => {
      return `<seg id="${id}">${translateSingleMock(body)}</seg>`;
    });
  }
  return translateSingleMock(input);
}

function translateSingleMock(text: string): string {
  const dict: Record<string, string> = {
    Home: '首頁',
    'Field Guides': '野外指南',
    Subscribe: '訂閱',
    'Life in the Tide Pools': '潮池裡的生命',
    'At low tide, a small pool forms between the rocks. The water stays cool even when the sun is high.':
      '退潮時，岩石之間會形成一個小水池。即使太陽高掛，池水依然清涼。',
    'Tiny animals wait for waves to return along the coast.':
      '微小的動物沿著海岸等待海浪歸來。',
  };
  if (dict[text]) return dict[text];
  // Handle inline tags like: Read the <b1><b0>coastal guide</b0></b1> and check <b2>tide_level.json</b2> for details.
  if (text.includes('coastal guide')) {
    return text
      .replace('Read the ', '請閱讀')
      .replace('coastal guide', '海岸指南')
      .replace(' and check ', '並查看')
      .replace(' for details.', '以了解詳情。');
  }
  return `【繁中譯文】${text}`;
}

async function startMockServer() {
  let llmCalls = 0;
  const llmInputs: string[] = [];
  let ollamaMode: 'ok' | 'cors_403' = 'ok';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (/^\/[\w-]+\.html$/u.test(url.pathname)) {
      const html = await fs.readFile(path.join(fixturesDir, url.pathname.slice(1)), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      llmCalls++;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const userMsg = payload.messages?.find((m) => m.role === 'user')?.content ?? '';
      llmInputs.push(userMsg);
      const reply = userMsg === 'Hello' ? 'OK' : translateMockText(userMsg);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
      return;
    }

    if (url.pathname === '/api/tags') {
      if (ollamaMode === 'cors_403') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }));
      return;
    }

    if (url.pathname === '/api/pull' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ status: 'downloading', completed: 50, total: 100 }) + '\n');
      res.write(JSON.stringify({ status: 'success', completed: 100, total: 100 }) + '\n');
      res.end();
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    getLlmCalls: () => llmCalls,
    getLlmInputs: () => [...llmInputs],
    resetLlmCalls: () => {
      llmCalls = 0;
      llmInputs.length = 0;
    },
    setOllamaMode: (mode: 'ok' | 'cors_403') => {
      ollamaMode = mode;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function findPlaywrightChromiumExecutable(): string | undefined {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return undefined;
  const candidate = path.join(localAppData, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');
  return candidate;
}

test.describe('BiText: Web Translator E2E', () => {
  let context: BrowserContext;
  let userDataDir: string;
  let extensionId: string;
  let mock: Awaited<ReturnType<typeof startMockServer>>;

  test.beforeAll(async () => {
    await fs.mkdir(screenshotsDir, { recursive: true });
    mock = await startMockServer();
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitext-e2e-'));

    const executablePath = findPlaywrightChromiumExecutable();
    const exists = executablePath
      ? await fs
          .access(executablePath)
          .then(() => true)
          .catch(() => false)
      : false;

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      ...(exists ? { executablePath } : { channel: 'chrome' }),
      args: [
        '--headless=new',
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: { width: 1280, height: 800 },
    });

    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    }
    extensionId = new URL(sw.url()).host;
    expect(extensionId).toBeTruthy();
  });

  test.afterAll(async () => {
    await context?.close();
    await mock?.close();
    if (userDataDir) {
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test('Onboarding wizard, Options (API, Ollama 403 & pull, Appearance), Webpage bilingual/only/restore, content-only feed, Chinese kept as written, and Selection popover', async () => {
    // 1. Onboarding wizard renders & switches to zh-TW
    const onboarding = await context.newPage();
    await onboarding.goto(`chrome-extension://${extensionId}/onboarding.html`);
    await onboarding.getByRole('button', { name: '繁體中文' }).click();
    await expect(onboarding.getByRole('heading', { name: '歡迎使用 BiText：網頁翻譯器' })).toBeVisible();
    await onboarding.screenshot({
      path: path.join(screenshotsDir, '01-onboarding-teal-warm.png'),
      fullPage: true,
    });
    await onboarding.getByRole('button', { name: '完成並開始使用' }).click();
    await expect(onboarding.getByText('準備好開始雙語閱讀了')).toBeVisible();
    await onboarding.close();

    // 2. Options page: test Ollama official setup guide + 403 CORS guidance + 200 detect + 1-click pull
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByRole('button', { name: /本機 Ollama/ }).click();
    await expect(options.getByRole('link', { name: 'ollama.com' })).toHaveAttribute('href', 'https://ollama.com');
    await expect(options.getByText('電腦裡已經有現成的 .gguf 模型（例如 Qwen）？')).toBeVisible();
    await options.locator('#bt-ollama-url').fill(mock.baseUrl);

    mock.setOllamaMode('cors_403');
    await options.getByRole('button', { name: '偵測 Ollama' }).click();
    await expect(options.getByText(/HTTP 403/)).toBeVisible();
    await expect(options.getByText(/OLLAMA_ORIGINS/)).toBeVisible();

    mock.setOllamaMode('ok');
    await options.getByRole('button', { name: '偵測 Ollama' }).click();
    await expect(options.getByText(/連線成功/)).toBeVisible();
    await options.getByRole('button', { name: '下載模型' }).first().click();
    await expect(options.getByText(/已下載並自動選用/)).toBeVisible();

    // Verify LM Studio official guide & existing .gguf folder guidance
    await options.getByRole('button', { name: /本機 LM Studio/ }).click();
    await expect(options.getByRole('link', { name: 'lmstudio.ai' })).toHaveAttribute('href', 'https://lmstudio.ai');
    await expect(options.getByText(/My Models/)).toBeVisible();

    // Configure Custom OpenAI-Compatible to mock server and activate it
    await options.getByRole('button', { name: /自訂 OpenAI 相容服務/ }).click();
    await options.locator('#bt-base-url').fill(`${mock.baseUrl}/v1`);
    await options.locator('#bt-model-openai-compatible').fill('mock-translator-v1');
    await options.getByRole('button', { name: '測試連線' }).click();
    await expect(options.getByText('連線成功')).toBeVisible();
    await options.getByRole('button', { name: '切換為此引擎' }).click();
    await options.screenshot({
      path: path.join(screenshotsDir, '02-options-providers.png'),
      fullPage: true,
    });

    // Test Appearance switching: Brick Red + Cool Paper + Dark, then back to Forest Teal + Warm + Light
    await options.getByRole('button', { name: '外觀風格' }).click();
    await options.getByRole('button', { name: '磚紅' }).click();
    await options.getByRole('radio', { name: '柔白微涼', exact: true }).click();
    await options.getByRole('radio', { name: '深色', exact: true }).click();
    await expect(options.locator('html')).toHaveAttribute('data-accent', 'brick');
    await expect(options.locator('html')).toHaveAttribute('data-paper', 'cool');
    await expect(options.getByRole('button', { name: '磚紅' })).toHaveAttribute('aria-pressed', 'true');
    await expect(options.getByRole('radio', { name: '柔白微涼', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(options.getByRole('radio', { name: '深色', exact: true })).toHaveAttribute('aria-checked', 'true');
    await options.screenshot({
      path: path.join(screenshotsDir, '03-options-appearance-brick-cool-dark.png'),
      fullPage: true,
    });

    // Switch back to official default: Forest Teal + Warm Ivory + Light for crisp default screenshots
    await options.getByRole('button', { name: '墨綠' }).click();
    await options.getByRole('radio', { name: '暖米白', exact: true }).click();
    await options.getByRole('radio', { name: '淺色', exact: true }).click();
    await options.close();

    // 3. Open English fixture webpage & translate via extension
    const page = await context.newPage();
    await page.goto(`${mock.baseUrl}/article-en.html`);
    await page.waitForTimeout(300);

    // Send commands to the active tab (mirroring real Popup & Alt+A without needing broad tabs permission)
    const sendActiveTab = async (command: unknown) => {
      const sw = context.serviceWorkers()[0]!;
      await sw.evaluate(async (cmd) => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) throw new Error('Active tab not found');
        await chrome.tabs.sendMessage(tab.id, cmd, { frameId: 0 });
      }, command);
    };

    await page.bringToFront();
    await sendActiveTab({ type: 'bt:enable-page' });

    // Verify bilingual translation inserted, inline link/strong/code preserved, notranslate & pre untouched
    await expect(page.locator('#title font.bt-target')).toContainText('潮池裡的生命', { timeout: 10_000 });
    await expect(page.locator('#p1 font.bt-target')).toContainText('退潮時，岩石之間會形成一個小水池');
    const translatedLink = page.locator('#p2 font.bt-target a');
    await expect(translatedLink).toHaveAttribute('href', 'https://example.com/guide');
    await expect(translatedLink.locator('strong')).toHaveText('海岸指南');
    await expect(page.locator('#p2 font.bt-target code')).toHaveText('tide_level.json');
    await expect(page.locator('#p3 font.bt-target')).toHaveCount(0);
    await expect(page.locator('#code-block font.bt-target')).toHaveCount(0);
    // Navigation links and buttons are controls, not content: they stay as written
    await expect(page.locator('nav font.bt-target')).toHaveCount(0);
    await expect(page.locator('#nav-home')).toHaveText('Home');
    await expect(page.locator('#nav-sub')).toHaveText('Subscribe');
    // One blank line between the original and the translation
    const gap = await page.locator('#p1 font.bt-target').evaluate((el) => {
      const style = getComputedStyle(el);
      return { margin: parseFloat(style.marginTop), line: parseFloat(style.lineHeight) };
    });
    expect(Math.abs(gap.margin - gap.line)).toBeLessThan(0.5);

    await page.screenshot({
      path: path.join(screenshotsDir, '04-page-bilingual-teal.png'),
      fullPage: true,
    });

    // Switch live to Translation-Only mode and verify original text hidden while translation remains
    await sendActiveTab({ type: 'bt:set-display-mode', mode: 'translation-only' });
    await expect(page.locator('html')).toHaveAttribute('data-bt-display', 'translation-only');
    await expect(page.locator('#p1 font.bt-target')).toBeVisible();

    // Restore original text completely
    await sendActiveTab({ type: 'bt:stop-page' });
    await expect(page.locator('font.bt-target')).toHaveCount(0);
    await expect(page.locator('#p1')).toContainText('At low tide, a small pool forms between the rocks.');
    await expect(page.locator('#nav-sub')).toHaveText('Subscribe');

    // 4. Test Selection Translation popover (explicit trigger via context menu / command)
    await sendActiveTab({
      type: 'bt:translate-selection-text',
      text: 'At low tide, a small pool forms between the rocks. The water stays cool even when the sun is high.',
    });

    const popover = page.locator('[data-bt-ui="selection-popover"]');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('退潮時，岩石之間會形成一個小水池');
    await page.screenshot({
      path: path.join(screenshotsDir, '05-selection-popover.png'),
    });
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);

    // 5. Capture Popup UI screenshot directly
    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 336, height: 390 });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popupPage.getByText('BiText：網頁翻譯器')).toBeVisible();
    await popupPage.screenshot({
      path: path.join(screenshotsDir, '06-popup-teal-warm.png'),
      fullPage: true,
    });
    await popupPage.close();

    // 6. A Simplified Chinese page stays as written: no conversion, no translation, zero LLM calls
    mock.resetLlmCalls();
    const cnPage = await context.newPage();
    await cnPage.goto(`${mock.baseUrl}/article-zh-cn.html`);
    await cnPage.waitForTimeout(300);
    await cnPage.bringToFront();
    await sendActiveTab({ type: 'bt:enable-page' });
    await cnPage.waitForTimeout(1000);

    await expect(cnPage.locator('#cn-title')).toHaveText('开源软件与在线视频工具');
    await expect(cnPage.locator('#cn-p1')).toContainText('鼠标框选');
    await expect(cnPage.locator('font.bt-target')).toHaveCount(0);
    expect(mock.getLlmCalls()).toBe(0);

    await sendActiveTab({ type: 'bt:stop-page' });
    await expect(cnPage.locator('#cn-title')).toHaveText('开源软件与在线视频工具');
    await cnPage.close();

    // 7. A social feed in a Chinese UI: only the foreign post is translated
    mock.resetLlmCalls();
    const feed = await context.newPage();
    await feed.goto(`${mock.baseUrl}/mixed-feed.html`);
    await feed.waitForTimeout(300);
    await feed.bringToFront();
    await sendActiveTab({ type: 'bt:enable-page' });

    await expect(feed.locator('#en-text font.bt-target')).toContainText('We just shipped a faster way', {
      timeout: 10_000,
    });
    await feed.waitForTimeout(800);
    // Account names, handles, controls, sidebar trends, addresses and Chinese posts stay as written
    await expect(feed.locator('font.bt-target')).toHaveCount(1);
    await expect(feed.locator('#cn-text')).toHaveText(
      '如果你正用 Orbit 4 Pro，强烈建议给你的 Agent 装一个 Nimbus 官方刚开源的工具',
    );
    await expect(feed.locator('#trend-title')).toHaveText('台灣的趨勢');
    await expect(feed.locator('#author-name')).toHaveText('The Daily Science Report');
    expect(mock.getLlmInputs().some((input) => /\p{Script=Han}/u.test(input))).toBe(false);

    const feedGap = await feed.locator('#en-text font.bt-target').evaluate((el) => {
      const style = getComputedStyle(el);
      return { margin: parseFloat(style.marginTop), line: parseFloat(style.lineHeight) };
    });
    expect(Math.abs(feedGap.margin - feedGap.line)).toBeLessThan(0.5);
    await feed.screenshot({
      path: path.join(screenshotsDir, '07-feed-content-only.png'),
      fullPage: true,
    });

    // A site rewrites an HTML comment and adds a post in the same mutation batch
    await feed.evaluate(() => {
      const main = document.getElementById('feed')!;
      const marker = [...main.childNodes].find((node) => node.nodeType === Node.COMMENT_NODE) as Comment;
      marker.data = 'feed-marker-updated';
      const article = document.createElement('article');
      const text = document.createElement('div');
      text.id = 'late-text';
      text.textContent = 'A late post arrives right after the page changed.';
      article.append(text);
      main.append(article);
    });
    await expect(feed.locator('#late-text font.bt-target')).toContainText('A late post arrives', {
      timeout: 10_000,
    });

    await sendActiveTab({ type: 'bt:stop-page' });
    await expect(feed.locator('font.bt-target')).toHaveCount(0);
    await feed.close();
    await page.close();
  });
});
