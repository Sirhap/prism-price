/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { extractTelegramFromSources, extractTelegramHandle } from "../src/collector/adapters/fetcher";
import { jsonApiAdapter } from "../src/collector/adapters/jsonApiAdapter";
import { ka123Adapter } from "../src/collector/adapters/ka123Adapter";
import { shopApiAdapter } from "../src/collector/adapters/shopApiAdapter";
import { ssrHtmlAdapter } from "../src/collector/adapters/ssrHtmlAdapter";
import { persistShopSnapshot } from "../src/collector/etl/hashAndDiff";
import { runSyncBatch, upsertAdminShops } from "../src/collector/scheduler";
import { getShopColumnCapabilities } from "../src/collector/shopSystems";
import type { RawShopSnapshot, ShopRecord } from "../src/types";
// @ts-expect-error scripts/push-sync.mjs 无独立 .d.mts 声明，通过下方类型断言约束接口
import * as pushSyncRaw from "../scripts/push-sync.mjs";

interface PushSyncExports {
  normalizeDescription(raw: unknown): string;
  extractTelegramHandle(text: string): string;
  extractTelegramFromSources(...sources: Array<string | null | undefined>): string;
  buildShopApiSnapshot(
    shop: { shopName?: string; telegram?: string },
    info: Record<string, unknown>,
    allGoods: Array<Record<string, unknown>>,
    apiOrigin: string,
    token: string,
  ): RawShopSnapshot;
  shouldSkipLocalPush(input: {
    shop: { contentHashFull?: string; syncState?: string; description?: string };
    snapshot: RawShopSnapshot;
    localHash: string;
    descriptionPersistence?: boolean;
    backfillDescription?: boolean;
  }): boolean;
}

const pushSync = pushSyncRaw as PushSyncExports;

const headers = { "Content-Type": "application/json", Authorization: "Bearer test-ingest-secret" };

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function adminUpsert(shops: unknown[]) {
  return SELF.fetch("http://localhost/api/admin/shops", { method: "POST", headers, body: JSON.stringify({ shops }) });
}

async function shop(id: string) {
  const response = await SELF.fetch(`http://localhost/api/shops/${id}/products`);
  expect(response.status).toBe(200);
  return (await response.json() as { shop: { shopName: string; adapterType: string; syncSupported: boolean; systemType: string; staleDays: number; productItems: unknown[] } }).shop;
}

/** 代理真实 D1 并记录写 SQL 语句，用于验证简介变更是否真正跳过商品与聚合表重写。 */
function trackedDatabase(database: D1Database) {
  const executedSql: string[] = [];
  const rawStatements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const statementSql = new WeakMap<D1PreparedStatement, string>();
  const wrapStatement = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, key) {
        if (key === "bind") return (...values: unknown[]) => wrapStatement(target.bind(...values), sql);
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
    rawStatements.set(wrapped, statement);
    statementSql.set(wrapped, sql);
    return wrapped;
  };
  const db = new Proxy(database, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => wrapStatement(target.prepare(sql), sql);
      if (key === "batch") return (statements: D1PreparedStatement[]) => {
        for (const stmt of statements) {
          const sql = statementSql.get(stmt);
          if (sql) executedSql.push(sql.replace(/\s+/g, " ").trim());
        }
        return target.batch(statements.map((stmt) => rawStatements.get(stmt) || stmt));
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db, executedSql };
}

