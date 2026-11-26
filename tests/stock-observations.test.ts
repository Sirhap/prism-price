/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { handleApiRequest } from "../src/routes/api";
import { handleCatalogSeo } from "../src/routes/catalogSeo";
import { publicCacheKey } from "../src/cache/publicResponseCache";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
afterEach(() => { vi.useRealTimers(); });

function date(day: number, hour = 16) {
  return Date.UTC(2026, 10, day, hour);
}

function item(key: string, stockCount: number | null, price = 20) {
  return { itemKey: key, rawName: "Codex Plus 成品号 月卡", shopCategory: "Codex", price, stockCount,
    stockStatus: stockCount === 0 ? "low" : "normal", itemUrl: `https://example.test/item/${key}` };
}

async function send(shopId: string, items: ReturnType<typeof item>[], time: number, partial = false) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(time);
  const shopUrl = `https://${shopId}.example.test/`;
  const response = await handleApiRequest(new Request("http://localhost/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-ingest-secret" },
    body: JSON.stringify({ shops: [{ shopId, shopUrl, partial, snapshot: { shopName: shopId, canonicalUrl: shopUrl, items } }] }),
  }), env);
  expect(response.status).toBe(200);
  const result = await response.json<{ failedCount: number; skippedUnchanged: number }>();
  expect(result.failedCount).toBe(0);
  return result;
}

async function stockRow(id: string) {
  return env.DB.prepare("SELECT group_key, updated_at, stock_zero_day, stock_zero_days FROM offers WHERE id = ?")
    .bind(id).first<{ group_key: string; updated_at: string; stock_zero_day: string; stock_zero_days: number }>();
}

async function warnings(query: string) {
  const response = await handleApiRequest(new Request(`http://localhost/api/products?${query}`), env);
  expect(response.status).toBe(200);
  const body = await response.json<{ items: Array<{ offers: Array<{ id: string; longTermOutOfStock?: true; stockWarningDay?: string }> }> }>();
  const offers = body.items.flatMap((group) => group.offers);
  expect(offers.every((offer) => offer.stockWarningDay === undefined)).toBe(true);
  return offers.filter((offer) => offer.longTermOutOfStock).map((offer) => offer.id);
}

it("连续三个北京时间日期才标记，未变快照也计数，标签只作用于缺货报价且补货即移除", async () => {
  const shop = "steady-stock";
  const zero = item("same", 0);
  await send(shop, [zero], date(1));
  const initial = await stockRow(`${shop}:same`);
  await send("other-stock", [item("same", 8, 30)], date(1));
  await send(shop, [zero], date(1, 20));
  expect(await stockRow(`${shop}:same`)).toMatchObject({ stock_zero_days: 1, stock_zero_day: "2026-11-02" });
  await send(shop, [zero], date(2));
  const key = initial!.group_key;
  expect(await warnings(`offerKey=${encodeURIComponent(key)}`)).toEqual([]);
  const third = await send(shop, [zero], date(3));
  expect(third.skippedUnchanged).toBe(1);
  expect(await stockRow(`${shop}:same`)).toMatchObject({ stock_zero_days: 3, updated_at: initial!.updated_at });
  // A preview built while the threshold was seven days carried no warning field.
  await env.DB.prepare(`UPDATE product_groups SET offers_preview_json = json_remove(offers_preview_json, '$[0].stockWarningDay')
    WHERE group_key = ?`).bind(key).run();
  expect(await warnings(`offerKey=${encodeURIComponent(key)}`)).toEqual([`${shop}:same`]);
  expect(await warnings("q=Codex&pageSize=50")).toContain(`${shop}:same`);
  const seo = await handleCatalogSeo(new URL(`http://localhost/catalog/products/${encodeURIComponent(key)}/`), env);
  expect(await seo.text()).toContain("连续 3 天缺货，购买前请核实");
  await send(shop, [item("same", 1)], date(3, 20));
  expect(await stockRow(`${shop}:same`)).toMatchObject({ stock_zero_days: 0, stock_zero_day: null });
  expect(await warnings(`offerKey=${encodeURIComponent(key)}`)).toEqual([]);
  await send(shop, [zero], date(3, 21));
  expect(await stockRow(`${shop}:same`)).toMatchObject({ stock_zero_days: 1 });
});

