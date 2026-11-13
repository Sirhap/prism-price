import {
  getShopColumnCapabilities,
  inferShopSystem,
  persistedShopSystem,
  type ShopColumnCapabilities,
  type ShopSystemType,
} from "./shopSystems";
import type { AdapterType, RawShopSnapshot, ShopRecord, SyncRunSummary, SyncShopOutcome } from "../types";
import { resolveAdapter } from "./adapters";
import { normalizeDescription } from "./adapters/fetcher";
import { clearShopOffers, persistShopSnapshot, rebuildProductGroups } from "./etl/hashAndDiff";
import { INITIAL_SHOPS } from "./seedShops";

const TERMINAL_ERROR_KEYWORDS = ["已被封禁", "已封禁", "已注销", "店铺链接不存在", "店铺不存在"] as const;

function isTerminalShopError(errorMessage: string): boolean {
  return TERMINAL_ERROR_KEYWORDS.some((keyword) => errorMessage.includes(keyword));
}

/**
 * 首次运行冷启动时写入默认收录的店铺列表
 */
export async function ensureSeedShops(
  db: D1Database,
  knownColumns?: boolean | ShopColumnCapabilities,
): Promise<void> {
  const row = await db.prepare("SELECT 1 AS cnt FROM shops LIMIT 1").first<{ cnt: number }>();
  if (row && row.cnt > 0) {
    return;
  }

  const cols: ShopColumnCapabilities =
    typeof knownColumns === "object" && knownColumns !== null
      ? knownColumns
      : await getShopColumnCapabilities(db);
  const now = new Date().toISOString();
  const stmts = INITIAL_SHOPS.map((seed, index) => {
    const syncState = !seed.syncSupported
      ? "manual"
      : seed.adapterType === "push_ingest"
        ? "pending"
        : "pending";
    const nextSyncAt = new Date(Date.now() - (INITIAL_SHOPS.length - index) * 1000).toISOString();
    const extraCols = [
      ...(cols.systemType ? ["system_type"] : []),
      ...(cols.createdAt ? ["created_at"] : []),
    ];
    const extraSql = extraCols.length ? `, ${extraCols.join(", ")}` : "";
    const extraPlaceholders = extraCols.map(() => ", ?").join("");

    return db
      .prepare(
        `INSERT OR IGNORE INTO shops (
          id, shop_name, shop_url, canonical_url, adapter_type, sync_supported, sync_state,
          next_sync_at, updated_at${extraSql}
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${extraPlaceholders})`,
      )
      .bind(
        seed.id,
        seed.shopName,
        seed.shopUrl,
        seed.canonicalUrl,
        seed.adapterType,
        seed.syncSupported ? 1 : 0,
        syncState,
        nextSyncAt,
        now,
        ...(cols.systemType ? [persistedShopSystem(inferShopSystem(seed.shopUrl, seed.canonicalUrl))] : []),
        ...(cols.createdAt ? [now] : []),
      );
  });

  await db.batch(stmts);
}

/**
 * 计算指数退避下一次重试时间（15 分钟 -> 1 小时 -> 4 小时 -> 12 小时）
 */
function calculateBackoffMs(failures: number): number {
  const schedule = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000, 12 * 60 * 60_000];
  const index = Math.min(Math.max(0, failures - 1), schedule.length - 1);
  return schedule[index];
}

/**
 * 根据 last_synced_at 计算长期未更新天数
 */
