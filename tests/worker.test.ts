/// <reference types="@cloudflare/vitest-pool-workers/types" />
import {
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  env,
  SELF,
  waitOnExecutionContext,
  type D1Migration,
} from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { extractMainCategories, handleApiRequest } from "../src/routes/api";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const ADMIN_AUTH_HEADERS = {
  "Content-Type": "application/json",
  Authorization: "Bearer test-ingest-secret",
};

function installUpstreamFetchMock() {
  const realFetch = globalThis.fetch;
  const mockHtml = `<!doctype html>
    <html><body>
      <h1 class="shop-title">SSR 协议测试店</h1>
      <div class="shop-notice">售后电报 @ssr_test_tg</div>
      <div class="shop-meta" data-sell-count="77" data-deposit="300"></div>
      <div class="goods-card" data-item-id="real-kiro-1" data-stock-status="normal">
        <span class="goods-cat">Kiro</span>
        <a class="goods-title" href="https://ssr-shop.example/item/1">Kiro Pro 独享月卡 质保30天</a>
        <span class="goods-price">88.80</span>
        <span class="goods-stock">12</span>
      </div>
    </body></html>`;

  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const targetUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (targetUrl === "https://ka123.plus/api/catalog") {
      return Response.json({
        ok: true,
        data: {
          exchange_rate: { rate: 6.64 },
          sections: [{ id: "sec-1", title: "接码号" }],
          products: [
            {
              id: "ka-1",
              section_id: "sec-1",
              name: "ChatGPT 接码服务 短效卡",
              price_micro: 380000,
              stock_available: 30,
              listed: true,
              can_issue: true,
              issue_enabled: true,
            },
          ],
        },
      });
    }

    if (targetUrl === "https://ssr-shop.example/shop") {
      return new Response(mockHtml, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (targetUrl === "https://api-shop.example/products.json") {
      return Response.json({
        shop: {
          shopName: "JSON 直连测试店",
          canonicalUrl: "https://api-shop.example",
          telegram: "@json_test_tg",
          salesVisible: true,
          sellCount: 45,
          depositVisible: false,
        },
        products: [
          {
            id: "j1",
            title: "Cursor Pro 独享成品号 月卡 美区 有质保",
            categoryName: "Cursor",
            price: 10,
            currency: "USD",
            stock: 9,
            url: "https://api-shop.example/item/j1",
          },
          {
            id: "j2",
            title: "Cursor 缺货项",
            categoryName: "Cursor",
            price: 5,
            currency: "CNY",
            stock: 0,
          },
        ],
      });
    }

    if (targetUrl === "https://wzyp.cn/shopApi/Shop/info") {
      return Response.json({
        code: 1,
        msg: "success",
        data: {
          link: "https://wzyp.cn/shop/test_token",
          nickname: "WZYP 协议直连店",
          description: "客服电报 @wzyp_test_tg",
          sell_count: 150,
          deposit_money: 200,
        },
      });
    }

    if (targetUrl === "https://wzyp.cn/shopApi/Shop/goodsList") {
      return Response.json({
        code: 1,
        msg: "success",
        data: {
          total: 2,
          list: [
            {
              goods_key: "g1",
              link: "https://wzyp.cn/item/g1",
              name: "ChatGPT Plus 月卡 官方直充 质保",
              price: 115,
              category: { name: "GPT直充" },
              extend: { stock_count: 8, show_stock_type: 1 },
            },
            {
              goods_key: "g2",
              link: "https://wzyp.cn/item/g2",
              name: "缺货商品测试",
              price: 10,
              category: { name: "测试" },
              extend: { stock_count: 0, show_stock_type: 1 },
            },
          ],
        },
      });
    }

    if (targetUrl === "https://catfk.com/shopApi/Shop/info" || targetUrl === "https://catfk.com/shopApi/Shop/goodsList") {
      return Response.json({ code: 0, msg: "该商家已被封禁", data: null });
    }

    return realFetch(input, init);
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("正式生产版 Workers + D1 核心链路测试", () => {
  it("应正确初始化 5 家正式店铺，并拦截未授权管理请求与已废弃接口", async () => {
    const shopsRes = await SELF.fetch("http://localhost/api/shops");
    expect(shopsRes.status).toBe(200);
    expect(shopsRes.headers.get("Cache-Control")).toContain("public");

    const shopsData = (await shopsRes.json()) as {
      shops: Array<{ id: string; adapterType: string; mockOverride?: unknown }>;
    };
    expect(shopsData.shops).toHaveLength(5);
    expect(shopsData.shops.some((s) => s.id === "real-catfk-banned")).toBe(false);
    expect(shopsData.shops[0].mockOverride).toBeUndefined();

    // 验证所有写/管理接口必须带正确 Bearer Secret
    const protectedRequests = [
      SELF.fetch("http://localhost/api/sync", { method: "POST" }),
      SELF.fetch("http://localhost/api/admin/shops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shops: [{ shopUrl: "https://example.com" }] }),
      }),
      SELF.fetch("http://localhost/api/admin/shops/real-ka123-plus", { method: "DELETE" }),
      SELF.fetch("http://localhost/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-secret" },
        body: JSON.stringify({ shops: [] }),
      }),
    ];

    const responses = await Promise.all(protectedRequests);
    for (const res of responses) {
      expect(res.status).toBe(401);
    }

    // 验证旧 Demo 接口已移除
    const oldCreate = await SELF.fetch("http://localhost/api/shops", { method: "POST" });
    const oldMutate = await SELF.fetch("http://localhost/api/mock/mutate", { method: "POST" });
    expect(oldCreate.status).toBe(404);
    expect(oldMutate.status).toBe(404);
  });

  it("应支持管理员导入、多适配器切片采集（含 Hash 跳过）与 SSRF 私网拦截", async () => {
    const fetchSpy = installUpstreamFetchMock();

    // 1. 管理员批量导入 5 家测试店铺（含 1 个内网探测 URL 与 1 个封禁源站）
    const importRes = await SELF.fetch("http://localhost/api/admin/shops", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({
        shops: [
          {
            id: "test-ssr-shop",
            shopName: "SSR 协议测试店",
            shopUrl: "https://ssr-shop.example/shop",
            adapterType: "ssr_html",
          },
          {
            id: "test-json-shop",
            shopName: "JSON 直连测试店",
            shopUrl: "https://api-shop.example/products.json",
            adapterType: "json_api",
          },
          {
            id: "test-wzyp-shop",
            shopName: "WZYP 协议直连店",
            shopUrl: "https://pay.ldxp.cn/shop/test_token",
            canonicalUrl: "https://wzyp.cn/shop/test_token",
            adapterType: "shop_api",
          },
          {
            id: "test-catfk-banned",
            shopName: "封禁店铺",
            shopUrl: "https://catfk.com/shop/BANNED",
            adapterType: "shop_api",
          },
          {
            id: "test-ssrf-private",
            shopName: "内网探测探针",
            shopUrl: "http://169.254.169.254/latest/meta-data/",
            adapterType: "json_api",
          },
        ],
      }),
    });
    expect(importRes.status).toBe(200);
    const importData = (await importRes.json()) as { ok: boolean; upserted: number };
    expect(importData).toEqual({ ok: true, upserted: 5 });

    // 2. 分别定向同步 ka123_api / ssr_html / json_api / shop_api
    for (const shopId of ["real-ka123-plus", "test-ssr-shop", "test-json-shop", "test-wzyp-shop"]) {
      const syncRes = await SELF.fetch("http://localhost/api/sync", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify({ shopId }),
      });
      expect(syncRes.status).toBe(200);
      const syncData = (await syncRes.json()) as { updatedCount: number; failedCount: number };
      expect(syncData.updatedCount).toBe(1);
      expect(syncData.failedCount).toBe(0);
    }

    // 二次同步应命中 SHA-256 Hash 跳过写入
    const repeatSyncRes = await SELF.fetch("http://localhost/api/sync", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({ shopId: "test-ssr-shop" }),
    });
    const repeatSync = (await repeatSyncRes.json()) as { updatedCount: number; skippedUnchanged: number };
    expect(repeatSync.updatedCount).toBe(0);
    expect(repeatSync.skippedUnchanged).toBe(1);

    // 3. 验证上游封禁异常处理
    const bannedSync = (await (
      await SELF.fetch("http://localhost/api/sync", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify({ shopId: "test-catfk-banned" }),
      })
    ).json()) as { failedCount: number; outcomes: Array<{ error?: string }> };
    expect(bannedSync.failedCount).toBe(1);
    expect(bannedSync.outcomes[0].error).toContain("封禁");

    // 4. 验证 SSRF 私网地址拦截（禁止实际触发内网 fetch）
    const ssrfSync = (await (
      await SELF.fetch("http://localhost/api/sync", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify({ shopId: "test-ssrf-private" }),
      })
    ).json()) as { failedCount: number; outcomes: Array<{ error?: string }> };
    expect(ssrfSync.failedCount).toBe(1);
    expect(ssrfSync.outcomes[0].error).toContain("禁止请求内网或保留地址");
    expect(fetchSpy.mock.calls.some(([req]) => String(req).includes("169.254.169.254"))).toBe(false);

    // 5. 验证 Kiro 与 Cursor 采集与属性清洗入库结果
    const kiroData = (await (await SELF.fetch("http://localhost/api/products?group=Kiro")).json()) as {
      items: Array<{ minPrice: number; name: string }>;
    };
    expect(kiroData.items).toHaveLength(1);
    expect(kiroData.items[0].minPrice).toBe(88.8);

    const cursorData = (await (
      await SELF.fetch("http://localhost/api/products?group=Cursor&region=us&warranty=yes")
    ).json()) as {
      items: Array<{ minPrice: number }>;
    };
    expect(cursorData.items).toHaveLength(1);
    expect(cursorData.items[0].minPrice).toBe(71.5);
  });

  it("POST /api/ingest 应支持增量推送、facets 计数、offerKey 展开与 DELETE 级联重算", async () => {
    // 1. 超过单次 5 店上限拒绝 400
    const tooManyRes = await SELF.fetch("http://localhost/api/ingest", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({
        shops: Array.from({ length: 6 }, (_, i) => ({
          shopId: `p-${i}`,
          shopUrl: `https://example.com/${i}`,
        })),
      }),
    });
    expect(tooManyRes.status).toBe(400);

    // 2. 推送两家同款 Gemini 商品 + 一款未标注质保的对比项
    const pushPayload = {
      shops: [
        {
          shopId: "push-shop-a",
          shopUrl: "https://pay.ldxp.cn/shop/push_a",
          snapshot: {
            shopName: "推送测试店A",
            canonicalUrl: "https://wzyp.cn/shop/push_a",
            telegram: "@push_a",
            shopSellCount: 10,
            salesVisible: true,
            depositVisible: true,
            depositMoney: 100,
            items: [
              {
                itemKey: "p1",
                rawName: "Gemini Advanced 年卡 独享成品号",
                shopCategory: "Gemini",
                price: 210,
                stockCount: 5,
                stockStatus: "low",
                itemUrl: "https://wzyp.cn/item/p1",
              },
            ],
          },
        },
        {
          shopId: "push-shop-b",
          shopUrl: "https://pay.ldxp.cn/shop/push_b",
          snapshot: {
            shopName: "推送测试店B",
            canonicalUrl: "https://wzyp.cn/shop/push_b",
            telegram: "@push_b",
            shopSellCount: 20,
            salesVisible: true,
            depositVisible: false,
            depositMoney: null,
            items: [
              {
                itemKey: "p2",
                rawName: "Gemini Advanced 年卡 独享成品号",
                shopCategory: "Gemini",
                price: 198,
                stockCount: 12,
                stockStatus: "normal",
                itemUrl: "https://wzyp.cn/item/p2",
              },
            ],
          },
        },
      ],
    };

    const push1 = (await (
      await SELF.fetch("http://localhost/api/ingest", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify(pushPayload),
      })
    ).json()) as { triggerSource: string; updatedCount: number };
    expect(push1.triggerSource).toBe("push");
    expect(push1.updatedCount).toBe(2);

    // 二次推送完全相同快照应命中 SHA-256 跳过写入
    const push2 = (await (
      await SELF.fetch("http://localhost/api/ingest", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify(pushPayload),
      })
    ).json()) as { updatedCount: number; skippedUnchanged: number };
    expect(push2.updatedCount).toBe(0);
    expect(push2.skippedUnchanged).toBe(2);

    // 3. 验证 facets.options（不再返回 unmatched）与同款聚合价
    const geminiRes = await SELF.fetch("http://localhost/api/products?group=Gemini&q=独享成品号");
    expect(geminiRes.status).toBe(200);
    expect(geminiRes.headers.get("Cache-Control")).toContain("public");
    const geminiData = (await geminiRes.json()) as {
      items: Array<{ id: string; minPrice: number; shopCount: number; medianPrice: number }>;
      appliedFilters: Record<string, string>;
      facets: {
        options: Record<string, Record<string, number>>;
        unmatched?: unknown;
      };
    };

    expect(geminiData.items).toHaveLength(1);
    const groupKey = geminiData.items[0].id;
    expect(geminiData.items[0].shopCount).toBe(2);
    expect(geminiData.items[0].minPrice).toBe(198);
    expect(geminiData.items[0].medianPrice).toBe(204);
    expect(geminiData.appliedFilters).toMatchObject({ group: "Gemini", q: "独享成品号" });
    expect(geminiData.facets.options.duration.year).toBeGreaterThanOrEqual(1);
    expect(geminiData.facets.unmatched).toBeUndefined();

    // 多词可跨字段、乱序匹配；所有报价店铺都可检索，包含非最低价店铺。
    for (const q of ["年卡 Gemini", "推送测试店A", "Gemini 推送测试店A"]) {
      const data = await (await SELF.fetch(`http://localhost/api/products?q=${encodeURIComponent(q)}`)).json() as typeof geminiData;
      expect(data.items.some((item) => item.id === groupKey)).toBe(true);
    }
    for (const q of ["%", "_"]) {
      const data = await (await SELF.fetch(`http://localhost/api/products?q=${encodeURIComponent(q)}`)).json() as typeof geminiData;
      expect(data.items).toHaveLength(0);
    }
    const badPage = await SELF.fetch("http://localhost/api/products?page=NaN&pageSize=Infinity");
    expect(badPage.status).toBe(200);
    expect(await badPage.json()).toMatchObject({ page: 1, pageSize: 30 });
    const shopSearch = await SELF.fetch(`http://localhost/api/shops?page=1&q=${encodeURIComponent("Gemini 推送测试店A")}`);
    expect(await shopSearch.json()).toMatchObject({ total: 1 });
    // 旧版 unmarked 及已废弃 warranty 参数应安全清理归位为 all
    const unmarkedRes = await SELF.fetch("http://localhost/api/products?group=Gemini&plan=unmarked&warranty=unmarked");
    const unmarkedData = (await unmarkedRes.json()) as typeof geminiData;
    expect(unmarkedData.appliedFilters).toMatchObject({ group: "Gemini", plan: "all" });
    expect(unmarkedData.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: groupKey })]));
    const lightweight = await (await SELF.fetch("http://localhost/api/products?group=Gemini&q=独享成品号&facets=0")).json() as typeof geminiData;
    expect(lightweight.items).toEqual(geminiData.items);
    expect(lightweight.facets).toBeUndefined();

    // 验证 offerKey 按需加载完整报价列表
    const offerDetail = (await (
      await SELF.fetch(`http://localhost/api/products?offerKey=${encodeURIComponent(groupKey)}`)
    ).json()) as { items: Array<{ offers: Array<{ shopId: string; price: number }> }> };
    expect(offerDetail.items[0].offers.map((o) => o.shopId)).toEqual(["push-shop-b", "push-shop-a"]);

    // 4. 删除低价店 push-shop-b，验证商品组价格自动重算为 push-shop-a 的 210
    const delBRes = await SELF.fetch("http://localhost/api/admin/shops/push-shop-b", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-ingest-secret" },
    });
    expect(delBRes.status).toBe(200);
    expect(await delBRes.json()).toEqual({ ok: true, deleted: true, shopId: "push-shop-b" });

    const afterDelB = (await (
      await SELF.fetch("http://localhost/api/products?group=Gemini&q=独享成品号")
    ).json()) as typeof geminiData;
    expect(afterDelB.items).toHaveLength(1);
    expect(afterDelB.items[0].shopCount).toBe(1);
    expect(afterDelB.items[0].minPrice).toBe(210);

    // 5. 再删除 push-shop-a，验证空商品组级联清理；再次删除同一 ID 返回 404
    const delARes = await SELF.fetch("http://localhost/api/admin/shops/push-shop-a", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-ingest-secret" },
    });
    expect(delARes.status).toBe(200);

    const afterDelA = (await (
      await SELF.fetch("http://localhost/api/products?group=Gemini&q=独享成品号")
    ).json()) as typeof geminiData;
    expect(afterDelA.items).toHaveLength(0);

    const delMissing = await SELF.fetch("http://localhost/api/admin/shops/push-shop-a", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-ingest-secret" },
    });
    expect(delMissing.status).toBe(404);
  });

  it("Cron scheduled() 触发器应能正常调度并记录脱敏日志", async () => {
    installUpstreamFetchMock();

    const controller = createScheduledController({ cron: "0 */4 * * *" });
    const ctx = createExecutionContext();
    await worker.scheduled(controller, { ...env, AUTO_SYNC_ENABLED: "true" }, ctx);
    await waitOnExecutionContext(ctx);

    const logsRes = await SELF.fetch("http://localhost/api/sync/logs");
    expect(logsRes.status).toBe(200);
    const logsData = (await logsRes.json()) as {
      logs: Array<{ triggerSource: string; processedCount: number; details?: unknown }>;
    };
    expect(logsData.logs.some((l) => l.triggerSource === "cron")).toBe(true);
    expect(logsData.logs[0].details).toBeUndefined();
  });

  it("GET /api/shops 应支持 SQL 分页过滤、fields=sync 轻量列表与扩展元数据导入", async () => {
    const importRes = await SELF.fetch("http://localhost/api/admin/shops", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({
        shops: [
          {
            id: "manual-history-shop",
            shopName: "独立历史小店",
            shopUrl: "https://manual-history.example/",
            adapterType: "manual",
            telegram: "@manual_hist",
            shopSellCount: 88,
            staleDays: 45,
            productSummary: [{ name: "Plus 成品参考", price: 120 }],
          },
        ],
      }),
    });
    expect(importRes.status).toBe(200);

    // 验证 fields=sync 仅返回 sync_supported = 1 的店铺且不包含 productSummary
    const syncListRes = await SELF.fetch("http://localhost/api/shops?fields=sync");
    expect(syncListRes.status).toBe(200);
    const syncList = (await syncListRes.json()) as {
      shops: Array<{ id: string; productSummary?: unknown }>;
    };
    expect(syncList.shops.some((s) => s.id === "manual-history-shop")).toBe(false);
    expect(syncList.shops[0].productSummary).toBeUndefined();

    // 验证 page & q 分页与扩展元数据保留
    const pageRes = await SELF.fetch("http://localhost/api/shops?page=1&pageSize=2&q=独立历史小店");
    expect(pageRes.status).toBe(200);
    const pageData = (await pageRes.json()) as {
      total: number;
      totalAll: number;
      page: number;
      totalPages: number;
      shops: Array<{
        id: string;
        staleDays: number;
        shopSellCount: number | null;
        productCount: number;
        productSummary: Array<{ name: string; price: number }>;
      }>;
    };
    expect(pageData.total).toBe(1);
    expect(pageData.totalAll).toBeGreaterThan(1);
    expect(pageData.page).toBe(1);
    expect(pageData.shops).toHaveLength(1);
    expect(pageData.shops[0].id).toBe("manual-history-shop");
    expect(pageData.shops[0].staleDays).toBe(45);
    expect(pageData.shops[0].shopSellCount).toBe(88);
    expect(pageData.shops[0].productCount).toBe(1);
    expect(pageData.shops[0].productSummary[0].name).toBe("Plus 成品参考");

    // 推送快照到已注册为 manual 的店铺时，应保留 adapterType = "manual"
    const manualIngestRes = await SELF.fetch("http://localhost/api/ingest", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({
        shops: [
          {
            shopId: "manual-history-shop",
            shopUrl: "https://manual-history.example/",
            snapshot: {
              shopName: "独立历史小店",
              canonicalUrl: "https://manual-history.example/",
              telegram: "@manual_hist",
              shopSellCount: 88,
              salesVisible: true,
              depositVisible: false,
              depositMoney: null,
              items: [
                {
                  itemKey: "m1",
                  rawName: "Claude Pro 月卡 独享账号",
                  shopCategory: "Claude",
                  price: 150,
                  stockCount: 5,
                  stockStatus: "low",
                  itemUrl: "https://manual-history.example/item/1",
                },
              ],
            },
          },
        ],
      }),
    });
    expect(manualIngestRes.status).toBe(200);
    const afterManual = (await (
      await SELF.fetch("http://localhost/api/shops?page=1&pageSize=2&q=独立历史小店")
    ).json()) as { shops: Array<{ adapterType: string; productCount: number }> };
    expect(afterManual.shops[0].adapterType).toBe("manual");
    expect(afterManual.shops[0].productCount).toBe(1);
  });

  it("应支持单店 1000 条商品分片写入和读取，并在来源下架/空店/永久封禁时移除过期商品与同款组", async () => {
    // 1. 单店写入 1000 条商品，验证推送、分片写入和详情读取
    const bigItems = Array.from({ length: 1000 }, (_, idx) => ({
      itemKey: `bulk-${idx + 1}`,
      rawName: `Grok 大店规格项 ${idx + 1} 月卡`,
      shopCategory: "Grok",
      price: 10 + (idx % 50),
      stockCount: 5,
      stockStatus: "low",
      itemUrl: `https://wzyp.cn/item/bulk-${idx + 1}`,
    }));

    const bigIngest = (await (
      await SELF.fetch("http://localhost/api/ingest", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify({
          shops: [
            {
              shopId: "big-shop-1000",
              shopUrl: "https://pay.ldxp.cn/shop/big250",
              snapshot: {
                shopName: "大店测试",
                canonicalUrl: "https://wzyp.cn/shop/big250",
                telegram: "@big250",
                shopSellCount: 500,
                salesVisible: true,
                depositVisible: false,
                depositMoney: null,
                items: bigItems,
              },
            },
          ],
        }),
      })
    ).json()) as { updatedCount: number; outcomes: Array<{ itemCount: number }> };

    expect(bigIngest.updatedCount).toBe(1);
    expect(bigIngest.outcomes[0].itemCount).toBe(1000);

    const bigDetail = (await (
      await SELF.fetch("http://localhost/api/shops/big-shop-1000/products")
    ).json()) as { shop: { productItems: unknown[] } };
    expect(bigDetail.shop.productItems).toHaveLength(1000);

    // 2. 验证商品下架移除与同款比价自动更新/删除：A 卖 shared(50)+exclusive(80)，B 卖 shared(90)
    await SELF.fetch("http://localhost/api/ingest", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({
        shops: [
          {
            shopId: "delist-shop-a",
            shopUrl: "https://pay.ldxp.cn/shop/delista",
            snapshot: {
              shopName: "下架测试店A",
              canonicalUrl: "https://wzyp.cn/shop/delista",
              telegram: "",
              shopSellCount: null,
              salesVisible: false,
              depositVisible: false,
              depositMoney: null,
              items: [
                {
                  itemKey: "s1",
                  rawName: "Kiro 独享测试下架共享版 月卡",
                  shopCategory: "Kiro",
                  price: 50,
                  stockCount: 3,
                  stockStatus: "low",
                  itemUrl: "https://wzyp.cn/item/s1",
                },
                {
                  itemKey: "e1",
                  rawName: "Kiro 独享测试下架独有版 月卡",
                  shopCategory: "Kiro",
                  price: 80,
                  stockCount: 2,
                  stockStatus: "low",
                  itemUrl: "https://wzyp.cn/item/e1",
                },
              ],
            },
          },
          {
            shopId: "delist-shop-b",
            shopUrl: "https://pay.ldxp.cn/shop/delistb",
            snapshot: {
              shopName: "下架测试店B",
              canonicalUrl: "https://wzyp.cn/shop/delistb",
              telegram: "",
              shopSellCount: null,
              salesVisible: false,
              depositVisible: false,
              depositMoney: null,
              items: [
                {
                  itemKey: "s2",
                  rawName: "Kiro 独享测试下架共享版 月卡",
                  shopCategory: "Kiro",
                  price: 90,
                  stockCount: 5,
                  stockStatus: "low",
                  itemUrl: "https://wzyp.cn/item/s2",
                },
              ],
            },
          },
        ],
      }),
    });

    // 店 A 只剩 1 个无关商品（或全部清空 items: []），两个旧商品应当从库里彻底移除
    await SELF.fetch("http://localhost/api/ingest", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({
        shops: [
          {
            shopId: "delist-shop-a",
            shopUrl: "https://pay.ldxp.cn/shop/delista",
            snapshot: {
              shopName: "下架测试店A",
              canonicalUrl: "https://wzyp.cn/shop/delista",
              telegram: "",
              shopSellCount: null,
              salesVisible: false,
              depositVisible: false,
              depositMoney: null,
              items: [],
            },
          },
        ],
      }),
    });

    // 独有商品已被彻底删除；共享商品仅剩店 B（最低价回升为 90，shopCount 为 1）
    const exclAfter = (await (
      await SELF.fetch("http://localhost/api/products?q=独享测试下架独有版")
    ).json()) as { items: unknown[] };
    expect(exclAfter.items).toHaveLength(0);

    const sharedAfterAEmpty = (await (
      await SELF.fetch("http://localhost/api/products?q=独享测试下架共享版")
    ).json()) as { items: Array<{ minPrice: number; shopCount: number }> };
    expect(sharedAfterAEmpty.items).toHaveLength(1);
    expect(sharedAfterAEmpty.items[0].shopCount).toBe(1);
    expect(sharedAfterAEmpty.items[0].minPrice).toBe(90);

    // 3. 当店 B 上报永久封禁错误时，店 B 的旧在售商品也必须自动清除且空同款组彻底删除
    await SELF.fetch("http://localhost/api/ingest", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({
        shops: [
          {
            shopId: "delist-shop-b",
            shopUrl: "https://pay.ldxp.cn/shop/delistb",
            error: "该商家已被封禁",
          },
        ],
      }),
    });

    const sharedAfterBBanned = (await (
      await SELF.fetch("http://localhost/api/products?q=独享测试下架共享版")
    ).json()) as { items: unknown[] };
    expect(sharedAfterBBanned.items).toHaveLength(0);

    const bDetail = (await (
      await SELF.fetch("http://localhost/api/shops/delist-shop-b/products")
    ).json()) as { shop: { productItems: unknown[] } };
    expect(bDetail.shop.productItems).toHaveLength(0);
  });
  it("筛选分面应排除自身条件、合并旧枚举、联动清洗失效组合，且保留卡片属性与价格边界", async () => {
    const names = [
      ["Codex Plus 美区成品账号 月卡 质保首登", 10],
      ["Codex Pro 日区成品账号 年卡 质保30天", 50],
      ["Claude Pro 美区成品账号 月卡 无质保", 150],
      ["Claude Business 日区成品账号 月卡 保订阅但不保封号", 500],
      ["Codex 接码服务 美国实卡", 3],
      ["Codex Plus CDK 官方充值 月卡", 49.99],
      ["Gemini Advanced 港区账号", 149.99],
      ["Muse 10亿token成品号", 499.99],
      ["Gemini Team 美区账号", 9.99],
      ["Cursor Pro 美区账号", 700],
    ] as const;
    const pushed = await SELF.fetch("http://localhost/api/ingest", {
      method: "POST", headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({ shops: [{
        shopId: "filter-regression", shopUrl: "https://example.com/filter-regression",
        snapshot: {
          shopName: "筛选回归店", canonicalUrl: "https://example.com/filter-regression", telegram: "",
          shopSellCount: null, salesVisible: false, depositVisible: false, depositMoney: null,
          items: names.map(([name, price], index) => ({
            itemKey: `filter-${index}`, rawName: `筛选回归 ${name}`, shopCategory: "公开目录",
            price, stockCount: 10, stockStatus: "normal", itemUrl: `https://example.com/item/${index}`,
          })),
        },
      }] }),
    });
    expect(pushed.status).toBe(200);
    type Payload = {
      total: number;
      items: Array<{ id: string; name: string; warrantyText: string; attributes: Record<string, string> }>;
      appliedFilters: Record<string, string>;
      facets: {
        groups: Record<string, number>;
        options: Record<string, Record<string, number>>;
        unmatched?: unknown;
        prices: Record<string, number>;
        countMode: string;
      };
    };
    const get = async (suffix = "") => {
      const response = await SELF.fetch(`http://localhost/api/products?q=${encodeURIComponent("筛选回归")}${suffix}`);
      expect(response.status).toBe(200);
      return await response.json() as Payload;
    };

    const all = await get();
    expect(all.total).toBe(10);
    expect(all.facets.countMode).toBe("replace-dimension");
    expect(all.facets.unmatched).toBeUndefined();
    expect(Object.keys(all.facets.options).sort()).toEqual(["duration", "plan", "type"]);
    expect(all.facets.options.plan.codex).toBeUndefined();
    expect(all.facets.options.plan.k12).toBeUndefined();
    expect(all.facets.options.plan.advanced).toBeUndefined();
    expect(all.facets.options.plan.business).toBeUndefined();
    expect(all.facets.options.type.cdk).toBeUndefined();
    expect(all.facets.options.plan.team).toBe(2);
    expect(all.items.find((item) => item.warrantyText.includes("质保首登"))?.attributes.warranty).toBe("partial");

    const selected = await get("&group=Codex&plan=pro");
    expect(selected.total).toBe(1);
    expect(selected.facets.options.plan.plus).toBe(2);
    expect(selected.facets.groups.Codex).toBe(1);
    expect(selected.facets.groups.Claude).toBe(1);
    expect(selected.facets.groups.Cursor).toBe(1);

    // 已废弃参数（region/warranty/sms=done）不参与过滤且不破坏返回条目展示属性
    const deprecatedIgnored = await get("&group=Codex&plan=pro&region=us&warranty=yes&sms=done");
    expect(deprecatedIgnored.total).toBe(1);
    expect(deprecatedIgnored.appliedFilters).toMatchObject({ group: "Codex", plan: "pro" });

    // 每个保留维度显示的计数必须等于实际替换该维度后接口返回的总数
    for (const [key, value] of [["type", "ready"], ["plan", "plus"], ["duration", "month"]] as const) {
      const query = new URLSearchParams({ group: "Codex", plan: "pro" });
      query.set(key, value);
      const actual = await get(`&${query}`);
      const expected = selected.facets.options[key][value] || 0;
      expect(actual.total, `${key}=${value}`).toBe(expected);
    }

    // 冲突组合自动联动清洗：type=sms-service 清空 plan 且重置 facets.options.plan
    const smsConflict = await get("&type=sms-service&plan=pro");
    expect(smsConflict.appliedFilters).toMatchObject({ type: "sms-service", plan: "all" });
    expect(smsConflict.total).toBe(1);
    expect(smsConflict.facets.options.plan).toEqual({});

    // sort=shop-desc 作为 relevance 别名正常生效
    const aliasSort = await get("&sort=shop-desc");
    expect(aliasSort.appliedFilters.sort).toBe("relevance");

    // 价格 5 档边界精确验证
    const ids = new Set<string>();
    for (const band of ["under-10", "10-50", "50-150", "150-500", "500-plus"]) {
      const data = await get(`&price=${band}`);
      expect(data.total).toBe(2);
      expect(all.facets.prices[band]).toBe(2);
      for (const item of data.items) {
        expect(ids.has(item.id)).toBe(false);
        ids.add(item.id);
      }
    }
    expect(ids.size).toBe(10);

    // ?sms=service 兼容映射至 ?type=sms-service
    const legacy = await get("&sms=service");
    const modern = await get("&type=sms-service");
    expect(legacy.items).toEqual(modern.items);
    expect(legacy.appliedFilters.type).toBe("sms-service");
    expect(modern.items).toHaveLength(1);
    expect(modern.items[0].attributes).toMatchObject({ type: "sms-service", sms: "", region: "us" });

    // 旧库遗留枚举（attr_sms='service'、attr_type='cdk'、attr_plan='business'/'codex'/'k12'/'advanced'）在重采前应兼容聚合与隐藏死项
    await env.DB.prepare("UPDATE product_groups SET attr_type='', attr_sms='service' WHERE group_key=?").bind(modern.items[0].id).run();
    expect((await get("&type=sms-service")).total).toBe(1);
    expect((await get("&sms=service")).total).toBe(1);

    const cdkTarget = all.items.find((item) => item.name.includes("CDK 官方充值"))!;
    await env.DB.prepare("UPDATE product_groups SET attr_type='cdk' WHERE group_key=?").bind(cdkTarget.id).run();
    const rechargeRes = await get("&type=recharge");
    expect(rechargeRes.items.some((item) => item.id === cdkTarget.id)).toBe(true);
    expect(rechargeRes.items.find((item) => item.id === cdkTarget.id)?.attributes.type).toBe("recharge");
    expect((await get("&type=cdk")).appliedFilters.type).toBe("recharge");
    expect((await get("&type=cdk")).total).toBe(rechargeRes.total);
    expect((await get()).facets.options.type.cdk).toBeUndefined();

    const businessTarget = all.items.find((item) => item.name.includes("Claude Business"))!;
    await env.DB.prepare("UPDATE product_groups SET attr_plan='business' WHERE group_key=?").bind(businessTarget.id).run();
    const teamRes = await get("&plan=team");
    expect(teamRes.items.some((item) => item.id === businessTarget.id)).toBe(true);
    expect(teamRes.items.find((item) => item.id === businessTarget.id)?.attributes.plan).toBe("team");
    expect((await get("&plan=business")).appliedFilters.plan).toBe("team");
    expect((await get()).facets.options.plan.business).toBeUndefined();
    expect((await get()).facets.options.plan.team).toBe(2);

    const legacyDeadTarget = all.items.find((item) => item.name.includes("Gemini Advanced"))!;
    await env.DB.prepare("UPDATE product_groups SET attr_plan='codex' WHERE group_key=?").bind(legacyDeadTarget.id).run();
    const afterLegacyDead = await get();
    expect(afterLegacyDead.facets.options.plan.codex).toBeUndefined();
    expect(afterLegacyDead.items.find((item) => item.id === legacyDeadTarget.id)?.attributes.plan).toBe("");

    const museCompat = await get("&group=Muse&plan=pro");
    expect(museCompat.appliedFilters).toMatchObject({ group: "Muse", plan: "all" });
    expect(museCompat.total).toBe(1);

    const maxBindings = await SELF.fetch("http://localhost/api/products?q=one+two+three+four+five+six&group=Codex&type=ready&plan=plus&duration=month&region=us&warranty=partial&sms=done&price=10-50");
    expect(maxBindings.status).toBe(200);
  });

  it("店铺系统类型应独立保存、搜索、筛选，支持 onlyInStock 且非法 systemType 归位为 all", async () => {
    const entries = [
      { id: "system-acg", shopName: "类型回归商家A", shopUrl: "https://system-acg.example/", systemType: "lizhi" },
      { id: "system-dujiao", shopName: "类型回归商家B", shopUrl: "https://system-dujiao.example/", systemType: "独角数卡" },
      { id: "system-ldxp", shopName: "类型回归商家C", shopUrl: "https://pay.ldxp.cn/shop/system-case" },
      { id: "system-unknown", shopName: "类型回归商家D", shopUrl: "https://system-unknown.example/" },
    ];
    const upsert = (shops: unknown[]) => SELF.fetch("http://localhost/api/admin/shops", {
      method: "POST", headers: ADMIN_AUTH_HEADERS, body: JSON.stringify({ shops }),
    });
    expect((await upsert(entries)).status).toBe(200);
    expect((await upsert([{ ...entries[0], systemType: "unsupported-system" }])).status).toBe(400);
    type ShopResult = {
      shops: Array<{ id: string; systemType: string; systemTypeLabel: string; adapterType: string; productCount: number }>;
      total: number;
      totalAll: number;
      facets: { systemTypes: Record<string, number> };
      appliedSystemType: string;
      appliedOnlyInStock: boolean;
      descriptionPersistence: boolean;
    };
    const get = async (suffix: string) => {
      const response = await SELF.fetch(`http://localhost/api/shops?q=${encodeURIComponent("类型回归")}${suffix}`);
      expect(response.status).toBe(200);
      return await response.json() as ShopResult;
    };
    const all = await get("&page=1&pageSize=2");
    expect(all.total).toBe(4);
    expect(all.descriptionPersistence).toBe(true);
    expect(all.shops).toHaveLength(2);
    expect(all.facets.systemTypes).toMatchObject({ ldxp: 1, "acg-faka": 1, dujiaoka: 1, unknown: 1 });
    const acg = await get("&page=1&systemType=acg-faka");
    expect(acg.total).toBe(1);
    expect(acg.shops[0]).toMatchObject({ id: "system-acg", systemTypeLabel: "二次元发卡", adapterType: "push_ingest" });
    expect(acg.facets.systemTypes.dujiaoka).toBe(1);
    const alias = await get("&systemType=lizhi");
    expect(alias.appliedSystemType).toBe("acg-faka");
    expect(alias.shops).toEqual(acg.shops);
    const search = await SELF.fetch(`http://localhost/api/shops?page=1&q=${encodeURIComponent("类型回归 二次元发卡")}`);
    expect(await search.json()).toMatchObject({ total: 1 });

    // 非法 systemType 不再 400 死锁，而是归位为 all 并返回 200
    const invalidSys = await SELF.fetch("http://localhost/api/shops?systemType=manual");
    expect(invalidSys.status).toBe(200);
    expect((await invalidSys.json() as ShopResult).appliedSystemType).toBe("all");

    // 未传系统类型的配置更新不能抹掉已有标注
    const { systemType: _systemType, ...withoutType } = entries[0];
    expect((await upsert([withoutType])).status).toBe(200);
    expect((await get("&systemType=acg-faka")).total).toBe(1);
    const detail = await (await SELF.fetch("http://localhost/api/shops/system-acg/products")).json() as { shop: { systemType: string } };
    expect(detail.shop.systemType).toBe("acg-faka");
    const sync = await (await SELF.fetch("http://localhost/api/shops?fields=sync")).json() as ShopResult;
    expect(sync.shops.find((shop) => shop.id === "system-acg")?.systemType).toBe("acg-faka");
    expect(sync.descriptionPersistence).toBe(true);

    // 推送 1 家有商品，验证 onlyInStock=1 与 hasProducts=1 仅返回 product_count > 0 的店铺及对应分面
    const nonEmptySnapshot = {
      shopName: entries[1].shopName,
      canonicalUrl: entries[1].shopUrl,
      telegram: "",
      shopSellCount: null,
      salesVisible: false,
      depositVisible: false,
      depositMoney: null,
      items: [
        {
          itemKey: "stock-1",
          rawName: "ChatGPT Plus 月卡 成品号",
          shopCategory: "ChatGPT",
          price: 88,
          stockCount: 3,
          stockStatus: "low",
          itemUrl: `${entries[1].shopUrl}item/1`,
        },
      ],
    };
    expect((await SELF.fetch("http://localhost/api/ingest", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({ shops: [{ shopId: "system-dujiao", shopUrl: entries[1].shopUrl, snapshot: nonEmptySnapshot }] }),
    })).status).toBe(200);
    const onlyInStockRes = await get("&page=1&onlyInStock=1");
    expect(onlyInStockRes.total).toBe(1);
    expect(onlyInStockRes.appliedOnlyInStock).toBe(true);
    expect(onlyInStockRes.shops[0].id).toBe("system-dujiao");
    expect(onlyInStockRes.facets.systemTypes).toMatchObject({ dujiaoka: 1, "acg-faka": 0, ldxp: 0, unknown: 0 });
    const hasProductsRes = await get("&hasProducts=1");
    expect(hasProductsRes.total).toBe(1);
    expect(hasProductsRes.appliedOnlyInStock).toBe(true);

    const snapshot = { shopName: entries[0].shopName, canonicalUrl: entries[0].shopUrl, telegram: "", shopSellCount: null,
      salesVisible: false, depositVisible: false, depositMoney: null, items: [] };
    const push = (systemType?: string) => SELF.fetch("http://localhost/api/ingest", {
      method: "POST", headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({ shops: [{ shopId: "system-acg", shopUrl: entries[0].shopUrl, snapshot, ...(systemType ? { systemType } : {}) }] }),
    });
    expect((await push()).status).toBe(200);
    expect((await get("&systemType=acg-faka")).total).toBe(1);
    expect((await push("jsonld")).status).toBe(200);
    expect((await get("&systemType=other")).total).toBe(1);
    expect((await push("bad")).status).toBe(400);
    // 系统标签不等于新增采集能力，适配器仍然保持原值
    expect((await get("&systemType=other")).shops[0].adapterType).toBe("push_ingest");
  });

  it("GET /api/shops/:id 应轻量返回店铺介绍（绝不查 offers、不返回商品与价格），且写入与趋势边界完整可靠", async () => {
    // 1. extractMainCategories 边界安全测试
    expect(extractMainCategories("[]")).toEqual([]);
    expect(extractMainCategories("{bad json")).toEqual([]);
    expect(extractMainCategories(JSON.stringify([{ name: "手工参考商品", price: 99 }]))).toEqual([]);
    expect(
      extractMainCategories(
        JSON.stringify([
          { group: "Codex", count: 3 },
          { group: "中转", count: 12 },
          { group: "ChatGPT", count: 8 },
        ]),
      ),
    ).toEqual([
      { group: "中转", label: "中转额度", count: 12 },
      { group: "ChatGPT", label: "ChatGPT", count: 8 },
      { group: "Codex", label: "Codex", count: 3 },
    ]);

    // 2. 校验 POST /api/admin/shops 与 POST /api/ingest 对 description 的类型检查
    expect(
      (await SELF.fetch("http://localhost/api/admin/shops", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify({ shops: [{ shopUrl: "https://bad-desc.example/", description: 12345 }] }),
      })).status,
    ).toBe(400);
    expect(
      (await SELF.fetch("http://localhost/api/ingest", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify({
          shops: [
            {
              shopId: "bad-desc-push",
              shopUrl: "https://bad-desc-push.example/",
              snapshot: {
                shopName: "非法简介类型店",
                canonicalUrl: "https://bad-desc-push.example/",
                telegram: "",
                description: { text: "bad" },
                shopSellCount: null,
                salesVisible: false,
                depositVisible: false,
                depositMoney: null,
                items: [],
              },
            },
          ],
        }),
      })).status,
    ).toBe(400);

    // 3. 写入完整店铺（包含多类商品与简介），再写入 32 天快照覆盖最早日期、中间 null 与负增长边界
    const introShopId = "intro-lightweight-shop";
    const introUrl = "https://pay.ldxp.cn/shop/intro_demo";
    const pushRes = await SELF.fetch("http://localhost/api/ingest", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({
        shops: [
          {
            shopId: introShopId,
            shopUrl: introUrl,
            snapshot: {
              shopName: "介绍测试店",
              canonicalUrl: "https://wzyp.cn/shop/intro_demo",
              telegram: "@intro_demo_tg",
              description: "主营 AI 账号与中转\r\n仅做信息核验",
              shopSellCount: 95,
              salesVisible: true,
              depositVisible: true,
              depositMoney: 500,
              items: [
                { itemKey: "i1", rawName: "ChatGPT Plus 月卡", shopCategory: "GPT", price: 100, stockCount: 5, stockStatus: "low", itemUrl: "https://wzyp.cn/item/i1" },
                { itemKey: "i2", rawName: "OpenAI 通用中转 API 额度 10刀", shopCategory: "中转", price: 20, stockCount: 8, stockStatus: "normal", itemUrl: "https://wzyp.cn/item/i2" },
                { itemKey: "i3", rawName: "Claude 中转按量额度 20刀", shopCategory: "中转", price: 40, stockCount: 9, stockStatus: "normal", itemUrl: "https://wzyp.cn/item/i3" },
              ],
            },
          },
        ],
      }),
    });
    expect(pushRes.status).toBe(200);

    // 清空自动写入的当日快照，构造 32 天快照：第1天(2026-10-01)销量=120，第2天(2026-10-02)在30天窗口内首日为 null，第3天销量=120，最后一天销量=95（负变化 -25）
    await env.DB.prepare("DELETE FROM shop_daily_snapshots WHERE shop_id = ?").bind(introShopId).run();
    const snapshotInserts: D1PreparedStatement[] = [];
    for (let dayIndex = 1; dayIndex <= 32; dayIndex += 1) {
      const dayStr = `2026-10-${String(dayIndex).padStart(2, "0")}`;
      const totalSales =
        dayIndex === 1
          ? 120
          : dayIndex === 2 || dayIndex === 3
            ? null
            : dayIndex === 32
              ? 95
              : 120;
      snapshotInserts.push(
        env.DB.prepare(
          "INSERT INTO shop_daily_snapshots (shop_id, day, product_count, min_price, median_price, total_sales, has_stock) VALUES (?, ?, 3, 20, 40, ?, 1)",
        ).bind(introShopId, dayStr, totalSales),
      );
    }
    await env.DB.batch(snapshotInserts);

    // 用 SQL 拦截器包装 env.DB，验证 GET /api/shops/:id 绝不查询 offers
    const executedSql: string[] = [];
    const wrapStmt = (stmt: D1PreparedStatement, sql: string): D1PreparedStatement =>
      new Proxy(stmt, {
        get(target, key) {
          if (key === "bind") return (...args: unknown[]) => wrapStmt(target.bind(...args), sql);
          if (["first", "all", "run", "raw"].includes(String(key))) {
            return (...args: unknown[]) => {
              executedSql.push(sql.replace(/\s+/g, " ").trim());
              return Reflect.apply(Reflect.get(target, key), target, args);
            };
          }
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const spyDb = new Proxy(env.DB, {
      get(target, key) {
        if (key === "prepare") return (sql: string) => wrapStmt(target.prepare(sql), sql);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const introRes = await handleApiRequest(
      new Request(`https://local.test/api/shops/${introShopId}`),
      { ...env, DB: spyDb },
    );
    expect(introRes.status).toBe(200);
    expect(executedSql.some((sql) => /\boffers\b/i.test(sql))).toBe(false);

    const introData = (await introRes.json()) as {
      shop: Record<string, unknown> & {
        description: string;
        mainCategories: Array<{ group: string; label: string; count: number }>;
        createdAt: string | null;
        productCount: number;
        shopSellCount: number | null;
        salesTrend: { firstCount: number; currentCount: number; change: number; status: string; observedDays: number };
        shopSignals: Record<string, unknown>;
      };
      capabilities: { systemTypePersistence: boolean; descriptionPersistence: boolean; createdAtPersistence: boolean };
    };

    expect(introData.shop).toMatchObject({
      id: introShopId,
      shopName: "介绍测试店",
      description: "主营 AI 账号与中转\n仅做信息核验",
      systemType: "ldxp",
      systemTypeLabel: "联动小铺",
      productCount: 3,
      shopSellCount: 95,
      mainCategories: [
        { group: "中转", label: "中转额度", count: 2 },
        { group: "ChatGPT", label: "ChatGPT", count: 1 },
      ],
      salesTrend: {
        observedDays: 30,
        firstCount: 120,
        currentCount: 95,
        change: -25,
        status: "declining",
      },
    });
    expect(typeof introData.shop.createdAt).toBe("string");
    // 绝不将 earliestSnapshotDay ("2026-10-01") 冒充为 createdAt
    expect(introData.shop.createdAt).not.toContain("2026-10-01");
    expect(introData.shop.shopSignals).toMatchObject({
      observedDays: 30,
      firstDay: "2026-10-03",
      latestDay: "2026-10-32",
      earliestSnapshotDay: "2026-10-01",
    });
    expect("productItems" in introData.shop).toBe(false);
    expect("minPrice" in introData.shop.shopSignals).toBe(false);
    expect("medianPrice" in introData.shop.shopSignals).toBe(false);
    expect("products" in introData.shop.shopSignals).toBe(false);

    // 验证 0 变化与 0 销量场景（change === 0 -> flat）
    await env.DB.prepare("UPDATE shop_daily_snapshots SET total_sales = 0 WHERE shop_id = ?").bind(introShopId).run();
    const zeroTrendRes = await SELF.fetch(`http://localhost/api/shops/${introShopId}`);
    const zeroTrendData = (await zeroTrendRes.json()) as {
      shop: { salesTrend: { firstCount: number; currentCount: number; change: number; status: string } };
    };
    expect(zeroTrendData.shop.salesTrend).toMatchObject({
      firstCount: 0,
      currentCount: 0,
      change: 0,
      status: "flat",
    });

    // 验证 存量行 created_at = NULL 时不会凭空伪造 createdAt
    await env.DB.prepare("UPDATE shops SET created_at = NULL WHERE id = ?").bind(introShopId).run();
    const nullCreatedRes = await (await SELF.fetch(`http://localhost/api/shops/${introShopId}`)).json() as typeof introData;
    expect(nullCreatedRes.shop.createdAt).toBeNull();

    // 验证兼容明细接口 GET /api/shops/:id/products 仍返回 productItems 与丰富元数据
    const compatRes = await SELF.fetch(`http://localhost/api/shops/${introShopId}/products`);
    expect(compatRes.status).toBe(200);
    const compatData = (await compatRes.json()) as {
      shop: {
        description: string;
        createdAt: string | null;
        productCount: number;
        shopSellCount: number | null;
        mainCategories: unknown[];
        productItems: unknown[];
        shopSignals: { minPrice: number | null; medianPrice: number | null; products: number };
      };
    };
    expect(compatData.shop.description).toBe("主营 AI 账号与中转\n仅做信息核验");
    expect(compatData.shop.createdAt).toBeNull();
    expect(compatData.shop.productCount).toBe(3);
    expect(compatData.shop.shopSellCount).toBe(95);
    expect(compatData.shop.productItems).toHaveLength(3);
    expect(compatData.shop.shopSignals.minPrice).toBe(20);

    // 验证畸形 URL 参数不会抛 500，返回 400；不存在店铺返回 404
    expect((await SELF.fetch("http://localhost/api/shops/%E0%A4%A")).status).toBe(400);
    expect((await SELF.fetch("http://localhost/api/shops/not-exist-shop")).status).toBe(404);

    // 验证空字符串 created_at 归一化为 null，且仅 1 条 0 销量快照时状态为 init
    await env.DB.prepare("UPDATE shops SET created_at = '' WHERE id = ?").bind(introShopId).run();
    await env.DB.prepare("DELETE FROM shop_daily_snapshots WHERE shop_id = ? AND day != '2026-10-32'").bind(introShopId).run();
    const singleZeroSnap = await (await SELF.fetch(`http://localhost/api/shops/${introShopId}`)).json() as typeof introData;
    expect(singleZeroSnap.shop.createdAt).toBeNull();
    expect(singleZeroSnap.shop.salesTrend).toMatchObject({
      observedDays: 1,
      firstCount: 0,
      currentCount: 0,
      change: 0,
      status: "init",
    });

    // 验证最新日快照 total_sales 为 NULL 时不编造趋势，但保留 shopSellCount
    await env.DB.prepare("UPDATE shop_daily_snapshots SET total_sales = NULL WHERE shop_id = ?").bind(introShopId).run();
    const nullLatestSales = await (await SELF.fetch(`http://localhost/api/shops/${introShopId}`)).json() as typeof introData;
    expect(nullLatestSales.shop.salesTrend).toBeNull();
    expect(nullLatestSales.shop.shopSellCount).toBe(95);

    // 验证异常停摆/0商品/无快照店铺在 GET /api/shops/:id 如实输出异常信息与空主营类别
    await env.DB.prepare(
      `INSERT INTO shops (id, shop_name, shop_url, canonical_url, adapter_type, sync_supported, sync_state, last_error, consecutive_failures, shop_sell_count, sales_visible, product_count, product_summary_json, next_sync_at, updated_at)
       VALUES ('error-empty-shop', '异常停摆店', 'https://wzyp.cn/shop/err', 'https://wzyp.cn/shop/err', 'push_ingest', 1, 'error', '该商家已被封禁', 3, 55, 1, 0, '[]', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z')`,
    ).run();
    const errorIntro = await (await SELF.fetch("http://localhost/api/shops/error-empty-shop")).json() as {
      shop: {
        syncState: string;
        lastError: string;
        consecutiveFailures: number;
        lastSyncedAt: string | null;
        productCount: number;
        mainCategories: unknown[];
        salesTrend: unknown;
        shopSellCount: number | null;
      };
    };
    expect(errorIntro.shop).toMatchObject({
      syncState: "error",
      lastError: "该商家已被封禁",
      consecutiveFailures: 3,
      lastSyncedAt: null,
      productCount: 0,
      mainCategories: [],
      salesTrend: null,
      shopSellCount: 55,
    });

    // 验证 POST /api/admin/shops 空白 shopName 不覆写已有店名，数组/非字符串 canonicalUrl 返回 400
    expect(
      (await SELF.fetch("http://localhost/api/admin/shops", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify({ shops: [[]] }),
      })).status,
    ).toBe(400);
    expect(
      (await SELF.fetch("http://localhost/api/admin/shops", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify({ shops: [{ shopUrl: "https://wzyp.cn/shop/err", canonicalUrl: 123 }] }),
      })).status,
    ).toBe(400);
    expect(
      (await SELF.fetch("http://localhost/api/admin/shops", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify({ shops: [{ shopUrl: "https://wzyp.cn/shop/err", shopName: "   " }] }),
      })).status,
    ).toBe(200);
    const preservedName = await (await SELF.fetch("http://localhost/api/shops/error-empty-shop")).json() as {
      shop: { shopName: string };
    };
    expect(preservedName.shop.shopName).toBe("异常停摆店");

    // 验证 POST /api/ingest 畸形商品价格或缺失 itemKey 返回 400 而非 500
    expect(
      (await SELF.fetch("http://localhost/api/ingest", {
        method: "POST",
        headers: ADMIN_AUTH_HEADERS,
        body: JSON.stringify({
          shops: [
            {
              shopId: "bad-item-shop",
              shopUrl: "https://bad-item.example/",
              snapshot: {
                shopName: "坏商品测试",
                canonicalUrl: "https://bad-item.example/",
                telegram: "",
                shopSellCount: null,
                salesVisible: false,
                depositVisible: false,
                depositMoney: null,
                items: [{ itemKey: "k1", rawName: "Bad Price", price: "not-a-number" }],
              },
            },
          ],
        }),
      })).status,
    ).toBe(400);
  });

  it("应区分真实全店无货天数与区间未采样天数，并在 POST /api/admin/shops/probe 中零写入验证 JSON-LD 与 SSRF 防护", async () => {
    const gapShopId = "gap-signal-shop";
    await env.DB.prepare(
      `INSERT INTO shops (
        id, shop_name, shop_url, canonical_url, adapter_type, sync_supported, sync_state,
        product_count, product_summary_json, next_sync_at, updated_at
      ) VALUES (?, '缺口观察测试店', 'https://wzyp.cn/shop/gap_sig', 'https://wzyp.cn/shop/gap_sig', 'push_ingest', 1, 'ready', 1, '[]', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z')`,
    )
      .bind(gapShopId)
      .run();

    // 10 天自然日跨度（11-01 ~ 11-10）仅观测了 6 天：2 天有货 + 4 天无货，其余 4 天为未采样缺失日
    const snapRows: Array<[string, number]> = [
      ["2026-11-01", 1],
      ["2026-11-02", 0],
      ["2026-11-04", 0],
      ["2026-11-06", 0],
      ["2026-11-08", 0],
      ["2026-11-10", 1],
    ];
    for (const [day, hasStock] of snapRows) {
      await env.DB.prepare(
        "INSERT INTO shop_daily_snapshots (shop_id, day, product_count, has_stock) VALUES (?, ?, ?, ?)",
      )
        .bind(gapShopId, day, hasStock ? 3 : 0, hasStock)
        .run();
    }

    const introRes = await SELF.fetch(`http://localhost/api/shops/${gapShopId}`);
    expect(introRes.status).toBe(200);
    const introJson = (await introRes.json()) as {
      shop: {
        shopSignals: {
          observedDays: number;
          activeDayStreak: number;
          outOfStockDays: number;
          windowSpanDays: number;
          unobservedDays: number;
        };
      };
    };
    expect(introJson.shop.shopSignals).toMatchObject({
      observedDays: 6,
      activeDayStreak: 2,
      outOfStockDays: 4,
      windowSpanDays: 10,
      unobservedDays: 4,
    });

    // 验证 /api/admin/shops/probe 权限校验与内网 SSRF 阻断
    expect(
      (await SELF.fetch("http://localhost/api/admin/shops/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopUrl: "https://indie.example/store" }),
      })).status,
    ).toBe(401);

    const ssrfRes = await SELF.fetch("http://localhost/api/admin/shops/probe", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({ shopUrl: "http://169.254.169.254/latest/meta-data" }),
    });
    expect(ssrfRes.status).toBe(400);

    const manualRes = await SELF.fetch("http://localhost/api/admin/shops/probe", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({ shopUrl: "https://indie.example/", adapterType: "manual" }),
    });
    expect(manualRes.status).toBe(400);

    // 试采 Schema.org Product/Offer JSON-LD 自建站，验证 USD 折算、OutOfStock 剔除、占位过滤且零 DB 写入
    const beforeShops = (await env.DB.prepare("SELECT COUNT(*) AS cnt FROM shops").first<{ cnt: number }>())?.cnt || 0;
    const beforeOffers = (await env.DB.prepare("SELECT COUNT(*) AS cnt FROM offers").first<{ cnt: number }>())?.cnt || 0;

    const ldHtml = `
      <!doctype html><html><head>
        <meta property="og:site_name" content="星云 JSON-LD 独立卡站" />
        <meta name="description" content="专注 Claude 与 ChatGPT 独享账号&#10;售后群 https://t.me/jsonld_shop_support" />
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              { "@type": "Store", "name": "星云 JSON-LD 官方店" },
              {
                "@type": "Product",
                "name": "Claude Pro 独享月卡",
                "sku": "claude-pro-1m",
                "category": "Claude",
                "offers": {
                  "@type": "Offer",
                  "price": "20",
                  "priceCurrency": "USD",
                  "availability": "https://schema.org/InStock",
                  "url": "/buy/claude-pro"
                }
              },
              {
                "@type": "Product",
                "name": "测试商品 请勿拍",
                "offers": { "@type": "Offer", "price": "0.01", "priceCurrency": "CNY", "availability": "https://schema.org/InStock" }
              },
              {
                "@type": "Product",
                "name": "ChatGPT Pro 月卡（缺货）",
                "offers": { "@type": "Offer", "price": "1200", "priceCurrency": "CNY", "availability": "https://schema.org/OutOfStock" }
              }
            ]
          }
        </script>
      </head><body></body></html>
    `;

    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const targetUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (targetUrl === "https://indie-jsonld.example/store") {
        return new Response(ldHtml, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return realFetch(input, init);
    });

    const probeRes = await SELF.fetch("http://localhost/api/admin/shops/probe", {
      method: "POST",
      headers: ADMIN_AUTH_HEADERS,
      body: JSON.stringify({ shopUrl: "https://indie-jsonld.example/store" }),
    });
    expect(probeRes.status).toBe(200);
    const probeData = (await probeRes.json()) as {
      ok: boolean;
      dryRun: boolean;
      adapterType: string;
      shopName: string;
      telegram: string;
      rawItemCount: number;
      validItemCount: number;
      sampleOffers: Array<{ cleanName: string; brandGroup: string; price: number }>;
    };
    expect(probeData).toMatchObject({
      ok: true,
      dryRun: true,
      adapterType: "json_ld",
      shopName: "星云 JSON-LD 官方店",
      telegram: "@jsonld_shop_support",
      rawItemCount: 1,
      validItemCount: 1,
    });
    expect(probeData.sampleOffers[0]).toMatchObject({
      cleanName: "Claude Pro 独享月卡",
      brandGroup: "Claude",
      price: 143,
    });

    expect((await env.DB.prepare("SELECT COUNT(*) AS cnt FROM shops").first<{ cnt: number }>())?.cnt).toBe(beforeShops);
    expect((await env.DB.prepare("SELECT COUNT(*) AS cnt FROM offers").first<{ cnt: number }>())?.cnt).toBe(beforeOffers);
  });

  it("shopApiAdapter 与 push-sync 应支持多品类、categoryList 兜底、不完整断档保护及阿里云 WAF 自动解算", async () => {
    const { shopApiAdapter } = await import("../src/collector/adapters/shopApiAdapter");
    const helpers = await import("../scripts/lib/shopApiHelpers.mjs");
    // @ts-expect-error scripts/push-sync.mjs 无独立 .d.mts 声明，在此显式断言测试目标接口
    const pushSync = (await import("../scripts/push-sync.mjs")) as {
      fetchShopApiSnapshot(shop: { shopName?: string; shopUrl: string; telegram?: string }): Promise<unknown>;
    };

    // 1. 验证阿里云 acw_sc__v2 解算器确定性输出合法 40 位 hex cookie，无挑战文本返回空
    expect(helpers.solveAcwScV2Cookie("<html>normal</html>")).toBe("");
    const arg1 = "0123456789ABCDEF0123456789ABCDEF01234567";
    const solvedCookie = helpers.solveAcwScV2Cookie(`<html><script>var arg1='${arg1}';</script></html>`);
    expect(solvedCookie).toMatch(/^acw_sc__v2=[0-9a-f]{40}$/);

    // 2. 验证 shopApiAdapter 支持多品类（card + article）以及 card 无分类为空时自动走 categoryList 兜底，并滤除补差价链接
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const targetUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const bodyObj = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      if (targetUrl === "https://wzyp.cn/shopApi/Shop/info") {
        return Response.json({
          code: 1,
          data: {
            link: "https://wzyp.cn/shop/multi_cat",
            nickname: "全品类兜底测试店",
            description: "全自动发卡",
            goods_type_sort: ["card", "article"],
            card_count: 1,
            article_count: 1,
          },
        });
      }
      if (targetUrl === "https://wzyp.cn/shopApi/Shop/goodsList") {
        if (bodyObj.goods_type === "card" && !bodyObj.category_id) {
          return Response.json({ code: 1, data: { total: 0, list: [] } });
        }
        if (bodyObj.goods_type === "card" && bodyObj.category_id === "99") {
          return Response.json({
            code: 1,
            data: {
              total: 2,
              list: [
                { goods_key: "c1", name: "Cursor Pro 月卡", price: 135, extend: { stock_count: 5 } },
                { goods_key: "c-junk", name: "客服改价 补差价专用链接", price: 1, extend: { stock_count: 99 } },
              ],
            },
          });
        }
        if (bodyObj.goods_type === "article") {
          return Response.json({
            code: 1,
            data: {
              total: 1,
              list: [
                { goods_key: "a1", name: "ChatGPT Team 邀请教程卡密", price: 18, extend: { stock_count: 3 } },
              ],
            },
          });
        }
      }
      if (targetUrl === "https://wzyp.cn/shopApi/Shop/categoryList") {
        return Response.json({
          code: 1,
          data: [{ id: 99, name: "Cursor 专区" }],
        });
      }
      return realFetch(input, init);
    });

    const multiSnap = await shopApiAdapter.fetchSnapshot(
      {
        id: "multi",
        shop_name: "默认名",
        shop_url: "https://wzyp.cn/shop/multi_cat",
        canonical_url: "https://wzyp.cn/shop/multi_cat",
        adapter_type: "shop_api",
        system_type: "ldxp",
        telegram: "",
        sync_supported: 1,
        sync_state: "pending",
        content_hash: "",
        last_synced_at: null,
        next_sync_at: "",
        consecutive_failures: 0,
        last_error: "",
        stale_days: 0,
        shop_sell_count: null,
        sales_visible: 0,
        deposit_visible: 0,
        deposit_money: null,
        product_count: 0,
        product_summary_json: "[]",
        updated_at: "",
      },
      env,
    );
    expect(multiSnap.items.map((it) => it.rawName)).toEqual([
      "Cursor Pro 月卡",
      "ChatGPT Team 邀请教程卡密",
    ]);
    expect(multiSnap.items[0].shopCategory).toBe("Cursor 专区");

    // 3. 验证 push-sync.mjs 遇到 var arg1= 时可求 Cookie 后成功重发；遇到 total>collected 不完整快照时抛错拦截
    vi.restoreAllMocks();
    let seenAcwCookie = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const targetUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const cookieHeader = (init?.headers as Record<string, string> | undefined)?.Cookie || "";
      if (targetUrl === "https://waf-test.example/shopApi/Shop/info") {
        if (!cookieHeader.includes("acw_sc__v2=")) {
          return new Response(`<html><script>var arg1='${arg1}';</script></html>`, {
            status: 200,
            headers: { "Content-Type": "text/html" },
          });
        }
        seenAcwCookie = cookieHeader;
        return Response.json({ code: 1, data: { nickname: "穿透WAF小店", link: "https://waf-test.example/shop/ok" } });
      }
      if (targetUrl === "https://waf-test.example/shopApi/Shop/goodsList") {
        return Response.json({
          code: 1,
          // 声明共 10 条但只返回 1 条（模拟中途截断残缺快照）
          data: {
            total: 10,
            list: [{ goods_key: "only1", name: "Claude Pro 月卡", price: 140, extend: { stock_count: 5 } }],
          },
        });
      }
      throw new Error(`Unexpected url: ${targetUrl}`);
    });

    await expect(
      pushSync.fetchShopApiSnapshot({
        shopName: "WAF店",
        shopUrl: "https://waf-test.example/shop/ok",
        telegram: "",
      }),
    ).rejects.toThrow("快照不完整");
    expect(seenAcwCookie).toContain(solvedCookie);
  });
});