it("缺采和未知库存不计入；部分同步不把保留的旧商品算作新观察", async () => {
  const shop = "partial-stock";
  const zero = item("first", 0);
  const other = item("second", 2);
  await send(shop, [zero, other], date(1));
  await send(shop, [other], date(2), true);
  expect(await stockRow(`${shop}:first`)).toMatchObject({ stock_zero_day: "2026-11-02", stock_zero_days: 1 });
  await send(shop, [zero], date(3), true);
  expect(await stockRow(`${shop}:first`)).toMatchObject({ stock_zero_days: 1 });
  await send(shop, [zero], date(4), true);
  expect(await stockRow(`${shop}:first`)).toMatchObject({ stock_zero_days: 2 });
  await send(shop, [item("first", null)], date(5), true);
  expect(await stockRow(`${shop}:first`)).toMatchObject({ stock_zero_day: null, stock_zero_days: 0 });
  for (let day = 6; day <= 8; day++) await send(shop, [zero], date(day), true);
  const observed = await stockRow(`${shop}:first`);
  expect(observed).toMatchObject({ stock_zero_days: 3 });
  const query = `offerKey=${encodeURIComponent(observed!.group_key)}`;
  await send(shop, [other], date(9), true);
  expect(await warnings(query)).toContain(`${shop}:first`);
  await send(shop, [other], date(10), true);
  expect(await warnings(query)).not.toContain(`${shop}:first`);
});

it("按报价最近一次实际同步筛选，重算商品组、价格、分面和分页，并与展开结果一致", async () => {
  const now = date(20, 12);
  const oneDay = 24 * 60 * 60 * 1000;
  const quote = (key: string, stock: number | null, price: number) => ({
    ...item(key, stock, price), rawName: "Gemini Ultra 独享成品号 季卡", shopCategory: "Gemini",
  });
  const oldZero = quote("old", 0, 18);
  const unknown = quote("unknown", null, 28);
  const atCutoff = quote("boundary", 0, 2);
  const recentZeros = Array.from({ length: 13 }, (_, index) => quote(`zero-${index}`, 0, 3 + index));
  const alternative = { ...quote("alternative", 4, 10), rawName: "Gemini Pro 成品号 季卡" };
  const onlyZero = { ...quote("empty", 0, 5), rawName: "Gemini Ultra 成品号 年卡" };
  await send("stockfilter-partial", [oldZero, unknown], now - oneDay - 1, true);
  await send("stockfilter-boundary", [atCutoff], now - oneDay);
  await send("stockfilter-partial", [...recentZeros, alternative, onlyZero], now, true);
  await send("stockfilter-available", [quote("in-stock", 5, 35)], now);
  const key = (await stockRow("stockfilter-partial:old"))!.group_key;
  const alternativeKey = (await stockRow("stockfilter-partial:alternative"))!.group_key;

  const root = "http://localhost/api/products";
  const filter = "hideRecentOutOfStock=1";
  async function products(query: string) {
    const response = await handleApiRequest(new Request(`${root}?${query}`), env);
    expect(response.status).toBe(200);
    return response.json<{
      items: Array<{ id: string; minPrice: number; medianPrice: number; maxPrice: number; offerCount: number;
        shopCount: number; shopId: string; offersTruncated: boolean; offers: Array<{ id: string }> }>;
      total: number; offerTotal: number; totalPages: number;
      appliedFilters: { hideRecentOutOfStock: boolean };
      facets: { prices: Record<string, number> };
    }>();
  }

  const query = "q=stockfilter&sort=price-asc&pageSize=1";
  const unfiltered = await products(query);
  expect(unfiltered.total).toBe(3);
  expect(unfiltered.items[0]).toMatchObject({ id: key, minPrice: 2, offersTruncated: true });
  const first = await products(`${query}&${filter}`);
  expect(first).toMatchObject({
    total: 2, totalPages: 2, offerTotal: 4, appliedFilters: { hideRecentOutOfStock: true },
    facets: { prices: { "under-10": 0, "10-50": 2 } },
    items: [{ id: alternativeKey, minPrice: 10 }],
  });
  const second = await products(`${query}&${filter}&page=2`);
  const retained = ["stockfilter-partial:old", "stockfilter-partial:unknown", "stockfilter-available:in-stock"];
  expect(second.items[0]).toMatchObject({
    id: key, minPrice: 18, medianPrice: 28, maxPrice: 35, offerCount: 3, shopCount: 2,
    shopId: "stockfilter-partial", offersTruncated: false,
  });
  expect(second.items[0].offers.map(offer => offer.id)).toEqual(retained);
  expect((await products(`q=stockfilter&maxPrice=17&${filter}`)).items.map(group => group.id)).toEqual([alternativeKey]);
  expect((await products(`q=stockfilter-boundary&${filter}`)).total).toBe(0);

  const expanded = `offerKey=${encodeURIComponent(key)}`;
  expect((await products(`${expanded}&${filter}`)).items[0].offers.map(offer => offer.id)).toEqual(retained);
  expect((await products(expanded)).items[0].offers).toHaveLength(17);

  // A carried-forward zero-stock quote may predate per-offer timestamps entirely.
  await env.DB.prepare("UPDATE offers SET last_observed_at = NULL WHERE id = ?").bind("stockfilter-partial:old").run();
  expect((await products(`${expanded}&${filter}`)).items[0].offers.map(offer => offer.id)).toEqual(retained);
  const lastSyncFilter = "hideLastSyncOutOfStock=1";
  const filteredLastSync = await products(`${query}&${lastSyncFilter}&page=2`);
  expect(filteredLastSync).toMatchObject({
    total: 2, offerTotal: 3, appliedFilters: { hideLastSyncOutOfStock: true },
    items: [{ id: key, minPrice: 28, medianPrice: 31.5, offerCount: 2 }],
  });
  const onlyNotZero = ["stockfilter-partial:unknown", "stockfilter-available:in-stock"];
  expect(filteredLastSync.items[0].offers.map(offer => offer.id)).toEqual(onlyNotZero);
  for (const flags of [lastSyncFilter, `${filter}&${lastSyncFilter}`]) {
    expect((await products(`${expanded}&${flags}`)).items[0].offers.map(offer => offer.id)).toEqual(onlyNotZero);
  }

  for (const scope of [query, expanded]) {
    const cacheUrl = (params: string) => publicCacheKey(new Request(`${root}?${params}`)).url;
    expect(cacheUrl(`${scope}&${filter}`)).not.toBe(cacheUrl(scope));
    expect(cacheUrl(`${scope}&${lastSyncFilter}`)).not.toBe(cacheUrl(`${scope}&${filter}`));
  }
});

