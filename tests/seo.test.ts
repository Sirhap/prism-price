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
});