describe("店铺元数据更新与无效推送保护", () => {
  it("只修改系统类型时应保留店名、采集适配器和同步开关", async () => {
    const url = "https://metadata-manual.example/";
    expect((await adminUpsert([{ id: "metadata-manual", shopName: "人工维护店名", shopUrl: url, adapterType: "manual", systemType: "unknown", staleDays: 45 }])).status).toBe(200);
    expect((await adminUpsert([{ shopUrl: url, systemType: "二次元发卡" }])).status).toBe(200);
    expect(await shop("metadata-manual")).toMatchObject({ shopName: "人工维护店名", adapterType: "manual", syncSupported: false, systemType: "acg-faka", staleDays: 45 });
    expect((await adminUpsert([{ shopUrl: url, shopName: "明确更新的店名", adapterType: "json_api" }])).status).toBe(200);
    expect(await shop("metadata-manual")).toMatchObject({ shopName: "明确更新的店名", adapterType: "json_api", syncSupported: true, systemType: "acg-faka" });
  });

  it("新建店铺未提供适配器时仍使用 push_ingest 默认值", async () => {
    expect((await adminUpsert([{ id: "metadata-default", shopUrl: "https://metadata-default.example/", systemType: "dujiaoka" }])).status).toBe(200);
    expect(await shop("metadata-default")).toMatchObject({ adapterType: "push_ingest", syncSupported: true, systemType: "dujiaoka" });
  });

  it("损坏快照不得被转换成清空指令，整个批次应在写入前验证", async () => {
    const url = "https://metadata-ingest.example/";
    const snapshot = { shopName: "推送保护店", canonicalUrl: url, telegram: "", shopSellCount: null, salesVisible: false, depositVisible: false, depositMoney: null,
      items: [{ itemKey: "item", rawName: "Codex Plus 成品号 月卡", shopCategory: "Codex", price: 20, stockCount: 10, stockStatus: "normal", itemUrl: `${url}item` }] };
    const entry = { shopId: "metadata-ingest", shopUrl: url, snapshot };
    const push = (shops: unknown[]) => SELF.fetch("http://localhost/api/ingest", { method: "POST", headers, body: JSON.stringify({ shops }) });
    expect((await push([entry])).status).toBe(200);
    expect((await shop(entry.shopId)).productItems).toHaveLength(1);
    const { items: _items, ...withoutItems } = snapshot;
    for (const malformed of [null, { ...entry, shopUrl: "not-a-url" }, { ...entry, snapshot: withoutItems }, { ...entry, snapshot: { ...snapshot, items: {} } }]) {
      // 即使前一条是合法的清空快照，后续错误也必须在入库前发现。
      expect((await push([{ ...entry, snapshot: { ...snapshot, items: [] } }, malformed])).status).toBe(400);
      expect((await shop(entry.shopId)).productItems).toHaveLength(1);
    }
    expect((await push([{ ...entry, snapshot: { ...snapshot, items: [] } }])).status).toBe(200);
    expect((await shop(entry.shopId)).productItems).toHaveLength(0);
  });
});