it("同步展示保留隐藏数量的明确库存档位，未知库存不再被误认为充足", async () => {
  const { readShopApiStock } = await import("../public/stock-observation.mjs");
  const shopId = "stock-bands";
  const counts = [0, 3, 12, 40, null] as const;
  const items = counts.map((stock_count, index) => ({
    ...item(`band-${index}`, stock_count, index + 1),
    rawName: "Codex Plus 成品号 库存档位测试 月卡",
    ...readShopApiStock({ stock_count, show_stock_type: 0 }),
  }));
  await send(shopId, items, date(24), true);
  await send(shopId, [items[0]], date(25), true);
  const group = (await stockRow(`${shopId}:band-0`))!.group_key;
  const expected = ["out", "low", "normal", "sufficient", "unknown"].map((stockBand, index) => ({
    id: `${shopId}:band-${index}`, stockBand, stockCount: index === 0 ? 0 : null,
    stockStatus: ["low", "low", "normal", "sufficient", "sufficient"][index],
  }));

  for (const query of [`offerKey=${encodeURIComponent(group)}`, "q=库存档位测试"]) {
    const response = await handleApiRequest(new Request(`http://localhost/api/products?${query}`), env);
    const data = await response.json<{ items: Array<{ id: string; offers: unknown[] }> }>();
    expect(data.items.find(entry => entry.id === group)?.offers).toMatchObject(expected);
  }
  const seo = await handleCatalogSeo(new URL(`http://localhost/catalog/products/${encodeURIComponent(group)}/`), env);
  const html = await seo.text();
  for (const text of ["0 件（缺货）", "库存少量", "库存一般", "库存充足", "未记录"]) {
    expect(html).toContain(`<td>${text}</td>`);
  }
});
