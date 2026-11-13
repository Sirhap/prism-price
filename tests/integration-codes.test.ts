/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import config from "../src/config/shop-integration-codes.json";
import { extractIntegrationCodes, normalizeIntegrationShopUrl, resolveIntegrationCodes } from "../src/collector/integrationCodes.mjs";
import { upsertAdminShops } from "../src/collector/scheduler";
import { persistShopSnapshot } from "../src/collector/etl/hashAndDiff";
import type { RawShopSnapshot, ShopRecord } from "../src/types";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

describe("共用标签和地址规范化", () => {
  for (const label of [...config.labels, ...config.colonLabels]) {
    it(`${label} 同时适用于店名内联与简介独立行`, () => {
      expect(extractIntegrationCodes(`店铺【${label}：Mix_007】的小店`, `公告\n${label}∶"Lucky plus"\n联系客服`))
        .toEqual(["Mix_007", "Lucky plus"]);
    });
  }
  it("保留前导零、大小写、引号内及独立行的内部空格，按原文去重", () => {
    expect(extractIntegrationCodes('分销码：000001', '對接碼：「Lucky plus」', '分銷碼： Lucky plus\n另有公告', '对接码：AKM', '对接码：akm', '分销码：AKM'))
      .toEqual(["000001", "Lucky plus", "AKM", "akm"]);
  });
  it("内联说明不作为多词码，不猜邀请码、URL 或密钥，不跨字段拼接", () => {
    expect(extractIntegrationCodes('商店 对接码：AbC 支持自动发货')).toEqual(["AbC"]);
    expect(extractIntegrationCodes('邀请码：fake API密钥：sk-secret 分销码：https://x.example/ 对接码：sk-secret')).toEqual([]);
    expect(extractIntegrationCodes('对接码：', 'barecode')).toEqual([]);
    expect(extractIntegrationCodes('分销码：[https://x.example/]')).toEqual([]);
    expect(extractIntegrationCodes(`分销码：${"a".repeat(129)}`)).toEqual([]);
  });
  it("按已知平台域名、路径匹配，不误用近似域名或未知地址", () => {
    expect(normalizeIntegrationShopUrl(' http://pay.ldxp.cn/SHOP/PIXELSHOP/?from=nav#info ')).toBe('https://wzyp.cn/shop/pixelshop');
    for (const url of ['https://evilwzyp.cn/shop/pixelshop', 'https://wzyp.cn.evil.test/shop/pixelshop', 'https://wzyp.cn/item/pixelshop', 'https://wzyp.cn:999/shop/pixelshop', 'https://user:pass@wzyp.cn/shop/pixelshop']) {
      expect(resolveIntegrationCodes({ shop_url: url })).toEqual({ codes: [], source: "none" });
    }
  });
  it("36 组人工关系完整且地址无重复，公开标注始终优先", () => {
    expect(config.fallbacks).toHaveLength(36);
    expect(new Set(config.fallbacks.map((entry) => normalizeIntegrationShopUrl(entry.shopUrl))).size).toBe(36);
    for (const entry of config.fallbacks) {
      expect(resolveIntegrationCodes({ shop_url: entry.shopUrl })).toEqual({ codes: [entry.code], source: "manual" });
      expect(resolveIntegrationCodes({ canonical_url: entry.shopUrl, shop_name: '店名 分销码：PublicA', description: '对接码：PublicB\n分销码：PublicA' }))
        .toEqual({ codes: ["PublicA", "PublicB"], source: "public" });
    }
    expect(resolveIntegrationCodes({ shop_url: 'https://wzyp.cn/shop/GV0HQ2C0', shop_name: 'Super AI 对接码：yahello的小店' }).codes).toEqual(["yahello"]);
  });
});

