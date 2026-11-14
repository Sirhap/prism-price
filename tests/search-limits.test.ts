/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildProductRelevanceOrder,
  containsMatch,
  normalizeProductQuery,
} from "../src/routes/search";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const headers = { "Content-Type": "application/json", Authorization: "Bearer test-ingest-secret" };

describe("D1 文本搜索长度边界", () => {
  it("按转义后的 UTF-8 字节选择匹配方式", () => {
    expect(containsMatch("display_name", "a".repeat(48)).sql).toContain(" LIKE ");
    expect(containsMatch("display_name", "a".repeat(49)).sql).toContain("INSTR");
    expect(containsMatch("display_name", "中".repeat(16)).sql).toContain(" LIKE ");
    expect(containsMatch("display_name", "中".repeat(17)).sql).toContain("INSTR");
    expect(containsMatch("display_name", "%".repeat(25)).sql).toContain("INSTR");
  });

  it("长词在商品、店铺和店名关联搜索中保持完整的字面匹配", async () => {
    const longName = "长名称匹配".repeat(5);
    const literal = "%_".repeat(20);
    const productName = `Codex Plus ${longName}${literal}`;
    const url = "https://long-search.example/";
    const response = await SELF.fetch("http://localhost/api/ingest", {
      method: "POST", headers,
      body: JSON.stringify({ shops: [{ shopId: "long-search", shopUrl: url, snapshot: {
        shopName: `店铺${longName}`, canonicalUrl: url, telegram: "", shopSellCount: null, salesVisible: false, depositVisible: false, depositMoney: null,
        items: [{ itemKey: "1", rawName: productName, shopCategory: "Codex", price: 20, stockCount: 10, stockStatus: "normal", itemUrl: `${url}item` }],
      } }] }),
    });
    expect(response.status).toBe(200);
    for (const q of [longName, literal, `店铺${longName}`]) {
      const products = await SELF.fetch(`http://localhost/api/products?q=${encodeURIComponent(q)}`);
      expect(products.status).toBe(200);
      expect(await products.json()).toMatchObject({ total: 1 });
    }
    const shops = await SELF.fetch(`http://localhost/api/shops?page=1&q=${encodeURIComponent(longName)}`);
    expect(shops.status).toBe(200);
    expect(await shops.json()).toMatchObject({ total: 1 });
    const missing = await SELF.fetch(`http://localhost/api/products?q=${encodeURIComponent(longName + "不同尾部")}`);
    expect(missing.status).toBe(200);
    expect(await missing.json()).toMatchObject({ total: 0 });
  });
});

