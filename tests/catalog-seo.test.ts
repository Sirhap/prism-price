/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.prepare('INSERT INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,next_sync_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .bind('seo-shop', '<测试店> @hidden_tg', 'https://example.test/', 'https://example.test/', 'manual', '2026-01-01', '2026-01-01').run();
});

it('店铺目录有可抓取链接和安全渲染的详情，不暴露 TG', async () => {
  const list = await SELF.fetch('http://localhost/catalog/shops/');
  expect(list.status).toBe(200);
  const html = await list.text();
  expect(html).toContain('href="/catalog/shops/seo-shop/"');
  expect(html).toContain('&lt;测试店&gt;');
  expect(html).not.toContain('@hidden_tg');
  const detail = await SELF.fetch('http://localhost/catalog/shops/seo-shop/');
  expect(detail.status).toBe(200);
  expect(await detail.text()).toContain('https://parity.sirhao.top/catalog/shops/seo-shop/');
  const missing = await SELF.fetch('http://localhost/catalog/shops/not-found/');
  expect(missing.status).toBe(404);
  expect(missing.headers.get('x-robots-tag')).toBe('noindex');
});

it('商品目录和无效页码按真实状态返回', async () => {
  expect((await SELF.fetch('http://localhost/catalog/products/')).status).toBe(200);
  expect((await SELF.fetch('http://localhost/catalog/products/?page=-1')).status).toBe(404);
  expect((await SELF.fetch('http://localhost/catalog/products/not-found/')).status).toBe(404);
});

it('目录使用主键游标翻页，后页不重复且可索引', async () => {
  const now = '2026-01-01';
  await env.DB.batch(Array.from({length: 31}, (_, i) => {
    const id = `zz-seo-${String(i).padStart(2, '0')}`;
    return env.DB.prepare('INSERT INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,next_sync_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, id, `https://${id}.example/`, `https://${id}.example/`, 'manual', now, now);
  }));
  const first = await (await SELF.fetch('http://localhost/catalog/shops/?after=seo-shop')).text();
  expect(first).toContain('zz-seo-00');
  expect(first).not.toContain('zz-seo-30');
  expect(first).toContain('href="/catalog/shops/?after=zz-seo-29"');
  const second = await SELF.fetch('http://localhost/catalog/shops/?after=zz-seo-29');
  expect(second.status).toBe(200);
  expect(await second.text()).toContain('zz-seo-30');
});