export function computeStaleDays(lastSyncedAt: string | null, fallbackDays = 0): number {
  if (!lastSyncedAt) {
    return fallbackDays;
  }
  const parsed = Date.parse(lastSyncedAt);
  if (!Number.isFinite(parsed)) {
    return fallbackDays;
  }
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

/**
 * 执行一轮云端切片轮询同步（跳过 manual 与 push_ingest，专为 Cloudflare Workers Free 设计）
 */
export async function runSyncBatch(
  env: Env,
  triggerSource: "cron" | "manual",
  targetShopId?: string,
): Promise<SyncRunSummary> {
  const startedAt = Date.now();
  const cols = await getShopColumnCapabilities(env.DB);
  await ensureSeedShops(env.DB, cols);

  const batchSize = Math.min(Math.max(Number(env.SYNC_BATCH_SIZE) || 3, 1), 10);
  const nowIso = new Date().toISOString();

  const shopsQuery = targetShopId
    ? env.DB.prepare("SELECT * FROM shops WHERE id = ? LIMIT 1").bind(targetShopId)
    : env.DB.prepare(
        `SELECT * FROM shops
         WHERE sync_supported = 1
           AND adapter_type NOT IN ('manual', 'push_ingest')
           AND next_sync_at <= ?
         ORDER BY next_sync_at ASC
         LIMIT ?`,
      ).bind(nowIso, batchSize);

  const { results: dueShops } = await shopsQuery.all<ShopRecord>();
  const targets = dueShops || [];

  const outcomes: SyncShopOutcome[] = [];
  let skippedUnchanged = 0;
  let updatedCount = 0;
  let failedCount = 0;
  let totalWrites = 0;

  for (const shop of targets) {
    const shopStart = Date.now();
    const adapter = resolveAdapter(shop.adapter_type);
    if (!adapter) {
      outcomes.push({
        shopId: shop.id,
        shopName: shop.shop_name,
        adapterType: shop.adapter_type,
        status: "skipped",
        itemCount: 0,
        estimatedWrites: 0,
        durationMs: Date.now() - shopStart,
      });
      continue;
    }

    try {
      const snapshot = await adapter.fetchSnapshot(shop, env);
      const res = await persistShopSnapshot(env.DB, shop, snapshot, nowIso, {
        hasDescriptionColumn: cols.description,
      });

      if (res.status === "unchanged") {
        skippedUnchanged += 1;
      } else {
        updatedCount += 1;
      }
      totalWrites += res.estimatedWrites;

      outcomes.push({
        shopId: shop.id,
        shopName: snapshot.shopName,
        adapterType: shop.adapter_type,
        status: res.status,
        itemCount: res.itemCount,
        estimatedWrites: res.estimatedWrites,
        durationMs: Date.now() - shopStart,
        contentHash: res.contentHash.slice(0, 12),
        ...(res.descriptionUpdated ? { descriptionUpdated: true } : {}),
      });
    } catch (err) {
      failedCount += 1;
      const errMsg = err instanceof Error ? err.message : String(err);
      const nextFailures = (shop.consecutive_failures || 0) + 1;
      const backoffMs = calculateBackoffMs(nextFailures);
      const nextRetry = new Date(Date.now() + backoffMs).toISOString();
      const staleDays = computeStaleDays(shop.last_synced_at, shop.stale_days);

      await env.DB.prepare(
        `UPDATE shops
         SET consecutive_failures = ?, last_error = ?, next_sync_at = ?, stale_days = ?, sync_state = 'error'
         WHERE id = ?`,
      )
        .bind(nextFailures, errMsg.slice(0, 300), nextRetry, staleDays, shop.id)
        .run();

      const clearedWrites = isTerminalShopError(errMsg) ? await clearShopOffers(env.DB, shop.id, nowIso) : 0;
      totalWrites += 1 + clearedWrites;
      outcomes.push({
        shopId: shop.id,
        shopName: shop.shop_name,
        adapterType: shop.adapter_type,
        status: "failed",
        itemCount: 0,
        estimatedWrites: 1 + clearedWrites,
        durationMs: Date.now() - shopStart,
        error: errMsg,
      });
    }
  }

  const runId = crypto.randomUUID();
  const durationMs = Date.now() - startedAt;

  await env.DB.prepare(
    `INSERT INTO sync_runs (
      id, trigger_source, processed_count, skipped_unchanged, updated_count, failed_count,
      estimated_d1_writes, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      runId,
      triggerSource,
      targets.length,
      skippedUnchanged,
      updatedCount,
      failedCount,
      totalWrites + 1,
      JSON.stringify(outcomes),
      nowIso,
    )
    .run();

  const summary: SyncRunSummary = {
    runId,
    triggerSource,
    processedCount: targets.length,
    skippedUnchanged,
    updatedCount,
    failedCount,
    estimatedD1Writes: totalWrites + 1,
    durationMs,
    outcomes,
  };

  console.log(JSON.stringify({ event: "sync_batch_completed", ...summary }));
  return summary;
}

export interface PushedShopEntry {
  /** 发卡系统标签，不改变该店铺的采集适配器。 */
  systemType?: ShopSystemType;
  shopId: string;
  shopUrl: string;
  snapshot?: RawShopSnapshot;
  error?: string;
}

/**
 * 接收外部采集脚本推送的店铺快照（支持多店小批切片入库 + SHA-256 增量过滤）
 */
export async function ingestPushedSnapshots(
  env: Env,
  entries: PushedShopEntry[],
): Promise<SyncRunSummary> {
  const startedAt = Date.now();
  const cols = await getShopColumnCapabilities(env.DB);
  await ensureSeedShops(env.DB, cols);
  const nowIso = new Date().toISOString();

  const outcomes: SyncShopOutcome[] = [];
  let skippedUnchanged = 0;
  let updatedCount = 0;
  let failedCount = 0;
  let totalWrites = 0;

  for (const entry of entries) {
    const shopStart = Date.now();
    const shopId = String(entry.shopId || "").trim();
    const shopUrl = String(entry.shopUrl || "").trim();
    if (!shopId || !shopUrl) {
      continue;
    }

    let shop = await env.DB.prepare("SELECT * FROM shops WHERE id = ? LIMIT 1")
      .bind(shopId)
      .first<ShopRecord>();

    if (!shop) {
      const initialName = entry.snapshot?.shopName || new URL(shopUrl).hostname;
      const canonical = entry.snapshot?.canonicalUrl || shopUrl;
      const initialDescription = normalizeDescription(entry.snapshot?.description);
      const extraCols = [
        ...(cols.systemType ? ["system_type"] : []),
        ...(cols.description ? ["description"] : []),
        ...(cols.createdAt ? ["created_at"] : []),
      ];
      const extraSql = extraCols.length ? `, ${extraCols.join(", ")}` : "";
      const extraPlaceholders = extraCols.map(() => ", ?").join("");

      await env.DB.prepare(
        `INSERT INTO shops (
          id, shop_name, shop_url, canonical_url, adapter_type, sync_supported, sync_state,
          next_sync_at, updated_at${extraSql}
        ) VALUES (?, ?, ?, ?, 'push_ingest', 1, 'pending', ?, ?${extraPlaceholders})`,
      )
        .bind(
          shopId,
          initialName,
          shopUrl,
          canonical,
          nowIso,
          nowIso,
          ...(cols.systemType ? [persistedShopSystem(entry.systemType ?? inferShopSystem(shopUrl, canonical))] : []),
          ...(cols.description ? [initialDescription] : []),
          ...(cols.createdAt ? [nowIso] : []),
        )
        .run();

      shop = await env.DB.prepare("SELECT * FROM shops WHERE id = ? LIMIT 1")
        .bind(shopId)
        .first<ShopRecord>();
      totalWrites += 1;
    }

    if (!shop) {
      continue;
    }

    if (cols.systemType) {
      const systemType = persistedShopSystem(entry.systemType ?? (shop.system_type === "unknown" ? inferShopSystem(shopUrl, shop.canonical_url) : shop.system_type));
      if (systemType && systemType !== shop.system_type) {
        await env.DB.prepare("UPDATE shops SET system_type = ? WHERE id = ?").bind(systemType, shop.id).run();
        shop.system_type = systemType;
        totalWrites += 1;
      }
    }

    if (entry.error) {
      failedCount += 1;
      const nextFailures = (shop.consecutive_failures || 0) + 1;
      const staleDays = computeStaleDays(shop.last_synced_at, shop.stale_days);

      await env.DB.prepare(
        `UPDATE shops
         SET consecutive_failures = ?, last_error = ?, stale_days = ?, sync_state = 'error', adapter_type = 'push_ingest'
         WHERE id = ?`,
      )
        .bind(nextFailures, entry.error.slice(0, 300), staleDays, shop.id)
        .run();

      const terminal = isTerminalShopError(entry.error);
      const clearedWrites = terminal ? await clearShopOffers(env.DB, shop.id, nowIso) : 0;
      totalWrites += 1 + clearedWrites;
      outcomes.push({
        shopId: shop.id,
        shopName: shop.shop_name,
        adapterType: "push_ingest",
        status: "failed",
        itemCount: 0,
        estimatedWrites: 1 + clearedWrites,
        durationMs: Date.now() - shopStart,
        error: entry.error,
      });
      continue;
    }

    if (!entry.snapshot) {
      continue;
    }

    const res = await persistShopSnapshot(env.DB, shop, entry.snapshot, nowIso, {
      hasDescriptionColumn: cols.description,
      minUnchangedIntervalMs: 12 * 60 * 60 * 1000,
    });
    const activeAdapter = shop.adapter_type === "manual" || shop.adapter_type === "ka123_api"
      ? shop.adapter_type
      : "push_ingest";
    if (shop.adapter_type !== activeAdapter) {
      await env.DB.prepare("UPDATE shops SET adapter_type = ? WHERE id = ?")
        .bind(activeAdapter, shop.id)
        .run();
      totalWrites += 1;
    }

    if (res.status === "unchanged") {
      skippedUnchanged += 1;
    } else {
      updatedCount += 1;
    }
    totalWrites += res.estimatedWrites;

    outcomes.push({
      shopId: shop.id,
      shopName: entry.snapshot.shopName,
      adapterType: "push_ingest",
      status: res.status,
      itemCount: res.itemCount,
      estimatedWrites: res.estimatedWrites,
      durationMs: Date.now() - shopStart,
      contentHash: res.contentHash.slice(0, 12),
      ...(res.descriptionUpdated ? { descriptionUpdated: true } : {}),
    });
  }

  const runId = crypto.randomUUID();
  const durationMs = Date.now() - startedAt;

  await env.DB.prepare(
    `INSERT INTO sync_runs (
      id, trigger_source, processed_count, skipped_unchanged, updated_count, failed_count,
      estimated_d1_writes, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      runId,
      "push",
      outcomes.length,
      skippedUnchanged,
      updatedCount,
      failedCount,
      totalWrites + 1,
      JSON.stringify(outcomes),
      nowIso,
    )
    .run();

  const summary: SyncRunSummary = {
    runId,
    triggerSource: "push",
    processedCount: outcomes.length,
    skippedUnchanged,
    updatedCount,
    failedCount,
    estimatedD1Writes: totalWrites + 1,
    durationMs,
    outcomes,
  };

  console.log(JSON.stringify({ event: "push_ingest_completed", ...summary }));
  return summary;
}

export interface AdminShopInput {
  id?: string;
  shopName?: string;
  shopUrl: string;
  canonicalUrl?: string;
  adapterType?: AdapterType;
  systemType?: ShopSystemType;
  description?: string;
  telegram?: string;
  shopSellCount?: number | null;
  staleDays?: number;
  lastSyncedAt?: string | null;
  productSummary?: Array<{ name: string; price: number }>;
}

/**
 * 批量注册或更新正式收录店铺配置（仅限管理员接口调用）
 */
export async function upsertAdminShops(
  db: D1Database,
  entries: AdminShopInput[],
): Promise<{ upserted: number }> {
  const cols = await getShopColumnCapabilities(db);
  await ensureSeedShops(db, cols);
  const nowIso = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];

  for (const item of entries) {
    const rawUrl = String(item.shopUrl || "").trim();
    if (!rawUrl) continue;
    const parsed = new URL(rawUrl);
    const id = String(item.id || `shop-${crypto.randomUUID().slice(0, 8)}`).trim();
    const shopName = String(item.shopName || parsed.hostname).trim();
    const canonicalUrl = String(item.canonicalUrl || rawUrl).trim();
    const adapterType: AdapterType = item.adapterType || "push_ingest";
    const syncSupported = adapterType !== "manual" ? 1 : 0;
    const syncState = adapterType === "manual" ? "manual" : "pending";
    const hasExplicitDescription = typeof item.description === "string";
    const description = hasExplicitDescription ? normalizeDescription(item.description) : "";
    const telegram = String(item.telegram || "").trim();
    const sellCount = typeof item.shopSellCount === "number" && Number.isFinite(item.shopSellCount) ? item.shopSellCount : null;
    const staleDays = typeof item.staleDays === "number" && Number.isFinite(item.staleDays) ? Math.max(0, Math.floor(item.staleDays)) : 0;
    const lastSyncedAt = item.lastSyncedAt ?? null;
    const summaryArr = Array.isArray(item.productSummary) ? item.productSummary.slice(0, 6) : [];
    const summaryJson = JSON.stringify(summaryArr);
    const productCount = summaryArr.length;

    const extraCols = [
      ...(cols.systemType ? ["system_type"] : []),
      ...(cols.description ? ["description"] : []),
      ...(cols.createdAt ? ["created_at"] : []),
    ];
    const extraSql = extraCols.length ? `, ${extraCols.join(", ")}` : "";
    const extraPlaceholders = extraCols.map(() => ", ?").join("");

    // 显式编号复用配置标志：WHERE 与 SET 比较相同的有效值，重复导入不维护索引或更新时间。
    let flag = 17 + extraCols.length;
    const updates: Array<[string, string]> = [
      ["shop_name", `CASE WHEN ?${flag++} = 1 THEN excluded.shop_name ELSE shops.shop_name END`],
      ["shop_url", "excluded.shop_url"],
      ["adapter_type", `CASE WHEN ?${flag++} = 1 THEN excluded.adapter_type ELSE shops.adapter_type END`],
      ...(cols.systemType ? [["system_type", `CASE WHEN ?${flag++} = 1 OR shops.system_type = 'unknown' THEN excluded.system_type ELSE shops.system_type END`] as [string, string]] : []),
      ...(cols.description ? [["description", `CASE WHEN ?${flag++} = 1 THEN excluded.description ELSE shops.description END`] as [string, string]] : []),
      ["telegram", "CASE WHEN excluded.telegram != '' THEN excluded.telegram ELSE shops.telegram END"],
      ["sync_supported", `CASE WHEN ?${flag++} = 1 THEN excluded.sync_supported ELSE shops.sync_supported END`],
      ["stale_days", `CASE WHEN ?${flag++} = 1 AND shops.last_synced_at IS NULL THEN excluded.stale_days ELSE shops.stale_days END`],
      ["shop_sell_count", "CASE WHEN excluded.shop_sell_count IS NOT NULL THEN excluded.shop_sell_count ELSE shops.shop_sell_count END"],
      ["sales_visible", "CASE WHEN excluded.shop_sell_count IS NOT NULL THEN 1 ELSE shops.sales_visible END"],
      ["product_summary_json", "CASE WHEN shops.last_synced_at IS NULL AND excluded.product_count > 0 THEN excluded.product_summary_json ELSE shops.product_summary_json END"],
      ["product_count", "CASE WHEN shops.last_synced_at IS NULL AND excluded.product_count > 0 THEN excluded.product_count ELSE shops.product_count END"],
    ];

    // 注意：created_at 仅在首次 INSERT 时写入，ON CONFLICT DO UPDATE 绝不覆盖既有收录时间
    stmts.push(
      db
        .prepare(
          `INSERT INTO shops (
            id, shop_name, shop_url, canonical_url, adapter_type, telegram, sync_supported, sync_state,
            last_synced_at, stale_days, shop_sell_count, sales_visible, product_count, product_summary_json,
            next_sync_at, updated_at${extraSql}
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${extraPlaceholders})
          ON CONFLICT(canonical_url) DO UPDATE SET
            ${updates.map(([column, value]) => `${column} = ${value}`).join(",\n            ")},
            updated_at = excluded.updated_at
          WHERE ${updates.map(([column, value]) => `shops.${column} IS NOT (${value})`).join(" OR ")}`,
        )
        .bind(
          id,
          shopName,
          rawUrl,
          canonicalUrl,
          adapterType,
          telegram,
          syncSupported,
          syncState,
          lastSyncedAt,
          staleDays,
          sellCount,
          sellCount !== null ? 1 : 0,
          productCount,
          summaryJson,
          nowIso,
          nowIso,
          ...(cols.systemType ? [persistedShopSystem(item.systemType ?? inferShopSystem(rawUrl, canonicalUrl))] : []),
          ...(cols.description ? [description] : []),
          ...(cols.createdAt ? [nowIso] : []),
          item.shopName === undefined ? 0 : 1,
          item.adapterType === undefined ? 0 : 1,
          ...(cols.systemType ? [item.systemType === undefined ? 0 : 1] : []),
          ...(cols.description ? [hasExplicitDescription ? 1 : 0] : []),
          item.adapterType === undefined ? 0 : 1,
          item.staleDays === undefined ? 0 : 1,
        ),
    );
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
  return { upserted: stmts.length };
}

/**
 * 管理员下架店铺：级联删除在售报价并自动重算受影响的同款比价组
 */
export async function deleteShopById(db: D1Database, shopId: string): Promise<{ deleted: boolean }> {
  const existing = await db.prepare("SELECT id FROM shops WHERE id = ?").bind(shopId).first<{ id: string }>();
  if (!existing) {
    return { deleted: false };
  }

  const { results: affected } = await db
    .prepare("SELECT DISTINCT group_key FROM offers WHERE shop_id = ?")
    .bind(shopId)
    .all<{ group_key: string }>();

  const affectedKeys = (affected || []).map((r) => r.group_key);

  await db.batch([
    db.prepare("DELETE FROM offers WHERE shop_id = ?").bind(shopId),
    db.prepare("DELETE FROM shop_daily_snapshots WHERE shop_id = ?").bind(shopId),
    db.prepare("DELETE FROM shops WHERE id = ?").bind(shopId),
  ]);

  if (affectedKeys.length > 0) {
    await rebuildProductGroups(db, affectedKeys, new Date().toISOString());
  }

  return { deleted: true };
}
