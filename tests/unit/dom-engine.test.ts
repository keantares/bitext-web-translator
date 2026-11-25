import { beforeEach, describe, expect, it } from 'vitest';
import { captureInlineLayout, renderInlineFragment } from '@/core/dom/inline';
import {
  extractSourceText,
  isAccountText,
  isBlock,
  isEligibleText,
  isFunctionalText,
  isLabelElement,
  isPredominantlyChinese,
  splitLongText,
} from '@/core/dom/paragraphs';

describe('paragraphs DOM extractor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts prose text while skipping code, script, notranslate, and hidden elements', () => {
    document.body.innerHTML = `
      <p id="p1">
        Hello <strong>world</strong>
        <span translate="no">DO NOT TRANSLATE</span>
        <span class="notranslate">SKIP ME</span>
        <span hidden>HIDDEN</span>
        <code>const x = 1;</code>
      </p>
    `;
    const p = document.getElementById('p1')!;
    expect(isBlock(p)).toBe(true);
    expect(extractSourceText(p)).toBe('Hello world');
  });

  it('identifies short UI labels and navigation links', () => {
    document.body.innerHTML = `
      <nav><a id="nav-link" href="/docs">Documentation</a></nav>
      <button id="btn">Sign in</button>
      <p id="para">A regular article paragraph.</p>
    `;
    expect(isLabelElement(document.getElementById('nav-link')!)).toBe(true);
    expect(isLabelElement(document.getElementById('btn')!)).toBe(true);
    expect(isLabelElement(document.getElementById('para')!)).toBe(false);
  });

  it('checks text eligibility, Chinese predominance, and sentence-boundary splitting', () => {
    expect(isEligibleText('Hello')).toBe(true);
    expect(isEligibleText('12345')).toBe(false);
    expect(isEligibleText('A')).toBe(false);

    expect(isPredominantlyChinese('這是一段繁體中文文章。')).toBe(true);
    expect(isPredominantlyChinese('これは日本語のテストです。')).toBe(false);
    expect(isPredominantlyChinese('This is mostly English text with 中文.')).toBe(false);

    const longText = 'Sentence one. '.repeat(150);
    const chunks = splitLongText(longText, 300);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 300)).toBe(true);
    expect(chunks.join('')).toBe(longText);
  });

  it('keeps Chinese posts that name English products as Chinese', () => {
    for (const text of [
      '学习 Nimbus Studio 必须关注的 5 个账号🔥 1、Nimbus Studio 官方 @nimbusstudio｜官方号 新功能第一时间在这发 桌面端更新、多 Agent 的 /swarm、工作区布局和插件生态这些动态都能看到',
      '如果你正用 Orbit 4 Pro，强烈建议给你的 Agent 装一个 Nimbus 官方刚开源的工具',
      '收藏收藏',
      '顯示更多\n© 2026 X Corp.',
      '這是一則繁體中文貼文，同樣不需要翻譯。',
    ]) {
      expect(isPredominantlyChinese(text), text).toBe(true);
    }
    for (const text of [
      'This is an English post about the new model release.',
      'Visit 台北 today',
      'An agent-first software development platform.',
      'これは日本語の投稿です。新しいモデルについて。',
      '새로운 모델에 대한 게시물입니다.',
      'build orbitlabs 324 天',
    ]) {
      expect(isPredominantlyChinese(text), text).toBe(false);
    }
  });

  it('leaves account names, handles and bare web addresses untranslated', () => {
    document.body.innerHTML = `
      <h2 id="top-bar">Sample Writer</h2>
      <article>
        <div><a id="author-name" href="/samplewriter">Sample Writer</a> <a id="author-handle" href="/samplewriter">@samplewriter</a></div>
        <div id="mention">Thanks @openai for the new model</div>
      </article>
      <div id="two-line">Sample Writer<br>@samplewriter</div>
      <button id="switcher">Sample Writer @samplewriter</button>
      <p id="address">github.com/example/repo</p>
      <p id="sentence">Visit example.com for the full story.</p>
    `;
    const check = (id: string) => {
      const el = document.getElementById(id)!;
      return isAccountText(el, extractSourceText(el));
    };
    // Name and handle links of the same profile are separate blocks.
    expect(isBlock(document.getElementById('author-name')!)).toBe(true);
    expect(check('author-name')).toBe(true);
    expect(check('author-handle')).toBe(true);
    expect(check('top-bar')).toBe(true);
    expect(check('two-line')).toBe(true);
    expect(check('switcher')).toBe(true);
    expect(check('address')).toBe(true);
    expect(check('mention')).toBe(false);
    expect(check('sentence')).toBe(false);
  });

  it('translates what people wrote and leaves controls, navigation, sidebars and short links alone', () => {
    document.body.innerHTML = `
      <nav><div id="nav-item">Explore the archive</div></nav>
      <button id="follow">Follow</button>
      <footer><p id="foot">© 2026 Example Inc. All rights reserved.</p></footer>
      <aside><div id="trend">Trending in Taiwan</div></aside>
      <article>
        <p id="body">This is a long article paragraph that people actually wrote.</p>
        <div id="show-more"><a href="/more">Show more</a></div>
        <div id="read-more-ja"><a href="/more">続きを読む</a></div>
        <div id="headline"><a href="/story">A much longer headline that should be read as content</a></div>
        <div role="link" tabindex="0"><div id="quote">Quoted post text</div></div>
        <aside><p id="inner-aside">An aside inside the article is still content.</p></aside>
      </article>
    `;
    const check = (id: string) => {
      const el = document.getElementById(id)!;
      return isFunctionalText(el, extractSourceText(el));
    };
    for (const id of ['nav-item', 'follow', 'foot', 'trend', 'show-more', 'read-more-ja']) {
      expect(check(id), id).toBe(true);
    }
    for (const id of ['body', 'headline', 'quote', 'inner-aside']) {
      expect(check(id), id).toBe(false);
    }
  });
});

