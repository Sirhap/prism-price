/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

it("共享平台按精确域名派生，列表、筛选、计数与详情一致且不修改数据库", async () => {
  const entries = [
    ["platform-cat", "https://catfk.com/shop/a"],
    ["platform-cat-www", "https://www.catfk.com/shop/b"],
    ["platform-16688", "https://www.16688.com.cn/shop/a"],
    ["platform-16688-root", "https://16688.com.cn/shop/b"],
    ["platform-near", "https://catfk.com.evil.example/shop/a"],
  ];
  for (const [id, url] of entries) {
    await env.DB.prepare("INSERT INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,system_type,next_sync_at,updated_at) VALUES (?,?,?,?,?,'unknown',?,?)")
      .bind(id, id, url, url, "push_ingest", "2026-01-01", "2026-01-01").run();
  }
  for (const [type, ids] of [["catfk", ["platform-cat", "platform-cat-www"]], ["16688", ["platform-16688", "platform-16688-root"]]] as const) {
    const response = await SELF.fetch(`http://localhost/api/shops?systemType=${type}&q=platform&page=1&pageSize=10`);
    const body = await response.json() as { total: number; facets: { systemTypes: Record<string, number> }; shops: Array<{ id: string; systemType: string }> };
    expect(body.total).toBe(2); expect(body.facets.systemTypes[type]).toBe(2);
    expect(body.shops.map((shop) => shop.id).sort()).toEqual([...ids].sort());
    expect(body.shops.every((shop) => shop.systemType === type)).toBe(true);
    const detail = await (await SELF.fetch(`http://localhost/api/shops/${ids[0]}`)).json() as { shop: { systemType: string } };
    expect(detail.shop.systemType).toBe(type);
  }
  const near = await (await SELF.fetch("http://localhost/api/shops/platform-near")).json() as { shop: { systemType: string } };
  expect(near.shop.systemType).toBe("unknown");
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM shops WHERE id LIKE 'platform-%' AND system_type='unknown'").first("n")).toBe(5);
});

it("新平台推送不违反旧数据库类型约束", async () => {
  const response = await SELF.fetch("http://localhost/api/ingest", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-ingest-secret" }, body: JSON.stringify({ shops: [{ shopId: "platform-push", shopUrl: "https://catfk.com/shop/push", snapshot: { shopName: "push", canonicalUrl: "https://catfk.com/shop/push", items: [] } }] }) });
  expect(response.status).toBe(200);
  const detail = await (await SELF.fetch("http://localhost/api/shops/platform-push")).json() as { shop: { systemType: string } };
  expect(detail.shop.systemType).toBe("catfk");
});
