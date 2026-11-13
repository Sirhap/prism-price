/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from "cloudflare:test";
import { getShopColumnCapabilities, shopReadSource } from "../src/collector/shopSystems";
import { ingestPushedSnapshots, runSyncBatch, upsertAdminShops } from "../src/collector/scheduler";
import type { RawShopSnapshot } from "../src/types";
import { handleApiRequest } from "../src/routes/api";
import { setupLegacyDatabase } from "./legacyDatabase";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const headers = { "Content-Type": "application/json", Authorization: "Bearer test-ingest-secret" };

let legacyEnv: Env;
beforeAll(async () => {
  legacyEnv = await setupLegacyDatabase(env.LEGACY_WRITE_DB);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const snapshot: RawShopSnapshot = {
  shopName: "旧表推送店", canonicalUrl: "https://legacy-push.example/", telegram: "", shopSellCount: null,
  salesVisible: false, depositVisible: false, depositMoney: null,
  items: [{ itemKey: "1", rawName: "Codex Plus 成品月卡", shopCategory: "Codex", price: 25, stockCount: 10, stockStatus: "normal", itemUrl: "https://legacy-push.example/item" }],
};

function post(path: string, shops: unknown[]) {
  return handleApiRequest(new Request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify({ shops }) }), legacyEnv);
}

async function assertPending(response: Response) {
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "SHOP_SYSTEM_MIGRATION_PENDING" });
}

describe("系统类型迁移前的旧表写路径兼容", () => {
  it("明确系统类型的整批写入返回503，不能先写入普通条目或种子", async () => {
    expect(await legacyEnv.DB.prepare("SELECT COUNT(*) AS count FROM shops").first("count")).toBe(0);
    await assertPending(await post("/api/admin/shops", [
      { id: "legacy-block-normal", shopUrl: "https://legacy-block-normal.example/" },
      { id: "legacy-block-system", shopUrl: "https://legacy-block-system.example/", systemType: "acg-faka" },
    ]));
    await assertPending(await post("/api/ingest", [
      { shopId: "legacy-block-normal", shopUrl: "https://legacy-block-normal.example/", snapshot },
      { shopId: "legacy-block-system", shopUrl: "https://legacy-block-system.example/", snapshot, systemType: "ldxp" },
    ]));
    expect(await legacyEnv.DB.prepare("SELECT COUNT(*) AS count FROM shops").first("count")).toBe(0);
    expect(await legacyEnv.DB.prepare("SELECT COUNT(*) AS count FROM offers").first("count")).toBe(0);
  });

  it("未提供系统类型的常规导入继续写入旧表，并保留已有适配器", async () => {
    expect((await post("/api/admin/shops", [{ id: "legacy-manual", shopName: "旧表人工维护", shopUrl: "https://legacy-manual.example/", adapterType: "manual" }])).status).toBe(200);
    expect((await post("/api/admin/shops", [{ shopUrl: "https://legacy-manual.example/" }])).status).toBe(200);
    const row = await legacyEnv.DB.prepare("SELECT shop_name, adapter_type, sync_supported FROM shops WHERE id=?").bind("legacy-manual").first();
    expect(row).toMatchObject({ shop_name: "旧表人工维护", adapter_type: "manual", sync_supported: 0 });
    const count = await legacyEnv.DB.prepare("SELECT COUNT(*) AS count FROM shops").first("count");
    expect(count).toBe(6);
  });

  it("普通推送可新建、重采集与命中Hash，无需新列", async () => {
    const entry = { shopId: "legacy-push", shopUrl: "https://legacy-push.example/", snapshot };
    const first = await post("/api/ingest", [entry]);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ updatedCount: 1 });
    const repeat = await post("/api/ingest", [entry]);
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ skippedUnchanged: 1 });
    expect(await legacyEnv.DB.prepare("SELECT COUNT(*) AS count FROM offers WHERE shop_id=?").bind("legacy-push").first("count")).toBe(1);
    expect(await legacyEnv.DB.prepare("SELECT COUNT(*) AS count FROM product_groups").first("count")).toBe(1);
    const bad = await post("/api/ingest", [{ ...entry, snapshot: { ...snapshot, items: {} } }]);
    expect(bad.status).toBe(400);
    expect(await legacyEnv.DB.prepare("SELECT COUNT(*) AS count FROM offers WHERE shop_id=?").bind("legacy-push").first("count")).toBe(1);
  });

  it("0004 与 0005 均未迁移时，携带 description 的推送、导入与 runSyncBatch 应安全忽略新列而不报错", async () => {
    const caps = await getShopColumnCapabilities(legacyEnv.DB);
    expect(caps).toEqual({ systemType: false, description: false, createdAt: false });

    const withDesc = {
      shopId: "legacy-with-desc",
      shopUrl: "https://legacy-with-desc.example/",
      snapshot: { ...snapshot, canonicalUrl: "https://legacy-with-desc.example/", description: "旧库待忽略的简介\n第二行" },
    };
    const res1 = await post("/api/ingest", [withDesc]);
    expect(res1.status).toBe(200);
    expect(await res1.json()).toMatchObject({ updatedCount: 1 });

    // 即使简介变化且未迁移 0005，也应安全命中 Hash 跳过且不报错
    const res2 = await post("/api/ingest", [
      { ...withDesc, snapshot: { ...withDesc.snapshot, description: "修改后的简介" } },
    ]);
    expect(res2.status).toBe(200);
    expect(await res2.json()).toMatchObject({ skippedUnchanged: 1 });

    await expect(
      upsertAdminShops(legacyEnv.DB, [
        { id: "legacy-admin-desc", shopUrl: "https://legacy-admin-desc.example/", description: "管理导入简介" },
        { id: "legacy-sync-json", shopUrl: "https://legacy-sync-json.example/products.json", adapterType: "json_api" },
      ]),
    ).resolves.toEqual({ upserted: 2 });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        shop: { shopName: "旧库直采店", description: "待忽略直采简介", telegram: "@legacy_sync_tg" },
        products: [],
      }),
    );
    const syncSummary = await runSyncBatch(legacyEnv, "manual", "legacy-sync-json");
    expect(syncSummary).toMatchObject({ updatedCount: 1, failedCount: 0 });

    const row = await legacyEnv.DB.prepare(`SELECT id, system_type, description, created_at FROM ${shopReadSource(caps)} WHERE id = ?`)
      .bind("legacy-with-desc")
      .first();
    expect(row).toEqual({ id: "legacy-with-desc", system_type: "unknown", description: "", created_at: null });
  });
});

