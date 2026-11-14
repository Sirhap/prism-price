/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { isPublicCacheRequest, publicCacheKey } from '../src/cache/publicResponseCache';

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

it('支持目录总览、品牌专题、对接码专题、结构化商品/店铺详情并严格脱敏 TG', async () => {
  const now = '2026-01-02T00:00:00Z';
  await env.DB.prepare(
    `INSERT INTO shops (
      id, shop_name, shop_url, canonical_url, adapter_type, telegram, system_type,
      description, submitted_integration_code, product_count, product_summary_json,
      next_sync_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      'aa-ldxp-shop',
      '联动AI源头店',
      'https://pay.ldxp.cn/shop/123',
      'https://pay.ldxp.cn/shop/123',
      'json_api',
      '@secret_shop_tg',
      'ldxp',
      '专注 Codex 与 ChatGPT 货源，对接码：LDXP9988，售后 TG @secret_desc_tg',
      '',
      5,
      JSON.stringify([{ name: 'Codex Pro 月卡', category: 'AI编程', price: 39 }]),
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO shops (
      id, shop_name, shop_url, canonical_url, adapter_type, telegram, system_type,
      description, submitted_integration_code, product_count, product_summary_json,
      next_sync_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      'ab-submitted-shop',
      '登记对接码示例店',
      'https://dujiao.example.test/',
      'https://dujiao.example.test/',
      'ssr_html',
      '',
      'dujiaoka',
      '专注 Claude 与 Gemini 代充',
      'SUBCODE777',
      3,
      '[]',
      now,
      now,
    )
    .run();

  const offersPreview = [
    {
      shopId: 'aa-ldxp-shop',
      shopName: '联动AI源头店 @offer_tg_hidden',
      price: 39,
      stockStatus: 'sufficient',
      itemUrl: 'https://pay.ldxp.cn/item/1',
      telegram: '@secret_offer_tg',
    },
    {
      shopId: 'seo-shop',
      shopName: '比价对照店',
      price: 58,
      stockStatus: 'normal',
      itemUrl: 'https://example.test/item/2',
    },
  ];

  await env.DB.prepare(
    `INSERT INTO product_groups (
      group_key, display_name, brand_group, shop_category, attr_type, attr_plan, attr_duration,
      min_price, median_price, max_price, shop_count, offer_count,
      lead_shop_id, lead_shop_name, lead_shop_url, lead_item_url,
      stock_status, offers_preview_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      'codex-pro-month',
      'Codex Pro 月卡 独立成品号',
      'Codex',
      'AI编程',
      'ready',
      'pro',
      'month',
      39,
      48.5,
      58,
      2,
      2,
      'aa-ldxp-shop',
      '联动AI源头店',
      'https://pay.ldxp.cn/shop/123',
      'https://pay.ldxp.cn/item/1',
      'sufficient',
      JSON.stringify(offersPreview),
      now,
    )
    .run();

  // 目录总览与品牌导航
  const catalogHome = await SELF.fetch('http://localhost/catalog/');
  expect(catalogHome.status).toBe(200);
  const catalogHtml = await catalogHome.text();
  expect(catalogHtml).toContain('href="/catalog/brands/Codex/"');
  expect(catalogHtml).toContain('href="/catalog/integration-codes/"');
  expect(catalogHtml).toContain('"@type":"CollectionPage"');

  const brandsIndex = await SELF.fetch('http://localhost/catalog/brands/');
  expect(brandsIndex.status).toBe(200);
  const brandsHtml = await brandsIndex.text();
  expect(brandsHtml).toContain('ChatGPT');
  expect(brandsHtml).toContain('Codex');
  expect(brandsHtml).toContain('Claude');
  expect(brandsHtml).toContain('Gemini');

  // Codex 品牌专题与不存在品牌 404
  const codexBrand = await SELF.fetch('http://localhost/catalog/brands/Codex/');
  expect(codexBrand.status).toBe(200);
  const codexHtml = await codexBrand.text();
  expect(codexHtml).toContain('Codex Pro 月卡 独立成品号');
  expect(codexHtml).toContain('href="/catalog/products/codex-pro-month/"');

  const invalidBrand = await SELF.fetch('http://localhost/catalog/brands/NonExistentBrand999/');
  expect(invalidBrand.status).toBe(404);
  expect(invalidBrand.headers.get('x-robots-tag')).toBe('noindex');

  // 店铺详情与脱敏验证（公开标注 + 店主登记两种来源）
  const shopDetail = await SELF.fetch('http://localhost/catalog/shops/aa-ldxp-shop/');
  expect(shopDetail.status).toBe(200);
  const shopHtml = await shopDetail.text();
  expect(shopHtml).toContain('联动小铺');
  expect(shopHtml).toContain('LDXP9988');
  expect(shopHtml).toContain('"@type":"Store"');
  expect(shopHtml).not.toContain('@secret_shop_tg');
  expect(shopHtml).not.toContain('@secret_desc_tg');

  const submittedShopDetail = await SELF.fetch('http://localhost/catalog/shops/ab-submitted-shop/');
  expect(submittedShopDetail.status).toBe(200);
  const submittedShopHtml = await submittedShopDetail.text();
  expect(submittedShopHtml).toContain('SUBCODE777');
  expect(submittedShopHtml).toContain('店主提交登记');

  // 商品详情多店比价表、JSON-LD 与脱敏验证
  const productDetail = await SELF.fetch('http://localhost/catalog/products/codex-pro-month/');
  expect(productDetail.status).toBe(200);
  const productHtml = await productDetail.text();
  expect(productHtml).toContain('¥39.00');
  expect(productHtml).toContain('¥58.00');
  expect(productHtml).toContain('"@type":"Product"');
  expect(productHtml).toContain('"@type":"AggregateOffer"');
  expect(productHtml).not.toContain('@secret_offer_tg');
  expect(productHtml).not.toContain('@offer_tg_hidden');

  // 对接码专题目录
  const codeDir = await SELF.fetch('http://localhost/catalog/integration-codes/');
  expect(codeDir.status).toBe(200);
  const codeHtml = await codeDir.text();
  expect(codeHtml).toContain('aa-ldxp-shop');
  expect(codeHtml).toContain('ab-submitted-shop');
  expect(codeHtml).toContain('SUBCODE777');
  expect(codeHtml).toContain('LDXP9988');

  // 分片 Sitemap 与动态 llms-full.txt
  const shopSitemap = await SELF.fetch('http://localhost/sitemap-shops.xml');
  expect(shopSitemap.status).toBe(200);
  expect(await shopSitemap.text()).toContain('https://parity.sirhao.top/catalog/shops/aa-ldxp-shop/');

  const productSitemap = await SELF.fetch('http://localhost/sitemap-products.xml');
  expect(productSitemap.status).toBe(200);
  expect(await productSitemap.text()).toContain('https://parity.sirhao.top/catalog/products/codex-pro-month/');

  const llmsFull = await SELF.fetch('http://localhost/llms-full.txt');
  expect(llmsFull.status).toBe(200);
  const llmsText = await llmsFull.text();
  expect(llmsText).toContain('Codex Pro 月卡 独立成品号');
  expect(llmsText).toContain('SUBCODE777');
  expect(llmsText).toContain('LDXP9988');
  expect(llmsText).not.toContain('@secret_desc_tg');
});

it('公共缓存键正确覆盖目录、sitemap 与 llms 路由并剥离无关参数', () => {
  for (const url of [
    'https://parity.sirhao.top/catalog/',
    'https://parity.sirhao.top/catalog/brands/Codex/',
    'https://parity.sirhao.top/catalog/integration-codes/',
    'https://parity.sirhao.top/sitemap.xml',
    'https://parity.sirhao.top/sitemap-shops.xml',
    'https://parity.sirhao.top/llms.txt',
    'https://parity.sirhao.top/llms-full.txt',
  ]) {
    expect(isPublicCacheRequest(new Request(url))).toBe(true);
  }
  expect(isPublicCacheRequest(new Request('https://parity.sirhao.top/admin/'))).toBe(false);

  const tracked = publicCacheKey(new Request('https://parity.sirhao.top/catalog/brands/Codex/?utm_source=bing&after=codex-1'));
  const clean = publicCacheKey(new Request('https://parity.sirhao.top/catalog/brands/Codex/?after=codex-1'));
  expect(tracked.url).toBe(clean.url);

  const llmsTracked = publicCacheKey(new Request('https://parity.sirhao.top/llms.txt?ref=ai'));
  const llmsClean = publicCacheKey(new Request('https://parity.sirhao.top/llms.txt'));
  expect(llmsTracked.url).toBe(llmsClean.url);
});
