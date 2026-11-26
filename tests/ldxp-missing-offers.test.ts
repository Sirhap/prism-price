/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, expect, it, vi } from "vitest";
import { removeConfirmedLdxpOffers } from "../src/collector/etl/hashAndDiff";
import type { ShopRecord } from "../src/types";
import { handleApiRequest } from "../src/routes/api";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

it("部分同步移除经确认的 LDXP 旧报价，保留更新观察、库存未知和店铺历史", async () => {
  const shopId = "ldxp-confirm-missing";
  const shopUrl = "https://pay.ldxp.cn/shop/Q123";
  const offer = (itemKey: string, price: number, stockCount: number | null) => ({
    itemKey, rawName: "Gemini Pro 成品号 季卡", price, stockCount, itemUrl: `https://wzyp.cn/item/${itemKey}`,
  });
  const ingest = (items: ReturnType<typeof offer>[], extras: Record<string, unknown> = {}) =>
    handleApiRequest(new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-ingest-secret" },
      body: JSON.stringify({ shopId, shopUrl, partial: true, snapshot: { shopName: "测试店", canonicalUrl: shopUrl, items }, ...extras }),
    }), env);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const first = "2026-11-24T10:00:00.000Z";
    const later = "2026-11-26T10:00:00.000Z";
    vi.setSystemTime(new Date(first));
    const removed = offer("removed", 8.80, 0);
    const observedAgain = offer("observedAgain", 9.90, 2);
    const unknown = offer("unknown", 11, null);
    expect((await ingest([removed, observedAgain, unknown])).status).toBe(200);
    const syncList = await handleApiRequest(new Request("http://localhost/api/shops?fields=sync"), env);
    expect(await syncList.json()).toMatchObject({ ldxpRemovalSupport: true });

    const proofs = [removed, observedAgain].map(({ itemKey }) => ({ itemKey, updatedAt: first, lastSyncedAt: first }));
    vi.setSystemTime(new Date(later));
    expect((await ingest([observedAgain])).status).toBe(200);
    const badShop = await ingest([], { shopUrl: "https://wzyp.cn/shop/DIFFERENT", confirmedMissingOffers: proofs });
    expect(await badShop.json()).toMatchObject({ failedCount: 1 });
    expect((await ingest([unknown], { confirmedMissingOffers: proofs })).status).toBe(400);
    expect((await ingest([], { confirmedMissingOffers: [{ itemKey: removed.itemKey, updatedAt: first }] })).status).toBe(400);

    vi.setSystemTime(new Date("2026-11-26T11:00:00.000Z"));
    const apply = await ingest([], { confirmedMissingOffers: proofs });
    expect(await apply.json()).toMatchObject({ updatedCount: 1, failedCount: 0 });
    const retry = await ingest([], { confirmedMissingOffers: proofs });
    expect(await retry.json()).toMatchObject({ skippedUnchanged: 1, failedCount: 0 });
    const remaining = await env.DB.prepare("SELECT id, stock_count, updated_at, last_observed_at FROM offers WHERE shop_id = ? ORDER BY price")
      .bind(shopId).all();
    expect(remaining.results).toEqual([
      { id: `${shopId}:observedAgain`, stock_count: 2, updated_at: first, last_observed_at: later },
      { id: `${shopId}:unknown`, stock_count: null, updated_at: first, last_observed_at: first },
    ]);
    expect(await env.DB.prepare("SELECT min_price, offer_count FROM product_groups WHERE lead_shop_id = ?").bind(shopId).first())
      .toEqual({ min_price: 9.9, offer_count: 2 });
    expect(await env.DB.prepare("SELECT last_synced_at, product_count FROM shops WHERE id = ?").bind(shopId).first())
      .toEqual({ last_synced_at: later, product_count: 2 });
    expect(await env.DB.prepare("SELECT product_count FROM shop_daily_snapshots WHERE shop_id = ? AND day = '2026-11-24'").bind(shopId).first())
      .toEqual({ product_count: 3 });

    const shop = (await env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(shopId).first<ShopRecord>())!;
    const newObservation = "2026-11-26T11:30:00.000Z";
    const dbWithRace = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: async (statements: D1PreparedStatement[]) => {
        if (statements.length > 1) {
          await env.DB.prepare("UPDATE offers SET last_observed_at = ? WHERE id = ?")
            .bind(newObservation, `${shopId}:${unknown.itemKey}`).run();
        }
        return env.DB.batch(statements);
      },
    } as D1Database;
    await expect(removeConfirmedLdxpOffers(dbWithRace, shop, [
      { itemKey: unknown.itemKey, updatedAt: first, lastSyncedAt: first },
    ], "2026-11-26T12:00:00.000Z")).rejects.toThrow("复核期间店铺或报价已更新");
    expect(await env.DB.prepare("SELECT last_observed_at FROM offers WHERE id = ?")
      .bind(`${shopId}:${unknown.itemKey}`).first()).toEqual({ last_observed_at: newObservation });
    expect(await env.DB.prepare("SELECT min_price, offer_count FROM product_groups WHERE lead_shop_id = ?").bind(shopId).first())
      .toEqual({ min_price: 9.9, offer_count: 2 });
  } finally {
    vi.useRealTimers();
  }
});