describe('inline markup capture & XSS-safe rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('captures links, bold spans, and literal code blocks and reconstructs safely', () => {
    document.body.innerHTML = `
      <p id="p">Read the <a href="https://example.com/guide" target="_blank"><strong>official guide</strong></a> and edit <code>.gitignore</code>.</p>
    `;
    const p = document.getElementById('p')!;
    const layout = captureInlineLayout(p, (n) => n.data);
    expect(layout).not.toBeNull();
    expect(layout!.specs).toHaveLength(3);
    expect(layout!.pieces[0]?.text).toContain('<b1><b0>official guide</b0></b1>');
    expect(layout!.pieces[0]?.text).toContain('<b2>.gitignore</b2>');

    const fragment = renderInlineFragment(layout!, [
      '閱讀<b1><b0>官方指南</b0></b1>並編輯<b2>任意文字會被還原</b2>。',
    ]);
    const container = document.createElement('div');
    container.append(fragment);

    const anchor = container.querySelector('a')!;
    expect(anchor.href).toBe('https://example.com/guide');
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toBe('noopener');
    expect(anchor.querySelector('strong')?.textContent).toBe('官方指南');
    // Code literal must stay identical to original even if model altered text inside <b2>
    expect(container.querySelector('code')?.textContent).toBe('.gitignore');
  });

  it('falls back to safe plain text if model injects raw HTML or corrupts tag nesting', () => {
    document.body.innerHTML = `<p id="p">Visit <a href="https://example.com">home</a> now.</p>`;
    const p = document.getElementById('p')!;
    const layout = captureInlineLayout(p, (n) => n.data)!;

    // Broken closing tag + attempted XSS payload
    const fragment = renderInlineFragment(layout, ['造訪 <img src=x onerror=alert(1)> 首頁']);
    const container = document.createElement('div');
    container.append(fragment);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