describe("商品筛选参数规范化、联动清除与相关度排序", () => {
  it("应正确映射旧别名、清除非法值并按上下文联动清理失效条件", () => {
    expect(
      normalizeProductQuery(new URLSearchParams("type=cdk&plan=business&sort=shop-desc")).appliedFilters,
    ).toEqual({
      q: "",
      group: "all",
      type: "recharge",
      plan: "team",
      duration: "all",
      price: "all",
      sort: "relevance",
    });

    // 非订阅组清空 plan，部分非订阅组同时清空 duration
    for (const planOnlyClearGroup of ["DeepSeek", "AI创作", "代理IP"]) {
      expect(
        normalizeProductQuery(new URLSearchParams({ group: planOnlyClearGroup, plan: "plus", duration: "month" })).appliedFilters,
      ).toMatchObject({ group: planOnlyClearGroup, plan: "all", duration: "month" });
    }
    expect(
      normalizeProductQuery(new URLSearchParams("group=Muse&plan=plus")).appliedFilters,
    ).toMatchObject({ group: "Muse", plan: "all" });

    for (const nonDurationGroup of ["中转", "虚拟卡", "邮箱账号", "平台账号", "工具教程"]) {
      const res = normalizeProductQuery(
        new URLSearchParams({ group: nonDurationGroup, plan: "plus", duration: "year" }),
      );
      expect(res.allowsPlan).toBe(false);
      expect(res.allowsDuration).toBe(false);
      expect(res.appliedFilters).toMatchObject({ group: nonDurationGroup, plan: "all", duration: "all" });
    }

    // type=sms-service / api 清空 plan，保留允许的 duration
    expect(
      normalizeProductQuery(new URLSearchParams("type=sms-service&plan=plus&duration=month")).appliedFilters,
    ).toMatchObject({ type: "sms-service", plan: "all", duration: "month" });
    expect(
      normalizeProductQuery(new URLSearchParams("sms=service&plan=pro")).appliedFilters,
    ).toMatchObject({ type: "sms-service", plan: "all" });
    expect(
      normalizeProductQuery(new URLSearchParams("type=ready&sms=service")).appliedFilters,
    ).toMatchObject({ type: "ready" });
    expect(
      normalizeProductQuery(new URLSearchParams("type=api&plan=team")).appliedFilters,
    ).toMatchObject({ type: "api", plan: "all" });

    // 废弃枚举、unmarked 与非法参数全部归位
    expect(
      normalizeProductQuery(
        new URLSearchParams("group=invalid&type=unmarked&plan=codex&duration=bad&price=wrong&sort=unknown&warranty=yes&region=us&sms=done"),
      ).appliedFilters,
    ).toEqual({
      q: "",
      group: "all",
      type: "all",
      plan: "all",
      duration: "all",
      price: "all",
      sort: "relevance",
    });
    expect(normalizeProductQuery(new URLSearchParams("plan=advanced")).appliedFilters.plan).toBe("all");
    expect(normalizeProductQuery(new URLSearchParams("plan=k12")).appliedFilters.plan).toBe("all");
    expect(normalizeProductQuery(new URLSearchParams("group=中转额度")).appliedFilters.group).toBe("中转");
  });

  it("buildProductRelevanceOrder 应严格控制绑定参数数并在搜索时优先展示高相关度商品", async () => {
    const emptyOrder = buildProductRelevanceOrder("   ");
    expect(emptyOrder.params).toEqual([]);
    expect(emptyOrder.orderSql).toBe("ORDER BY shop_count DESC, min_price ASC, group_key ASC");

    const maxOrder = buildProductRelevanceOrder("one two three four five six seven eight");
    expect(maxOrder.params.length).toBeLessThanOrEqual(28);
    expect(maxOrder.orderSql).toContain("INSTR(LOWER(display_name)");

    const relUrl = "https://relevance-shop.example/";
    const pushRes = await SELF.fetch("http://localhost/api/ingest", {
      method: "POST",
      headers,
      body: JSON.stringify({
        shops: [
          {
            shopId: "rel-shop-1",
            shopUrl: `${relUrl}1`,
            snapshot: {
              shopName: "RelKeyword 专营店",
              canonicalUrl: `${relUrl}1`,
              telegram: "",
              shopSellCount: null,
              salesVisible: false,
              depositVisible: false,
              depositMoney: null,
              items: [
                {
                  itemKey: "r-shop-hit",
                  rawName: "Claude Pro 月卡",
                  shopCategory: "AI",
                  price: 50,
                  stockCount: 5,
                  stockStatus: "normal",
                  itemUrl: `${relUrl}r1`,
                },
                {
                  itemKey: "r-title-hit",
                  rawName: "RelKeyword Plus 独享月卡",
                  shopCategory: "AI",
                  price: 60,
                  stockCount: 5,
                  stockStatus: "normal",
                  itemUrl: `${relUrl}r2`,
                },
              ],
            },
          },
          {
            shopId: "rel-shop-2",
            shopUrl: `${relUrl}2`,
            snapshot: {
              shopName: "RelKeyword 二号店",
              canonicalUrl: `${relUrl}2`,
              telegram: "",
              shopSellCount: null,
              salesVisible: false,
              depositVisible: false,
              depositMoney: null,
              items: [
                {
                  itemKey: "r-shop-hit-2",
                  rawName: "Claude Pro 月卡",
                  shopCategory: "AI",
                  price: 50,
                  stockCount: 5,
                  stockStatus: "normal",
                  itemUrl: `${relUrl}r3`,
                },
              ],
            },
          },
        ],
      }),
    });
    expect(pushRes.status).toBe(200);

    // 即使 "Claude Pro 月卡" 在 2 家店铺出现（shop_count=2），搜索 RelKeyword 时标题前缀命中的商品仍应排第一
    const searchRes = await SELF.fetch("http://localhost/api/products?q=RelKeyword");
    expect(searchRes.status).toBe(200);
    const searchData = (await searchRes.json()) as {
      items: Array<{ name: string; shopCount: number }>;
      appliedFilters: { sort: string; q: string };
    };
    expect(searchData.appliedFilters).toMatchObject({ q: "RelKeyword", sort: "relevance" });
    expect(searchData.items[0].name).toContain("RelKeyword Plus");
    expect(searchData.items[1].name).toContain("Claude Pro");

    // 显式指定 price-asc / updated-desc 时不应被 relevance 覆盖
    const priceSortData = (await (
      await SELF.fetch("http://localhost/api/products?q=RelKeyword&sort=price-asc")
    ).json()) as typeof searchData;
    expect(priceSortData.appliedFilters.sort).toBe("price-asc");
    expect(priceSortData.items[0].name).toContain("Claude Pro");

    // HTTP 端到端验证：非订阅组/非周期组与 type=api 清除失效条件并隐藏对应分面
    const relayConflict = (await (
      await SELF.fetch("http://localhost/api/products?group=中转&plan=plus&duration=month")
    ).json()) as {
      appliedFilters: Record<string, string>;
      facets: { options: { plan: Record<string, number>; duration: Record<string, number> } };
    };
    expect(relayConflict.appliedFilters).toMatchObject({ group: "中转", plan: "all", duration: "all" });
    expect(relayConflict.facets.options.plan).toEqual({});
    expect(relayConflict.facets.options.duration).toEqual({});

    const deepseekConflict = (await (
      await SELF.fetch("http://localhost/api/products?group=deepseek&plan=plus&duration=month")
    ).json()) as typeof relayConflict;
    expect(deepseekConflict.appliedFilters).toMatchObject({ group: "DeepSeek", plan: "all", duration: "month" });
    expect(deepseekConflict.facets.options.plan).toEqual({});

    const apiConflict = (await (
      await SELF.fetch("http://localhost/api/products?type=api&plan=team")
    ).json()) as typeof relayConflict;
    expect(apiConflict.appliedFilters).toMatchObject({ type: "api", plan: "all" });
    expect(apiConflict.facets.options.plan).toEqual({});

    // GET /api/shops 最大 6 词搜索 + 过滤条件 + 新排序绑定参数上限验证
    const maxShopSearch = await SELF.fetch(
      "http://localhost/api/shops?q=one+two+three+four+five+six&systemType=ldxp&onlyInStock=1&hasIntegrationCode=1&hasDescription=1&sort=products-desc&page=1",
    );
    expect(maxShopSearch.status).toBe(200);

    // 自定义价格区间：min > max 自动交换，且优先覆盖预设 price 档位、保持分面统计准确
    const customSwapQuery = normalizeProductQuery(new URLSearchParams("minPrice=80&maxPrice=40&price=under-10"));
    expect(customSwapQuery.appliedFilters.price).toBe("all");
    expect(customSwapQuery.appliedPriceRange).toEqual({ minPrice: 40, maxPrice: 80 });

    const invalidBoundsQuery = normalizeProductQuery(new URLSearchParams("minPrice=-5&maxPrice=abc&price=10-50"));
    expect(invalidBoundsQuery.appliedFilters.price).toBe("10-50");
    expect(invalidBoundsQuery.appliedPriceRange).toEqual({ minPrice: null, maxPrice: null });

    const priceRangeRes = await SELF.fetch("http://localhost/api/products?q=RelKeyword&minPrice=55&maxPrice=65&price=under-10");
    expect(priceRangeRes.status).toBe(200);
    const priceRangeData = (await priceRangeRes.json()) as {
      total: number;
      items: Array<{ name: string; minPrice: number }>;
      appliedFilters: Record<string, string>;
      appliedPriceRange: { minPrice: number | null; maxPrice: number | null };
    };
    expect(priceRangeData.appliedFilters.price).toBe("all");
    expect(priceRangeData.appliedPriceRange).toEqual({ minPrice: 55, maxPrice: 65 });
    expect(priceRangeData.total).toBe(1);
    expect(priceRangeData.items[0].minPrice).toBe(60);

    // 店铺简介搜索 + TG 过滤 + 排序验证
    const metaShopPush = await SELF.fetch("http://localhost/api/ingest", {
      method: "POST",
      headers,
      body: JSON.stringify({
        shops: [
          {
            shopId: "meta-rich-shop",
            shopUrl: "https://meta-rich.example/",
            snapshot: {
              shopName: "富简介测试站",
              canonicalUrl: "https://meta-rich.example/",
              description: "专营海外大模型API与独享会员，对接码：MetaRich2026",
              telegram: "@metarich_bot",
              shopSellCount: 9999,
              salesVisible: true,
              depositVisible: false,
              depositMoney: null,
              items: [
                {
                  itemKey: "m1",
                  rawName: "Gemini Ultra 月卡",
                  shopCategory: "AI",
                  price: 120,
                  stockCount: 3,
                  stockStatus: "normal",
                  itemUrl: "https://meta-rich.example/1",
                },
              ],
            },
          },
        ],
      }),
    });
    expect(metaShopPush.status).toBe(200);

    const shopMetaSearch = await SELF.fetch(
      "http://localhost/api/shops?q=大模型API&hasIntegrationCode=1&hasDescription=1&sort=sales-desc&page=1",
    );
    expect(shopMetaSearch.status).toBe(200);
    const shopMetaJson = (await shopMetaSearch.json()) as {
      total: number;
      appliedHasIntegrationCode: boolean;
      appliedHasDescription: boolean;
      appliedSort: string;
      shops: Array<{ id: string }>;
    };
    expect(shopMetaJson.appliedHasIntegrationCode).toBe(true);
    expect(shopMetaJson.appliedHasDescription).toBe(true);
    expect(shopMetaJson.appliedSort).toBe("default");
    expect(shopMetaJson.shops.some((s) => s.id === "meta-rich-shop")).toBe(true);
  });
});


