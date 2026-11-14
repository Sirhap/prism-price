/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from "cloudflare:test";
import { describe, expect, it } from 'vitest';

describe('静态 SEO 内容', () => {
  it('首页有一致的规范地址、可见介绍及有效网站结构化数据', async () => {
    const html = await (await SELF.fetch('http://localhost/')).text();
    expect(html).toContain('<link rel="canonical" href="https://parity.sirhao.top/"');
    expect(html).toContain('关于棱镜比价');
    expect(html).not.toContain('全网真实底价');
    const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    expect(json).toBeTruthy();
    expect(JSON.parse(json!)).toMatchObject({ '@type': 'WebSite', url: 'https://parity.sirhao.top/' });
  });
  it('robots 和网站地图指向真实首页且不收录 API', async () => {
    const robots = await (await SELF.fetch('http://localhost/robots.txt')).text();
    const sitemap = await (await SELF.fetch('http://localhost/sitemap.xml')).text();
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Sitemap: https://parity.sirhao.top/sitemap.xml');
    expect(sitemap).toContain('<loc>https://parity.sirhao.top/</loc>');
    expect(sitemap).toContain('<loc>https://parity.sirhao.top/guide/</loc>');
    const guide = await SELF.fetch('http://localhost/guide/');
    expect(guide.status).toBe(200);
    expect(await guide.text()).toContain('AI 订阅比价指南');
  });

  it('首页保持简洁工作台，移除底部独立介绍框并在页脚最下方提供真实可达的导航链接', async () => {
    const html = await (await SELF.fetch('http://localhost/')).text();
    expect(html).toContain('<meta name="keywords"');
    expect(html).toContain('<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"');
    expect(html).toContain('<link rel="alternate" type="text/plain" href="/llms.txt"');
    expect(html).not.toContain('<section class="seo-about"');

    // 验证最底部 site-footer-links 包含直达入口且每个链接真实可访问（返回 200）
    const footerMatch = html.match(/<div class="site-footer-links">([\s\S]*?)<\/div>/);
    expect(footerMatch).not.toBeNull();
    const footerHtml = footerMatch![1];
    for (const [href, label] of [
      ['/about/', '关于棱镜比价'],
      ['/guide/', '比价使用指南'],
      ['/catalog/brands/', '品牌目录'],
      ['/catalog/integration-codes/', '店铺对接码'],
      ['/catalog/shops/', '店铺目录'],
      ['/catalog/products/', '商品目录'],
    ] as const) {
      expect(footerHtml).toContain(`href="${href}"`);
      expect(footerHtml).toContain(label);
    }

    const jsonBlocks = Array.from(
      html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
      (m) => JSON.parse(m[1]),
    );
    expect(jsonBlocks.length).toBeGreaterThanOrEqual(2);
    expect(jsonBlocks[0]).toMatchObject({
      '@type': 'WebSite',
      url: 'https://parity.sirhao.top/',
      potentialAction: { '@type': 'SearchAction' },
    });
    expect(jsonBlocks[1]).toMatchObject({
      '@type': 'ItemList',
    });
  });

  it('独立百科导航页 /about/ 完整承载品牌目录直达、对接码/开店入口与 FAQPage 结构化数据', async () => {
    const res = await SELF.fetch('http://localhost/about/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<link rel="canonical" href="https://parity.sirhao.top/about/"');
    for (const kw of ['ChatGPT', 'Codex', 'Claude', 'Gemini', '店铺对接码', '联动小铺开店']) {
      expect(html).toContain(kw);
    }
    const jsonBlocks = Array.from(
      html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
      (m) => JSON.parse(m[1]),
    );
    expect(jsonBlocks.some((block) => block['@type'] === 'WebPage')).toBe(true);
    expect(jsonBlocks.some((block) => block['@type'] === 'FAQPage' && Array.isArray(block.mainEntity) && block.mainEntity.length >= 4)).toBe(true);
  });

  it('robots.txt 显式放行 AI 爬虫且声明全部站点地图，动态 sitemap 覆盖 /about/、指南与品牌页', async () => {
    const robots = await (await SELF.fetch('http://localhost/robots.txt')).text();
    for (const bot of ['OAI-SearchBot', 'GPTBot', 'ClaudeBot', 'PerplexityBot', 'Baiduspider', 'Googlebot']) {
      expect(robots).toContain(`User-agent: ${bot}`);
    }
    expect(robots).toContain('Disallow: /admin/');
    expect(robots).toContain('Sitemap: https://parity.sirhao.top/sitemap.xml');
    expect(robots).toContain('Sitemap: https://parity.sirhao.top/sitemap-shops.xml');
    expect(robots).toContain('Sitemap: https://parity.sirhao.top/sitemap-products.xml');

    const sitemap = await (await SELF.fetch('http://localhost/sitemap.xml')).text();
    for (const loc of [
      'https://parity.sirhao.top/about/',
      'https://parity.sirhao.top/guide/ai-pricing/',
      'https://parity.sirhao.top/guide/integration-codes/',
      'https://parity.sirhao.top/guide/open-store/',
      'https://parity.sirhao.top/open-store-guide/',
      'https://parity.sirhao.top/catalog/',
      'https://parity.sirhao.top/catalog/brands/',
      'https://parity.sirhao.top/catalog/brands/ChatGPT/',
      'https://parity.sirhao.top/catalog/brands/Codex/',
      'https://parity.sirhao.top/catalog/integration-codes/',
    ]) {
      expect(sitemap).toContain(`<loc>${loc}</loc>`);
    }
  });

  it('llms.txt 与 llms-full.txt 返回可机读 Markdown 并包含 /about/、开店与核心品牌导航', async () => {
    for (const path of ['/llms.txt', '/llms-full.txt']) {
      const res = await SELF.fetch(`http://localhost${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/markdown');
      const body = await res.text();
      expect(body).toContain('棱镜比价');
      expect(body).toContain('ChatGPT');
      expect(body).toContain('Codex');
      expect(body).toContain('Claude');
      expect(body).toContain('Gemini');
      expect(body).toContain('店铺对接码');
      expect(body).toContain('联动小铺开店');
      expect(body).toContain('https://parity.sirhao.top/about/');
      expect(body).toContain('https://parity.sirhao.top/open-store-guide/');
    }
  });

  it('全部专题指南页与三步开店图解页返回 200 且包含规范链接与结构化数据', async () => {
    for (const [path, expectedHeading] of [
      ['/guide/ai-pricing/', 'ChatGPT、Codex、Claude、Gemini'],
      ['/guide/integration-codes/', '店铺对接码'],
      ['/guide/open-store/', '联动小铺开店'],
      ['/open-store-guide/', '开店与对接货源'],
    ] as const) {
      const res = await SELF.fetch(`http://localhost${path}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<link rel="canonical" href="https://parity.sirhao.top${path}"`);
      expect(html).toContain(expectedHeading);
      expect(html).toContain('<script type="application/ld+json">');
    }
  });
});