describe("店铺简介 Hash 解耦增量更新与收录时间不变量", () => {
  it("0005 迁移列探测正确且简介更新只触发单行 UPDATE shops，不重写 offers/product_groups", async () => {
    const caps = await getShopColumnCapabilities(env.DB);
    expect(caps).toEqual({ systemType: true, description: true, createdAt: true });

    const shopId = "desc-decoupled-shop";
    const shopUrl = "https://desc-decoupled.example/";
    const baseSnapshot: RawShopSnapshot = {
      shopName: "简介解耦测试店",
      canonicalUrl: shopUrl,
      telegram: "@desc_decoupled",
      description: "",
      shopSellCount: 15,
      salesVisible: true,
      depositVisible: false,
      depositMoney: null,
      items: [
        {
          itemKey: "d1",
          rawName: "ChatGPT Plus 成品账号 月卡",
          shopCategory: "ChatGPT",
          price: 99,
          stockCount: 5,
          stockStatus: "low",
          itemUrl: `${shopUrl}item/d1`,
        },
      ],
    };

    const push = (snap: RawShopSnapshot) =>
      SELF.fetch("http://localhost/api/ingest", {
        method: "POST",
        headers,
        body: JSON.stringify({ shops: [{ shopId, shopUrl, snapshot: snap }] }),
      });

    const first = await (await push(baseSnapshot)).json() as { updatedCount: number };
    expect(first.updatedCount).toBe(1);

    const createdRow = await env.DB.prepare("SELECT description, created_at, content_hash FROM shops WHERE id = ?")
      .bind(shopId)
      .first<{ description: string; created_at: string | null; content_hash: string }>();
    expect(createdRow?.description).toBe("");
    expect(typeof createdRow?.created_at).toBe("string");
    const originalCreatedAt = createdRow!.created_at!;

    // 仅更新 description：必须命中 Hash 跳过商品重写，且只发出 1 条 UPDATE shops
    const currentShop = await env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(shopId).first<ShopRecord>();
    expect(currentShop).not.toBeNull();
    const tracked = trackedDatabase(env.DB);
    const descOnlyRes = await persistShopSnapshot(
      tracked.db,
      currentShop!,
      { ...baseSnapshot, description: "  主营 ChatGPT / Claude\r\n售后 24 小时在线  " },
      "2026-11-12T02:00:00.000Z",
      { hasDescriptionColumn: true },
    );

    expect(descOnlyRes).toMatchObject({
      status: "unchanged",
      descriptionUpdated: true,
      estimatedWrites: 1,
    });
    expect(tracked.executedSql).toHaveLength(1);
    expect(tracked.executedSql[0]).toContain("UPDATE shops SET description = ?");
    expect(tracked.executedSql.some((s) => s.includes("offers") || s.includes("product_groups") || s.includes("shop_daily_snapshots"))).toBe(false);

    const afterDescRow = await env.DB.prepare("SELECT description, created_at FROM shops WHERE id = ?")
      .bind(shopId)
      .first<{ description: string; created_at: string | null }>();
    expect(afterDescRow).toEqual({
      description: "主营 ChatGPT / Claude\n售后 24 小时在线",
      created_at: originalCreatedAt,
    });

    // 相同内容不同换行风格或未传 description（undefined）均不应覆写或触发更新
    const shopAfterUpdate = await env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(shopId).first<ShopRecord>();
    const sameTracked = trackedDatabase(env.DB);
    const sameRes = await persistShopSnapshot(
      sameTracked.db,
      shopAfterUpdate!,
      { ...baseSnapshot, description: "主营 ChatGPT / Claude\n售后 24 小时在线" },
      "2026-11-12T02:05:00.000Z",
      { hasDescriptionColumn: true },
    );
    expect(sameRes.descriptionUpdated).toBe(false);
    expect(sameTracked.executedSql[0]).not.toContain("description = ?");

    // 商品变化但未传 description（undefined）时，原有简介必须保留，created_at 不变
    const { description: _omitted, ...snapshotWithoutDesc } = baseSnapshot;
    const priceChangedRes = await persistShopSnapshot(
      env.DB,
      shopAfterUpdate!,
      { ...snapshotWithoutDesc, items: [{ ...baseSnapshot.items[0], price: 109 }] },
      "2026-11-12T02:10:00.000Z",
      { hasDescriptionColumn: true },
    );
    expect(priceChangedRes.status).toBe("updated");
    const afterPriceRow = await env.DB.prepare("SELECT description, created_at FROM shops WHERE id = ?")
      .bind(shopId)
      .first<{ description: string; created_at: string | null }>();
    expect(afterPriceRow).toEqual({
      description: "主营 ChatGPT / Claude\n售后 24 小时在线",
      created_at: originalCreatedAt,
    });

    // 源站明确清空简介时应支持同步清空而不重写商品
    const shopBeforeClear = await env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(shopId).first<ShopRecord>();
    const clearedRes = await persistShopSnapshot(
      env.DB,
      shopBeforeClear!,
      { ...snapshotWithoutDesc, items: [{ ...baseSnapshot.items[0], price: 109 }], description: "" },
      "2026-11-12T02:15:00.000Z",
      { hasDescriptionColumn: true },
    );
    expect(clearedRes).toMatchObject({ status: "unchanged", descriptionUpdated: true });
    expect(await env.DB.prepare("SELECT description FROM shops WHERE id = ?").bind(shopId).first("description")).toBe("");

    // 若调用方传入的 ShopRecord 缺失 description 字段，但库内已有非空简介，清空时也必须如实识别并清空
    await persistShopSnapshot(
      env.DB,
      (await env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(shopId).first<ShopRecord>())!,
      { ...snapshotWithoutDesc, items: [{ ...baseSnapshot.items[0], price: 109 }], description: "待被部分对象清空的简介" },
      "2026-11-12T02:18:00.000Z",
      { hasDescriptionColumn: true },
    );
    const fullShop = (await env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(shopId).first<ShopRecord>())!;
    const { description: _dropDesc, ...partialShopWithoutDesc } = fullShop;
    const partialSameRes = await persistShopSnapshot(
      env.DB,
      partialShopWithoutDesc,
      { ...snapshotWithoutDesc, items: [{ ...baseSnapshot.items[0], price: 109 }], description: "待被部分对象清空的简介" },
      "2026-11-12T02:19:00.000Z",
      { hasDescriptionColumn: true },
    );
    expect(partialSameRes.descriptionUpdated).toBe(false);
    const partialClearRes = await persistShopSnapshot(
      env.DB,
      partialShopWithoutDesc,
      { ...snapshotWithoutDesc, items: [{ ...baseSnapshot.items[0], price: 109 }], description: "" },
      "2026-11-12T02:20:00.000Z",
      { hasDescriptionColumn: true },
    );
    expect(partialClearRes).toMatchObject({ status: "unchanged", descriptionUpdated: true });
    expect(await env.DB.prepare("SELECT description FROM shops WHERE id = ?").bind(shopId).first("description")).toBe("");
  });

  it("存量迁移行的 created_at 必须保持 NULL，新建行写入后在后续 upsert/同步中永不被覆写", async () => {
    const legacyShopId = "legacy-migrated-row";
    const legacyUrl = "https://legacy-migrated-row.example/";
    await env.DB.prepare(
      `INSERT INTO shops (id, shop_name, shop_url, canonical_url, adapter_type, next_sync_at, updated_at, created_at)
       VALUES (?, ?, ?, ?, 'push_ingest', ?, ?, NULL)`,
    )
      .bind(legacyShopId, "早期存量老店", legacyUrl, legacyUrl, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
      .run();

    // 1. 管理员更新该存量店元数据，不能伪造或填补 created_at
    await upsertAdminShops(env.DB, [
      { id: legacyShopId, shopUrl: legacyUrl, shopName: "早期存量老店-改名", description: "管理员补录简介" },
    ]);
    let row = await env.DB.prepare("SELECT created_at, description FROM shops WHERE id = ?")
      .bind(legacyShopId)
      .first<{ created_at: string | null; description: string }>();
    expect(row).toEqual({ created_at: null, description: "管理员补录简介" });

    // 2. 推送快照后依然保持 created_at 为 NULL；未传 description 时也保留原有简介
    const pushRes = await SELF.fetch("http://localhost/api/ingest", {
      method: "POST",
      headers,
      body: JSON.stringify({
        shops: [
          {
            shopId: legacyShopId,
            shopUrl: legacyUrl,
            snapshot: {
              shopName: "早期存量老店-改名",
              canonicalUrl: legacyUrl,
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
    expect(pushRes.status).toBe(200);
    row = await env.DB.prepare("SELECT created_at, description FROM shops WHERE id = ?")
      .bind(legacyShopId)
      .first<{ created_at: string | null; description: string }>();
    expect(row).toEqual({ created_at: null, description: "管理员补录简介" });

    // 3. 新建店铺通过 upsertAdminShops 创建时记录 created_at，后续重复 upsert 不修改它，不传 description 也不擦除
    const newUrl = "https://brand-new-admin.example/";
    await upsertAdminShops(env.DB, [
      { id: "brand-new-admin", shopUrl: newUrl, shopName: "全新收录店", description: "初始官方简介" },
    ]);
    const initial = await env.DB.prepare("SELECT created_at, description FROM shops WHERE id = ?")
      .bind("brand-new-admin")
      .first<{ created_at: string | null; description: string }>();
    expect(typeof initial?.created_at).toBe("string");
    expect(initial?.description).toBe("初始官方简介");

    await env.DB.prepare("UPDATE shops SET created_at = '2026-05-01T00:00:00.000Z' WHERE id = ?")
      .bind("brand-new-admin")
      .run();
    await upsertAdminShops(env.DB, [
      { shopUrl: newUrl, shopName: "全新收录店-二次更新", description: null as unknown as string },
    ]);
    const afterUpsert = await env.DB.prepare("SELECT shop_name, created_at, description FROM shops WHERE id = ?")
      .bind("brand-new-admin")
      .first<{ shop_name: string; created_at: string | null; description: string }>();
    expect(afterUpsert).toEqual({
      shop_name: "全新收录店-二次更新",
      created_at: "2026-05-01T00:00:00.000Z",
      description: "初始官方简介",
    });
  });
});

describe("适配器简介采集与 Telegram 提取缺口修复", () => {
  it("extractTelegramHandle 应正确处理子域名、/s/、tg://、邮箱与非 TG URL 排除及超长防截断", () => {
    const cases: Array<[string, string]> = [
      ["联系邮箱 support@gmail.com", ""],
      ["邮箱 help@outlook.com，TG客服 @real_support", "@real_support"],
      ["点击访问 https://myshop_kf.t.me/", "@myshop_kf"],
      ["子域名带路径 https://myshop_kf.t.me/post/123", "@myshop_kf"],
      ["子域名 telegram.dog https://myshop_dog.telegram.dog/", "@myshop_dog"],
      ["频道预览 https://t.me/s/official_chan?q=1", "@official_chan"],
      ["分享链接 https://t.me/share/url?url=x 频道 https://t.me/real_chan", "@real_chan"],
      ["特殊路径 https://t.me/addlist/abc https://t.me/boost/x https://t.me/s/share https://t.me/my_chan.com 频道 https://t.me/real_chan2", "@real_chan2"],
      ["活动价@2026元起，频道 https://t.me/real_chan3", "@real_chan3"],
      ["数字字母混合 @520ai", "@520ai"],
      ["视频主页 https://youtube.com/@fake_user 客服 https://t.me/real_chan4", "@real_chan4"],
      ["超长ID @abcdefg1234567890abcdefg1234567890abcdefg 频道 @real_chan5", "@real_chan5"],
      ["超长路径 https://t.me/abcdefg1234567890abcdefg1234567890abcdefg", ""],
      ["客户端协议 tg://resolve?domain=tg_client_kf", "@tg_client_kf"],
      ["客户端邀请 tg://join?invite=InviteCode_88", "https://t.me/+InviteCode_88"],
      ["群组 https://t.me/+InviteHash_99", "https://t.me/+InviteHash_99"],
      ["恶意伪造 https://fake.t.me.evil.com", ""],
    ];
    for (const [input, expected] of cases) {
      expect(extractTelegramHandle(input)).toBe(expected);
      expect(pushSync.extractTelegramHandle(input)).toBe(expected);
    }
    expect(extractTelegramFromSources("邮箱 a@b.com", "https://btn_tg.t.me", "@fallback")).toBe("@btn_tg");
  });

  it("shopApiAdapter 应采集 description，支持 link_buttons[].link、去重分页、子域名、联系字段 TG 与 0 商品同步", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://wzyp.cn/shopApi/Shop/info") {
        return Response.json({
          code: 1,
          data: {
            link: "https://wzyp.cn/shop/zero_stock_demo",
            nickname: "零库存补采测试店",
            description: "主营 AI 工具\r\n联系邮箱 admin@gmail.com",
            contact_qq: "",
            contact_wechat: "",
            link_buttons: [{ name: "电报频道", link: "https://zero_btn_sub.t.me/" }],
            sell_count: 88,
            deposit_money: 0,
          },
        });
      }
      if (url === "https://wzyp.cn/shopApi/Shop/goodsList") {
        return Response.json({
          code: 1,
          data: { total: 0, list: [] },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await upsertAdminShops(env.DB, [
      {
        id: "sync-shop-api-zero",
        shopName: "零库存补采测试店",
        shopUrl: "https://pay.ldxp.cn/shop/zero_stock_demo",
        canonicalUrl: "https://wzyp.cn/shop/zero_stock_demo",
        adapterType: "shop_api",
      },
    ]);

    const summary = await runSyncBatch(env, "manual", "sync-shop-api-zero");
    expect(summary.updatedCount).toBe(1);
    expect(summary.failedCount).toBe(0);
    expect(fetchMock).toHaveBeenCalled();

    const saved = await env.DB.prepare("SELECT telegram, description, product_count FROM shops WHERE id = ?")
      .bind("sync-shop-api-zero")
      .first<{ telegram: string; description: string; product_count: number }>();
    expect(saved).toEqual({
      telegram: "@zero_btn_sub",
      description: "主营 AI 工具\n联系邮箱 admin@gmail.com",
      product_count: 0,
    });

    // 验证联系字段回退提取、分页重复 goods_key 去重以及空白 nickname/link 兜底
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          code: 1,
          data: {
            nickname: "   ",
            link: "  ",
            description: "",
            link_buttons: [],
            contact_qq: "123456789",
            contact_wechat: "微信同号 / TG: @wechat_field_tg",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 1,
          data: {
            total: 101,
            list: Array.from({ length: 100 }, (_, i) => ({
              goods_key: `g-${i}`,
              name: `商品 ${i}`,
              price: 10,
              extend: { stock_count: 5 },
            })),
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 1,
          data: {
            total: 101,
            list: [
              { goods_key: "g-99", name: "重复分页商品", price: 10, extend: { stock_count: 5 } },
              { goods_key: "g-100", name: "商品 100", price: 10, extend: { stock_count: 5 } },
            ],
          },
        }),
      );

    const contactSnap = await shopApiAdapter.fetchSnapshot(
      {
        id: "tmp",
        shop_name: "默认店名兜底",
        shop_url: "https://catfk.com/shop/contact_demo",
        canonical_url: "https://catfk.com/shop/contact_demo",
        adapter_type: "shop_api",
        system_type: "unknown",
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
    expect(contactSnap.shopName).toBe("默认店名兜底");
    expect(contactSnap.canonicalUrl).toBe("https://catfk.com/shop/contact_demo");
    expect(contactSnap.telegram).toBe("@wechat_field_tg");
    expect(contactSnap.description).toBe("");
    expect(contactSnap.items).toHaveLength(101);
  });

  it("jsonApiAdapter、ssrHtmlAdapter 与 ka123Adapter 应正确处理 description、空值回退与换行", async () => {
    const dummyShop = (shopUrl: string): ShopRecord => ({
      id: "dummy",
      shop_name: "占位店",
      shop_url: shopUrl,
      canonical_url: shopUrl,
      adapter_type: "json_api",
      system_type: "unknown",
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
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          shop: {
            name: "",
            shopName: "JSON 简介店",
            canonicalUrl: "https://json-desc.example/",
            description: "   ",
            notice: "  JSON 公告回退\r\n第二行  ",
            telegram: "admin@gmail.com",
          },
          products: [],
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          `<html><body>
            <h1 class="shop-title">SSR 简介店</h1>
            <div class="shop-notice">售后联系 @ssr_desc_tg</div>
            <div class="shop-description">SSR 第一行<br>SSR 第二行</div>
          </body></html>`,
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          `<html><body>
            <h1 class="shop-title">SSR 空白简介回退店</h1>
            <div class="shop-notice">公告回退内容 @ssr_notice_tg</div>
            <div class="shop-description">   </div>
          </body></html>`,
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
      )
      .mockResolvedValueOnce(Response.json({ ok: true, data: { products: [] } }));

    const jsonSnap = await jsonApiAdapter.fetchSnapshot(dummyShop("https://json-desc.example/products.json"), env);
    expect(jsonSnap.shopName).toBe("JSON 简介店");
    expect(jsonSnap.description).toBe("JSON 公告回退\n第二行");
    expect(jsonSnap.telegram).toBe("");

    const ssrSnap = await ssrHtmlAdapter.fetchSnapshot(dummyShop("https://ssr-desc.example/shop"), env);
    expect(ssrSnap.description).toBe("SSR 第一行\nSSR 第二行");
    expect(ssrSnap.telegram).toBe("@ssr_desc_tg");

    const ssrFallbackSnap = await ssrHtmlAdapter.fetchSnapshot(dummyShop("https://ssr-fallback.example/shop"), env);
    expect(ssrFallbackSnap.description).toBe("公告回退内容 @ssr_notice_tg");

    const kaSnap = await ka123Adapter.fetchSnapshot(dummyShop("https://ka123.plus/"), env);
    expect(kaSnap.description).toBe("");
  });
});

describe("push-sync 脚本简介回填（含 0 商品店铺）与 Telegram 提取", () => {
  it("buildShopApiSnapshot 应在 0 商品时保留简介并从 link_buttons[].link、子域名和联系字段提取 TG", () => {
    const snap1 = pushSync.buildShopApiSnapshot(
      { shopName: "空库存店", telegram: "" },
      {
        nickname: "空库存测试",
        link: "https://wzyp.cn/shop/empty1",
        description: "本店暂未补货\r\n邮箱 foo@gmail.com",
        link_buttons: [{ name: "官方频道", link: "https://empty_chan.t.me/" }],
      },
      [],
      "https://wzyp.cn",
      "empty1",
    );
    expect(snap1.items).toEqual([]);
    expect(snap1.description).toBe("本店暂未补货\n邮箱 foo@gmail.com");
    expect(snap1.telegram).toBe("@empty_chan");

    const snap2 = pushSync.buildShopApiSnapshot(
      { shopName: "联系栏店", telegram: "" },
      {
        description: "",
        link_buttons: [],
        contact_qq: "https://t.me/qq_support",
        contact_wechat: "wx123",
      },
      [],
      "https://catfk.com",
      "contact1",
    );
    expect(snap2.telegram).toBe("@qq_support");
  });

  it("shouldSkipLocalPush 应在 0 在售商品且简介待回填或变化时不跳过，已同步或未迁移时安全跳过", () => {
    const emptyItemsSnap: RawShopSnapshot = {
      shopName: "空商品店",
      canonicalUrl: "https://wzyp.cn/shop/empty",
      telegram: "@empty_tg",
      description: "停业公告：老用户联系 TG",
      shopSellCount: 10,
      salesVisible: true,
      depositVisible: false,
      depositMoney: null,
      items: [],
    };
    const hash = "same-hash";

    // 1. 已迁移（descriptionPersistence: true），服务端为空简介（或 null），即使 0 商品且 Hash 一致也不应跳过
    expect(
      pushSync.shouldSkipLocalPush({
        shop: { contentHashFull: hash, syncState: "ready", description: "" },
        snapshot: emptyItemsSnap,
        localHash: hash,
        descriptionPersistence: true,
      }),
    ).toBe(false);
    expect(
      pushSync.shouldSkipLocalPush({
        shop: { contentHashFull: hash, syncState: "ready", description: null as unknown as string },
        snapshot: emptyItemsSnap,
        localHash: hash,
        descriptionPersistence: true,
      }),
    ).toBe(false);

    // 2. 服务端简介已一致时，本地跳过
    expect(
      pushSync.shouldSkipLocalPush({
        shop: { contentHashFull: hash, syncState: "ready", description: "停业公告：老用户联系 TG" },
        snapshot: emptyItemsSnap,
        localHash: hash,
        descriptionPersistence: true,
      }),
    ).toBe(true);

    // 3. 源站清空简介时，不应跳过，需推去同步清空
    expect(
      pushSync.shouldSkipLocalPush({
        shop: { contentHashFull: hash, syncState: "ready", description: "停业公告：老用户联系 TG" },
        snapshot: { ...emptyItemsSnap, description: "" },
        localHash: hash,
        descriptionPersistence: true,
      }),
    ).toBe(false);

    // 4. 远端尚未迁移 0005（descriptionPersistence === false）时跳过，避免浪费 D1 写配额
    expect(
      pushSync.shouldSkipLocalPush({
        shop: { contentHashFull: hash, syncState: "ready" },
        snapshot: emptyItemsSnap,
        localHash: hash,
        descriptionPersistence: false,
      }),
    ).toBe(true);

    // 5. 旧版 fields=sync 尚未下发 shop.description 时，仅在显式开启 backfillDescription 且本地非空时推
    expect(
      pushSync.shouldSkipLocalPush({
        shop: { contentHashFull: hash, syncState: "ready" },
        snapshot: emptyItemsSnap,
        localHash: hash,
        backfillDescription: false,
      }),
    ).toBe(true);
    expect(
      pushSync.shouldSkipLocalPush({
        shop: { contentHashFull: hash, syncState: "ready" },
        snapshot: emptyItemsSnap,
        localHash: hash,
        backfillDescription: true,
      }),
    ).toBe(false);
  });
});
