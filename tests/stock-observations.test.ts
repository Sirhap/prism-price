/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { handleApiRequest } from "../src/routes/api";
import { handleCatalogSeo } from "../src/routes/catalogSeo";

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

it("连续七个北京时间日期才标记，未变快照也计数，标签只作用于缺货报价且补货即移除", async () => {
  const shop = "steady-stock";
  const zero = item("same", 0);
  await send(shop, [zero], date(1));
  const initial = await stockRow(`${shop}:same`);
  await send("other-stock", [item("same", 8, 30)], date(1));
  await send(shop, [zero], date(1, 20));
  expect(await stockRow(`${shop}:same`)).toMatchObject({ stock_zero_days: 1, stock_zero_day: "2026-11-02" });
  for (let day = 2; day <= 6; day++) await send(shop, [zero], date(day));
  const key = initial!.group_key;
  expect(await warnings(`offerKey=${encodeURIComponent(key)}`)).toEqual([]);
  const seventh = await send(shop, [zero], date(7));
  expect(seventh.skippedUnchanged).toBe(1);
  expect(await stockRow(`${shop}:same`)).toMatchObject({ stock_zero_days: 7, updated_at: initial!.updated_at });
  expect(await warnings(`offerKey=${encodeURIComponent(key)}`)).toEqual([`${shop}:same`]);
  expect(await warnings("q=Codex&pageSize=50")).toContain(`${shop}:same`);
  const seo = await handleCatalogSeo(new URL(`http://localhost/catalog/products/${encodeURIComponent(key)}/`), env);
  expect(await seo.text()).toContain("连续 7 天缺货，购买前请核实");
  await send(shop, [item("same", 1)], date(7, 20));
  expect(await stockRow(`${shop}:same`)).toMatchObject({ stock_zero_days: 0, stock_zero_day: null });
  expect(await warnings(`offerKey=${encodeURIComponent(key)}`)).toEqual([]);
  await send(shop, [zero], date(7, 21));
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
  for (let day = 6; day <= 12; day++) await send(shop, [zero], date(day), true);
  const observed = await stockRow(`${shop}:first`);
  expect(observed).toMatchObject({ stock_zero_days: 7 });
  const query = `offerKey=${encodeURIComponent(observed!.group_key)}`;
  await send(shop, [other], date(13), true);
  expect(await warnings(query)).toContain(`${shop}:first`);
  await send(shop, [other], date(14), true);
  expect(await warnings(query)).not.toContain(`${shop}:first`);
});