it("公开标签及人工兜底同时参与分页、系统联动，详情与列表输出一致", async () => {
  const entries = [
    { id: 'codes-fallback', shopName: '联动样本空白店', shopUrl: 'http://pay.ldxp.cn/SHOP/PIXELSHOP/?x=1', systemType: 'ldxp' as const },
    { id: 'codes-distribution', shopName: '联动样本【分销码：aibeibei】', shopUrl: 'https://distribution.example/', systemType: 'dujiaoka' as const },
    { id: 'codes-intro', shopName: '联动样本简介店', shopUrl: 'https://intro.example/', description: '分銷碼：「Lucky plus」\nTG: @hide_me', systemType: 'ldxp' as const },
    { id: 'codes-none', shopName: '联动样本没有码', shopUrl: 'https://none.example/', description: '可分销，请联系客服', systemType: 'unknown' as const },
  ];
  await upsertAdminShops(env.DB, entries);
  const load = async (params: string) => (await SELF.fetch(`http://localhost/api/shops?q=联动样本&hasIntegrationCode=1&${params}`)).json() as Promise<{
    shops: Array<{id:string; integrationCodes:string[]}>; total:number; totalPages:number; facets:{systemTypes:Record<string,number>};
  }>;
  const first = await load('page=1&pageSize=2');
  const second = await load('page=2&pageSize=2');
  expect(first.total).toBe(3);
  expect(first.totalPages).toBe(2);
  expect(second.shops).toHaveLength(1);
  const shops = [...first.shops, ...second.shops];
  expect(new Set(shops.map((shop) => shop.id)).size).toBe(3);
  expect(shops.find((shop) => shop.id === 'codes-fallback')?.integrationCodes).toEqual(['000001']);
  expect(shops.find((shop) => shop.id === 'codes-intro')?.integrationCodes).toEqual(['Lucky plus']);
  expect(JSON.stringify(first) + JSON.stringify(second)).not.toContain('@hide_me');
  const system = await load('page=1&systemType=dujiaoka');
  expect(system.total).toBe(1);
  expect(system.facets.systemTypes.ldxp).toBe(2);
  for (const shop of shops) {
    const intro = await (await SELF.fetch(`http://localhost/api/shops/${shop.id}`)).json() as { shop: {integrationCodes: string[]} };
    expect(intro.shop.integrationCodes).toEqual(shop.integrationCodes);
  }
  const empty = await load('page=1&hasDescription=1&systemType=dujiaoka');
  expect(empty.total).toBe(0);
  expect(empty.shops).toEqual([]);
});

it("同步简介后公开分销码自动替代人工兜底，重复简介无需写入", async () => {
  const id = 'codes-auto-description';
  const url = 'https://wzyp.cn/shop/X23TO6QE';
  await upsertAdminShops(env.DB, [{ id, shopName: '简介自动维护', shopUrl: url }]);
  const current = async () => (await env.DB.prepare('SELECT * FROM shops WHERE id=?').bind(id).first<ShopRecord>())!;
  const snapshot: RawShopSnapshot = { shopName: '简介自动维护', canonicalUrl: url, telegram: '', description: '', items: [],
    shopSellCount: null, salesVisible: false, depositVisible: false, depositMoney: null };
  await persistShopSnapshot(env.DB, await current(), snapshot, '2026-11-12T00:00:00Z');
  expect(resolveIntegrationCodes(await current()).codes).toEqual(['Lucky plus']);
  snapshot.description = '分销码：NewCode007';
  const updated = await persistShopSnapshot(env.DB, await current(), snapshot, '2026-11-12T01:00:00Z', { minUnchangedIntervalMs: 12 * 3600000 });
  expect(updated.descriptionUpdated).toBe(true);
  expect(updated.status).toBe('unchanged');
  expect(resolveIntegrationCodes(await current())).toEqual({ codes: ['NewCode007'], source: 'public' });
  const repeated = await persistShopSnapshot(env.DB, await current(), snapshot, '2026-11-12T02:00:00Z', { minUnchangedIntervalMs: 12 * 3600000 });
  expect(repeated.estimatedWrites).toBe(0);
});

it("三家补录保留真实公开信息、等待商品同步，重复导入不重复收录", async () => {
  const { default: additions } = await import('../data/shops.integration-additions.json');
  await upsertAdminShops(env.DB, additions.shops as import('../src/collector/scheduler').AdminShopInput[]);
  await upsertAdminShops(env.DB, additions.shops as import('../src/collector/scheduler').AdminShopInput[]);
  for (const item of additions.shops) {
    const row = await env.DB.prepare('SELECT * FROM shops WHERE id=?').bind(item.id).first<ShopRecord>();
    expect(row).not.toBeNull();
    expect(row!.shop_name).toBe(item.shopName);
    expect(row!.sync_state).toBe('pending');
    expect(row!.last_synced_at).toBeNull();
    expect(row!.product_count).toBe(0);
    expect(resolveIntegrationCodes(row!).codes).toHaveLength(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM shops WHERE canonical_url=?').bind(item.canonicalUrl).first('count')).toBe(1);
  }
});
