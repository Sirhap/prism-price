/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { persistShopSnapshot } from "../src/collector/etl/hashAndDiff";
import { upsertAdminShops } from "../src/collector/scheduler";
import type { RawShopSnapshot, ShopRecord } from "../src/types";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** 代理真实 D1，只计数实际调用；batch 中所有语句仍交给真实数据库执行。 */
function countedDatabase(database: D1Database) {
  const stats = { calls: 0, readBatchSizes: [] as number[], maxReadBindings: 0 };
  const rawStatements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const statementSql = new WeakMap<D1PreparedStatement, string>();
  const wrapStatement = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, key) {
        if (key === "bind") return (...values: unknown[]) => wrapStatement(target.bind(...values), sql);
        if (["first", "all", "run", "raw"].includes(String(key))) {
          return (...args: unknown[]) => {
            stats.calls += 1;
            return Reflect.apply(Reflect.get(target, key), target, args);
          };
        }
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    rawStatements.set(wrapped, statement);
    statementSql.set(wrapped, sql);
    return wrapped;
  };
  const db = new Proxy(database, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => wrapStatement(target.prepare(sql), sql);
      if (key === "batch") return (statements: D1PreparedStatement[]) => {
        stats.calls += 1;
        const readStatements = statements.filter((statement) => statementSql.get(statement)?.trimStart().startsWith("SELECT"));
        if (readStatements.length) {
          stats.readBatchSizes.push(readStatements.length);
          for (const statement of readStatements) {
            stats.maxReadBindings = Math.max(stats.maxReadBindings, (statementSql.get(statement)?.match(/\?/g) || []).length);
          }
        }
        return target.batch(statements.map((statement) => rawStatements.get(statement) || statement));
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db, stats };
}

describe("超大店铺重新归类的 D1 调用预算", () => {
  it("2000 个旧组全部换键时合并 50 条分片读取，并清理旧组", async () => {
    const shopId = "reclassify-2000";
    const shopUrl = "https://reclassify-2000.example/";
    await upsertAdminShops(env.DB, [{ id: shopId, shopName: "重分类大店", shopUrl }]);
    const makeSnapshot = (version: string): RawShopSnapshot => ({
      shopName: "重分类大店", canonicalUrl: shopUrl, telegram: "", shopSellCount: null,
      salesVisible: false, depositVisible: false, depositMoney: null,
      items: Array.from({ length: 2000 }, (_, index) => ({
        itemKey: String(index), rawName: `Codex Plus ${version} 规格 ${index} 成品号 月卡`, shopCategory: "Codex",
        price: 10 + index, stockCount: 10, stockStatus: "normal", itemUrl: `${shopUrl}item/${index}`,
      })),
    });
    const initialShop = await env.DB.prepare("SELECT * FROM shops WHERE id=?").bind(shopId).first<ShopRecord>();
    expect(initialShop).not.toBeNull();
    const first = countedDatabase(env.DB);
    const initial = await persistShopSnapshot(first.db, initialShop!, makeSnapshot("旧版"), "2026-11-11T00:00:00.000Z");
    expect(initial.itemCount).toBe(2000);
    expect(first.stats.calls).toBeLessThan(50);
    expect(first.stats.readBatchSizes).toEqual([25]);

    const currentShop = await env.DB.prepare("SELECT * FROM shops WHERE id=?").bind(shopId).first<ShopRecord>();
    const second = countedDatabase(env.DB);
    const updated = await persistShopSnapshot(second.db, currentShop!, makeSnapshot("新版"), "2026-11-11T00:01:00.000Z");
    expect(updated.itemCount).toBe(2000);
    expect(updated.status).toBe("updated");
    // 4000 个受影响 key -> 50 条 SELECT，但只有一次读取 batch。
    expect(second.stats.readBatchSizes).toEqual([50]);
    expect(second.stats.maxReadBindings).toBe(80);
    // 预留入口查店、初始化检查、系统/适配器更新及同步日志的 6 次开销。
    expect(second.stats.calls + 6).toBeLessThanOrEqual(50);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM offers WHERE shop_id=?").bind(shopId).first("count")).toBe(2000);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM product_groups WHERE display_name LIKE '%旧版%'").first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM product_groups WHERE display_name LIKE '%新版%'").first("count")).toBe(2000);
    const sample = await env.DB.prepare("SELECT min_price, median_price, max_price, shop_count, offer_count FROM product_groups WHERE display_name=?")
      .bind("Codex Plus 新版 规格 1999 成品号 月卡").first();
    expect(sample).toMatchObject({ min_price: 2009, median_price: 2009, max_price: 2009, shop_count: 1, offer_count: 1 });
  });
});
