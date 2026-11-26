/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { handleApiRequest } from "../src/routes/api";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
afterEach(() => { vi.useRealTimers(); });

const start = Date.UTC(2026, 10, 27, 10, 14, 35);
const day = 86_400_000;
const headers = { "Content-Type": "application/json", Authorization: "Bearer test-ingest-secret" };
const at = (days: number) => vi.setSystemTime(start + days * day);

function shopFixture(shopId: string, title = "Gemini Pro 独享成品号 季卡") {
  const shopUrl = `https://www.16688.com.cn/shop/${shopId}`;
  const snapshot = {
    shopName: shopId, canonicalUrl: shopUrl,
    items: [{ itemKey: "a", rawName: title, price: 4, stockCount: 3 }],
  };
  const post = (path: string, body: unknown, signed = true) => handleApiRequest(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: signed ? headers : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env);
  return {
    sync: () => post("/api/ingest", { shopId, shopUrl, snapshot }),
    observe: (state: "open" | "closed", allowDelete = true, url = shopUrl, signed = true) =>
      post(`/api/admin/shops/${shopId}/closure`, { state, shopUrl: url, allowDelete }, signed),
    count: (table: "offers" | "shop_daily_snapshots") =>
      env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE shop_id = ?`).bind(shopId).first("count"),
  };
}

it("打烊满 7×24 小时且有新确认后才删除店铺、报价和历史", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  const id = "CLOSE7D";
  const shop = shopFixture(id);
  expect((await shop.sync()).status).toBe(200);
  expect((await shop.observe("closed", true, undefined, false)).status).toBe(401);
  expect((await shop.observe("closed", true, "https://www.16688.com.cn/shop/wrong")).status).toBe(409);

  const first = await shop.observe("closed");
  expect(await first.json()).toEqual({
    shopId: id, state: "closed", deleted: false,
    closedSince: new Date(start).toISOString(), deleteNotBefore: new Date(start + 7 * day).toISOString(),
  });
  vi.setSystemTime(start + 7 * day - 1);
  expect(await (await shop.observe("closed")).json()).toMatchObject({ deleted: false, closedSince: new Date(start).toISOString() });
  expect(await shop.count("offers")).toBe(1);
  expect(await shop.count("shop_daily_snapshots")).toBe(1);

  at(7);
  expect(await (await shop.observe("closed", false)).json()).toMatchObject({ deleted: false });
  expect(await (await shop.observe("closed")).json()).toEqual({ shopId: id, state: "deleted", deleted: true });
  expect(await shop.count("offers")).toBe(0);
  expect(await shop.count("shop_daily_snapshots")).toBe(0);
  expect(await env.DB.prepare("SELECT id FROM shops WHERE id = ?").bind(id).first()).toBeNull();
});

it("恢复营业或成功同步清除打烊时间，下一次打烊重新计时", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  const id = "REOPEN7D";
  const shop = shopFixture(id);
  expect((await shop.sync()).status).toBe(200);
  expect((await shop.observe("closed")).status).toBe(200);
  at(3);
  expect(await (await shop.observe("open")).json()).toMatchObject({ state: "open", deleted: false });

  at(8);
  expect(await (await shop.observe("closed")).json()).toMatchObject({
    deleted: false, closedSince: new Date(start + 8 * day).toISOString(),
  });
  const syncCatalog = () => handleApiRequest(new Request("http://localhost/api/shops?fields=sync"), env);
  const catalog = await (await syncCatalog()).json<{ shopClosureGraceSupport: boolean; shops: Array<{ id: string; closedSince?: string }> }>();
  expect(catalog.shopClosureGraceSupport).toBe(true);
  expect(catalog.shops.find(shop => shop.id === id)?.closedSince).toBe(new Date(start + 8 * day).toISOString());
  at(9);
  expect((await shop.sync()).status).toBe(200);
  expect(await env.DB.prepare("SELECT closed_since_at FROM shops WHERE id = ?").bind(id).first()).toEqual({ closed_since_at: null });
  at(16);
  expect(await (await shop.observe("closed")).json()).toMatchObject({
    deleted: false, closedSince: new Date(start + 16 * day).toISOString(),
  });
});

it("打烊报价按缺货筛选的时间范围过滤，保留其他报价并重算最低价", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(1);
  const title = "Gemini Pro 自营成品号 三个月";
  const shop = shopFixture("CLOSEFILTER7D", title);
  expect((await shop.sync()).status).toBe(200);
  const alternativeId = "OPENFILTER7D";
  const alternativeUrl = `https://www.16688.com.cn/shop/${alternativeId}`;
  const alternative = await handleApiRequest(new Request("http://localhost/api/ingest", {
    method: "POST", headers,
    body: JSON.stringify({
      shopId: alternativeId, shopUrl: alternativeUrl,
      snapshot: { shopName: alternativeId, canonicalUrl: alternativeUrl, items: [
        { itemKey: "b", rawName: title, price: 9, stockCount: null },
      ] },
    }),
  }), env);
  expect(alternative.status).toBe(200);
  const { group_key } = (await env.DB.prepare("SELECT group_key FROM offers WHERE id = ?")
    .bind(`${alternativeId}:b`).first<{ group_key: string }>())!;
  const query = async (params: Record<string, string>) => (await handleApiRequest(new Request(
    `http://localhost/api/products?${new URLSearchParams(params)}`,
  ), env)).json<{ items: Array<{ id: string; minPrice: number; offerCount: number; offers: Array<{ id: string }> }> }>();

  expect(await (await shop.observe("closed")).json()).toMatchObject({ state: "closed", deleted: false });
  expect((await query({ offerKey: group_key })).items[0].offers).toHaveLength(2);
  for (const filter of ["hideRecentOutOfStock", "hideLastSyncOutOfStock"]) {
    const filtered = await query({ q: alternativeId, [filter]: "1" });
    expect(filtered.items.find(item => item.id === group_key)).toMatchObject({ minPrice: 9, offerCount: 1 });
    const expanded = await query({ offerKey: group_key, [filter]: "1" });
    expect(expanded.items[0].offers.map(offer => offer.id)).toEqual([`${alternativeId}:b`]);
  }
  expect(await shop.count("offers")).toBe(1);
  at(2);
  expect((await query({ offerKey: group_key, hideRecentOutOfStock: "1" })).items[0].offers).toHaveLength(1);
  vi.setSystemTime(start + 2 * day + 1);
  expect((await query({ offerKey: group_key, hideRecentOutOfStock: "1" })).items[0].offers).toHaveLength(2);
  expect((await query({ offerKey: group_key, hideLastSyncOutOfStock: "1" })).items[0].offers).toHaveLength(1);
  expect(await (await shop.observe("closed")).json()).toMatchObject({
    deleted: false, closedSince: new Date(start + day).toISOString(),
  });
  expect((await query({ offerKey: group_key, hideRecentOutOfStock: "1" })).items[0].offers).toHaveLength(1);
  expect(await (await shop.observe("open")).json()).toMatchObject({ state: "open" });
  const restored = await query({ offerKey: group_key, hideRecentOutOfStock: "1" });
  expect(restored.items[0].offers).toHaveLength(2);
});
