import { beforeAll, describe, expect, it } from "vitest";
import { setupLegacyDatabase } from "./legacyDatabase";
import { handleApiRequest } from "../src/routes/api";
import { getShopColumnCapabilities, hasShopSystemColumn } from "../src/collector/shopSystems";

let legacyEnv: Env;

beforeAll(async () => {
  legacyEnv = await setupLegacyDatabase();
  const now = "2026-11-11T00:00:00.000Z";
  await legacyEnv.DB.batch([
    legacyEnv.DB.prepare(
      "INSERT INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,product_count,product_summary_json,next_sync_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).bind(
      "legacy-ldxp",
      "旧库链动店",
      "https://pay.ldxp.cn/shop/legacy",
      "https://wzyp.cn/shop/legacy",
      "push_ingest",
      5,
      JSON.stringify([{ group: "中转", count: 3 }, { group: "ChatGPT", count: 2 }]),
      now,
      now,
    ),
    legacyEnv.DB.prepare(
      "INSERT INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,product_count,next_sync_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    ).bind("legacy-custom", "旧库独立店", "https://custom.example/", "https://custom.example/", "push_ingest", 0, now, now),
    legacyEnv.DB.prepare(
      "INSERT INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,product_count,next_sync_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    ).bind("legacy-near-host", "近似域名店", "https://wzyp.cn.evil.example/shop/a", "https://wzyp.cn.evil.example/shop/a", "manual", 0, now, now),
    legacyEnv.DB.prepare("UPDATE shops SET sync_supported = 0 WHERE id = 'legacy-near-host'"),
  ]);
});

async function get(path: string) {
  const response = await handleApiRequest(new Request(`https://local.test${path}`), legacyEnv);
  expect(response.status).toBe(200);
  return await response.json() as {
    total: number;
    totalAll: number;
    appliedSystemType: string;
    appliedOnlyInStock: boolean;
    systemTypePersistence: boolean;
    descriptionPersistence: boolean;
    createdAtPersistence: boolean;
    shops: Array<{
      id: string;
      systemType: string;
      systemTypeLabel: string;
      description?: string;
      createdAt?: string | null;
      mainCategories?: Array<{ group: string; label: string; count: number }>;
    }>;
    facets: { systemTypes: Record<string, number> };
    shop: {
      id: string;
      systemType: string;
      systemTypeLabel: string;
      description: string;
      createdAt: string | null;
      mainCategories: Array<{ group: string; label: string; count: number }>;
      productCount: number;
      shopSellCount: number | null;
      productItems?: unknown[];
      shopSignals: Record<string, unknown>;
    };
    capabilities: {
      systemTypePersistence: boolean;
      descriptionPersistence: boolean;
      createdAtPersistence: boolean;
    };
  };
}

describe("未迁移 system_type 与 description/created_at 的旧库只读路径", () => {
  it("只读检测应确认字段缺失，列表仍可返回可靠类型、主营类别与持久化能力标记", async () => {
    expect(await hasShopSystemColumn(legacyEnv.DB)).toBe(false);
    expect(await getShopColumnCapabilities(legacyEnv.DB)).toEqual({
      systemType: false,
      description: false,
      createdAt: false,
      submittedIntegrationCode: false,
    });
    const result = await get("/api/shops?page=1&pageSize=10");
    expect(result.total).toBe(3);
    expect(result.systemTypePersistence).toBe(false);
    expect(result.descriptionPersistence).toBe(false);
    expect(result.createdAtPersistence).toBe(false);
    expect(result.shops.find((shop) => shop.id === "legacy-ldxp"))
      .toMatchObject({
        systemType: "ldxp",
        systemTypeLabel: "联动小铺",
        description: "",
        createdAt: null,
        mainCategories: [
          { group: "中转", label: "中转额度", count: 3 },
          { group: "ChatGPT", label: "ChatGPT", count: 2 },
        ],
      });
    expect(result.shops.find((shop) => shop.id === "legacy-near-host")?.systemType).toBe("unknown");
  });

  it("旧库支持类型筛选、onlyInStock 筛选、非法 systemType 安全归位及中文类型搜索", async () => {
    const filtered = await get("/api/shops?page=1&systemType=ldxp");
    expect(filtered.total).toBe(1);
    expect(filtered.facets.systemTypes).toMatchObject({ ldxp: 1, unknown: 2 });
    expect(filtered.shops[0].id).toBe("legacy-ldxp");

    const inStock = await get("/api/shops?page=1&onlyInStock=1");
    expect(inStock.total).toBe(1);
    expect(inStock.totalAll).toBe(3);
    expect(inStock.appliedOnlyInStock).toBe(true);
    expect(inStock.facets.systemTypes).toMatchObject({ ldxp: 1, unknown: 0 });

    // 非法 systemType 不再返回 400，而是安全回退为 all
    const invalidSys = await get("/api/shops?page=1&systemType=bad_sys");
    expect(invalidSys.appliedSystemType).toBe("all");
    expect(invalidSys.total).toBe(3);

    const searched = await get(`/api/shops?page=1&q=${encodeURIComponent("旧库 店铺")}`);
    expect(searched.total).toBe(1);
    expect(searched.shops[0].id).toBe("legacy-ldxp");
    const unpaged = await get("/api/shops?systemType=unknown");
    expect(unpaged.shops).toHaveLength(2);
  });

  it("同步轻量清单、新店铺介绍接口与兼容详情接口均能读取缺字段旧数据且不编造字段", async () => {
    const sync = await get("/api/shops?fields=sync");
    expect(sync.systemTypePersistence).toBe(false);
    expect(sync.descriptionPersistence).toBe(false);
    expect(sync.shops).toHaveLength(2);
    expect(sync.shops.find((shop) => shop.id === "legacy-ldxp")).toMatchObject({
      systemType: "ldxp",
      description: "",
    });

    // 轻量介绍接口 GET /api/shops/:id：不返 productItems 和价格，且 createdAt/description 如实兜底
    const intro = await get("/api/shops/legacy-ldxp");
    expect(intro.capabilities).toEqual({
      systemTypePersistence: false,
      descriptionPersistence: false,
      createdAtPersistence: false,
    });
    expect(intro.shop).toMatchObject({
      id: "legacy-ldxp",
      systemType: "ldxp",
      systemTypeLabel: "联动小铺",
      description: "",
      createdAt: null,
      productCount: 5,
      shopSellCount: null,
      mainCategories: [
        { group: "中转", label: "中转额度", count: 3 },
        { group: "ChatGPT", label: "ChatGPT", count: 2 },
      ],
    });
    expect(intro.shop.productItems).toBeUndefined();
    expect("minPrice" in intro.shop.shopSignals).toBe(false);
    expect("medianPrice" in intro.shop.shopSignals).toBe(false);

    // 兼容接口 GET /api/shops/:id/products 在旧库上同样安全返回派生系统与空简介/空收录时间
    const detail = await get("/api/shops/legacy-ldxp/products");
    expect(detail.shop).toMatchObject({
      systemType: "ldxp",
      systemTypeLabel: "联动小铺",
      description: "",
      createdAt: null,
    });
    const customIntro = await get("/api/shops/legacy-custom");
    expect(customIntro.shop).toMatchObject({
      systemType: "unknown",
      systemTypeLabel: "第三方自建站（待确认）",
      mainCategories: [],
    });

    // 旧库通过 HTTP POST /api/admin/shops 传入 description（未传 systemType）应安全跳过新列而不报错
    const upsertRes = await handleApiRequest(
      new Request("https://local.test/api/admin/shops", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-ingest-secret",
        },
        body: JSON.stringify({
          shops: [
            {
              id: "legacy-admin-http",
              shopUrl: "https://legacy-admin-http.example/",
              description: "旧库应安全忽略的简介",
            },
          ],
        }),
      }),
      legacyEnv,
    );
    expect(upsertRes.status).toBe(200);
  });
});

