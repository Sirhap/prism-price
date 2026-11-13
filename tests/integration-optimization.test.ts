/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { extractIntegrationCodes, hideTelegramContacts } from "../src/collector/shopPresentation";
import { persistShopSnapshot } from "../src/collector/etl/hashAndDiff";
import { upsertAdminShops } from "../src/collector/scheduler";
import type { RawShopSnapshot, ShopRecord } from "../src/types";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

it("识别多个明确对接码，保留大小写并排除 URL、API 密钥及普通邀请码", () => {
  expect(extractIntegrationCodes('对接码：AbC_123\n對接碼（自动发卡）：xyZ-987\n对接码为 AbC_123')).toEqual(["AbC_123", "xyZ-987"]);
  expect(extractIntegrationCodes("小白源头 对接码：34的小店", "对接码：XAI666", "源头代理对接：GPT666", "即刻智联AI-对接马∶ok1的小店")).toEqual(["34", "XAI666", "GPT666", "ok1"]);
  expect(extractIntegrationCodes('邀请码：hello API key: sk-secret TG: @support 对接码：https://example.com 对接码：abc@example.com')).toEqual([]);
  expect(hideTelegramContacts('客服 @support_test / https://t.me/support_test / tg://resolve?domain=test / foo@gmail.com'))
    .not.toMatch(/@support_test|t\.me\/|tg:\/\//);
  expect(hideTelegramContacts('foo@gmail.com')).toBe('foo@gmail.com');
});

it("对接码筛选准确计数、分页、联动系统；公开简介及响应不展示 TG", async () => {
  await upsertAdminShops(env.DB, [
    { id: "code-a", shopName: "码筛选验证 A @hidden_name", shopUrl: "https://code-a.example/", systemType: "ldxp", description: "对接码：Demo_A1 TG: @hidden_support" },
    { id: "code-b", shopName: "码筛选验证 B", shopUrl: "https://code-b.example/", systemType: "dujiaoka", description: "对接码：Demo_B2" },
    { id: "code-empty", shopName: "码筛选验证 空", shopUrl: "https://code-empty.example/", description: "支持对接，请联系客服 @support_test" },
  ]);
  const response = await SELF.fetch("http://localhost/api/shops?q=码筛选验证&hasIntegrationCode=1&page=1&pageSize=1");
  const body = await response.json() as { total: number; totalPages: number; shops: Array<{ description: string; integrationCodes: string[] }> };
  expect(body.total).toBe(2);
  expect(body.totalPages).toBe(2);
  expect(body.shops).toHaveLength(1);
  expect(body.shops[0].integrationCodes).toHaveLength(1);
  expect(JSON.stringify(body)).not.toContain("@hidden_support");
  expect(JSON.stringify(body)).not.toContain("@hidden_name");
  expect(JSON.stringify(body)).not.toContain('"telegram"');
  const filtered = await (await SELF.fetch("http://localhost/api/shops?q=码筛选验证&hasIntegrationCode=1&systemType=dujiaoka&page=1")).json() as { total: number; shops: Array<{ id: string }>; facets: { systemTypes: Record<string, number> } };
  expect(filtered.total).toBe(1);
  expect(filtered.shops[0].id).toBe("code-b");
  expect(filtered.facets.systemTypes.ldxp).toBe(1);
});

describe("按商品差异写入", () => {
  it("百件商品仅改一个价格时保留其余报价和聚合时间，移除商品并清理旧组，重复推送不写心跳", async () => {
    const id = "diff-shop";
    const url = "https://diff-shop.example/";
    await upsertAdminShops(env.DB, [{ id, shopName: "差异测试店", shopUrl: url }]);
    const current = async () => (await env.DB.prepare("SELECT * FROM shops WHERE id=?").bind(id).first<ShopRecord>())!;
    const snapshot: RawShopSnapshot = {
      shopName: "差异测试店", canonicalUrl: url, telegram: "", shopSellCount: null,
      salesVisible: false, depositVisible: false, depositMoney: null,
      items: Array.from({ length: 100 }, (_, index) => ({ itemKey: String(index), rawName: `Codex Plus 成品号 月卡 编号 ${index}`,
        shopCategory: "Codex", price: 20, stockCount: 10, stockStatus: "normal", itemUrl: `${url}${index}` })),
    };
    await persistShopSnapshot(env.DB, await current(), snapshot, "2026-11-12T00:00:00Z");
    snapshot.items[0].price = 25;
    const changed = await persistShopSnapshot(env.DB, await current(), snapshot, "2026-11-12T01:00:00Z");
    expect(changed.estimatedWrites).toBeLessThan(30);
    const times = await env.DB.prepare("SELECT updated_at, COUNT(*) AS count FROM offers WHERE shop_id=? GROUP BY updated_at").bind(id).all<{ updated_at: string; count: number }>();
    expect(times.results).toContainEqual({ updated_at: "2026-11-12T00:00:00Z", count: 99 });
    expect(times.results).toContainEqual({ updated_at: "2026-11-12T01:00:00Z", count: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) FROM product_groups WHERE updated_at=? AND group_key IN (SELECT group_key FROM offers WHERE shop_id=?)")
      .bind("2026-11-12T01:00:00Z", id).first("COUNT(*)")).toBe(1);
    const unchanged = await persistShopSnapshot(env.DB, await current(), snapshot, "2026-11-12T02:00:00Z", { minUnchangedIntervalMs: 12 * 3600000 });
    expect(unchanged.estimatedWrites).toBe(0);
    expect((await current()).last_synced_at).toBe("2026-11-12T01:00:00Z");
    const removed = snapshot.items.pop()!;
    await persistShopSnapshot(env.DB, await current(), snapshot, "2026-11-12T03:00:00Z");
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM offers WHERE id=?").bind(`${id}:${removed.itemKey}`).first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM product_groups WHERE group_key NOT IN (SELECT group_key FROM offers)").first("count")).toBe(0);
  });
});

it("重复导入相同店铺配置时不执行无效 UPDATE，简介变更仍写入", async () => {
  const entry = { id: "noop-admin", shopName: "无变化配置", shopUrl: "https://noop-admin.example/", description: "对接码：noop123", systemType: "ldxp" as const };
  await upsertAdminShops(env.DB, [entry]);
  await env.DB.prepare("UPDATE shops SET updated_at='2020-01-01' WHERE id=?").bind(entry.id).run();
  await upsertAdminShops(env.DB, [entry]);
  expect(await env.DB.prepare("SELECT updated_at FROM shops WHERE id=?").bind(entry.id).first("updated_at")).toBe("2020-01-01");
  await upsertAdminShops(env.DB, [{ ...entry, description: "对接码：changed123" }]);
  expect(await env.DB.prepare("SELECT description FROM shops WHERE id=?").bind(entry.id).first("description")).toBe("对接码：changed123");
});