describe("0004 已迁移但 0005 尚未迁移时的中间态写路径兼容", () => {
  beforeAll(async () => {
    legacyEnv = await setupLegacyDatabase(legacyEnv.DB, "0005");
  });

  it("应正确写入 system_type，同时优雅跳过缺失的 description 与 created_at（含 runSyncBatch）", async () => {
    const caps = await getShopColumnCapabilities(legacyEnv.DB);
    expect(caps).toEqual({ systemType: true, description: false, createdAt: false });

    await expect(
      upsertAdminShops(legacyEnv.DB, [
        {
          id: "mid-admin-shop",
          shopName: "中间态管理店",
          shopUrl: "https://mid-admin.example/",
          systemType: "acg-faka",
          description: "待忽略的简介",
        },
        {
          id: "mid-sync-json",
          shopName: "中间态直采店",
          shopUrl: "https://mid-sync.example/products.json",
          adapterType: "json_api",
          systemType: "other",
        },
      ]),
    ).resolves.toEqual({ upserted: 2 });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        shop: { shopName: "中间态直采店", description: "应被跳过写入的简介" },
        products: [],
      }),
    );
    const syncSummary = await runSyncBatch(legacyEnv, "manual", "mid-sync-json");
    expect(syncSummary).toMatchObject({ updatedCount: 1, failedCount: 0 });

    const ingestSummary = await ingestPushedSnapshots(legacyEnv, [
      {
        shopId: "mid-push-shop",
        shopUrl: "https://mid-push.example/",
        systemType: "dujiaoka",
        snapshot: {
          ...snapshot,
          shopName: "中间态推送店",
          canonicalUrl: "https://mid-push.example/",
          description: "推送携带的简介",
        },
      },
    ]);
    expect(ingestSummary.updatedCount).toBe(1);

    const row = await legacyEnv.DB.prepare(`SELECT id, system_type, description, created_at FROM ${shopReadSource(caps)} WHERE id = ?`)
      .bind("mid-push-shop")
      .first();
    expect(row).toEqual({ id: "mid-push-shop", system_type: "dujiaoka", description: "", created_at: null });
  });
});