describe("0004 已迁移但 0005 尚未迁移时的中间态只读路径", () => {
  beforeAll(async () => {
    legacyEnv = await setupLegacyDatabase(legacyEnv.DB, "0005");
  });

  it("列表、fields=sync、轻量店铺介绍与兼容详情应正确识别系统类型持久化并安全回退简介/收录时间", async () => {
    expect(await getShopColumnCapabilities(legacyEnv.DB)).toEqual({
      systemType: true,
      description: false,
      createdAt: false,
      submittedIntegrationCode: false,
    });

    const list = await get("/api/shops?page=1&pageSize=10");
    expect(list.systemTypePersistence).toBe(true);
    expect(list.descriptionPersistence).toBe(false);
    expect(list.createdAtPersistence).toBe(false);

    const sync = await get("/api/shops?fields=sync");
    expect(sync.systemTypePersistence).toBe(true);
    expect(sync.descriptionPersistence).toBe(false);

    const intro = await get("/api/shops/legacy-ldxp");
    expect(intro.capabilities).toEqual({
      systemTypePersistence: true,
      descriptionPersistence: false,
      createdAtPersistence: false,
    });
    expect(intro.shop).toMatchObject({
      id: "legacy-ldxp",
      systemType: "ldxp",
      description: "",
      createdAt: null,
    });
    expect(intro.shop.productItems).toBeUndefined();

    const detail = await get("/api/shops/legacy-ldxp/products");
    expect(detail.capabilities).toEqual({
      systemTypePersistence: true,
      descriptionPersistence: false,
      createdAtPersistence: false,
    });
    expect(detail.shop).toMatchObject({
      id: "legacy-ldxp",
      systemType: "ldxp",
      description: "",
      createdAt: null,
      mainCategories: [
        { group: "中转", label: "中转额度", count: 3 },
        { group: "ChatGPT", label: "ChatGPT", count: 2 },
      ],
    });
  });
});


