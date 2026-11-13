import brandRules from "../../config/brand-rules.json";
import type { BrandRule } from "./brandClassifier";
import type {
  NormalizedOffer,
  RawShopSnapshot,
  ShopRecord,
  StockStatus,
} from "../../types";
import { normalizeDescription } from "../adapters/fetcher";
import { hasShopDescriptionColumn } from "../shopSystems";
import { calculateMedian, isNonSalePlaceholderItem, normalizeOffer } from "./cleaner";

const snapshotBrandRules: readonly BrandRule[] = brandRules;

export const SNAPSHOT_NORMALIZATION_VERSION = 8;

/**
 * 计算店铺快照的 SHA-256 摘要（使用原生 Web Crypto，CPU 耗时极低）
 * 仅对影响展示与比价的关键字段排序哈希，避免因源站字段顺序抖动触发误更新。
 * 注意：故意不将 description 纳入哈希，确保简介变更或回填仅执行单行更新而不触发整店商品重写。
 */
export async function computeSnapshotHash(snapshot: RawShopSnapshot): Promise<string> {
  const canonicalPayload = {
    normalizationVersion: SNAPSHOT_NORMALIZATION_VERSION,
    brandRules: snapshotBrandRules.map(({ group, priority, includeAny = [], includeAll = [], excludeAny = [] }) => ({
      group, priority, includeAny, includeAll, excludeAny,
    })),
    shopName: snapshot.shopName,
    canonicalUrl: snapshot.canonicalUrl,
    salesVisible: snapshot.salesVisible,
    depositVisible: snapshot.depositVisible,
    telegram: snapshot.telegram,
    shopSellCount: snapshot.shopSellCount,
    depositMoney: snapshot.depositMoney,
    items: [...snapshot.items]
      .sort((a, b) => a.itemKey.localeCompare(b.itemKey))
      .map((item) => ({
        k: item.itemKey,
        n: item.rawName,
        c: item.shopCategory,
        p: item.price,
        sc: item.stockCount,
        ss: item.stockStatus,
        u: item.itemUrl,
      })),
  };

  const bytes = new TextEncoder().encode(JSON.stringify(canonicalPayload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildProductSummaryJson(offers: NormalizedOffer[]): string {
  const grouped = new Map<
    string,
    { group: string; count: number; items: Array<{ name: string; price: number; itemUrl: string }> }
  >();

  for (const offer of offers) {
    let entry = grouped.get(offer.brandGroup);
    if (!entry) {
      entry = { group: offer.brandGroup, count: 0, items: [] };
      grouped.set(offer.brandGroup, entry);
    }
    entry.count += 1;
    if (entry.items.length < 3) {
      entry.items.push({
        name: offer.cleanName,
        price: offer.price,
        itemUrl: offer.itemUrl,
      });
    }
  }

  return JSON.stringify([...grouped.values()]);
}

interface OfferWithShopRow {
  id: string;
  shop_id: string;
  group_key: string;
  clean_name: string;
  brand_group: string;
  shop_category: string;
  attr_type: string;
  attr_plan: string;
  attr_duration: string;
  attr_warranty: string;
  attr_sms: string;
  attr_region: string;
  price: number;
  stock_count: number | null;
  stock_status: StockStatus;
  item_url: string;
  updated_at: string;
  shop_name: string;
  shop_url: string;
  telegram: string;
  stale_days: number;
  shop_product_count: number;
}

/**
 * 按固定语句数分片执行 db.batch，避免超大店铺（如 600+ 商品）单次请求超过 D1 批大小上限
 */
async function executeStatementChunks(
  db: D1Database,
  statements: D1PreparedStatement[],
  chunkSize = 150,
): Promise<number> {
  let rowsWritten = 0;
  for (let i = 0; i < statements.length; i += chunkSize) {
    const results = await db.batch(statements.slice(i, i + chunkSize));
    rowsWritten += results.reduce((total, result) => total + result.meta.rows_written, 0);
  }
  return rowsWritten;
}

/**
 * 重建受影响的同款商品组聚合表；将分片读取合为一次 batch，控制大店重分类的 D1 调用数。
 */
export async function rebuildProductGroups(
  db: D1Database,
  groupKeys: string[],
  nowIso: string,
): Promise<number> {
  if (groupKeys.length === 0) {
    return 0;
  }

  // D1 限制单条 SQL 最多 100 个绑定参数，按每片 80 个 key 分批拉取
  const groupedRows = new Map<string, OfferWithShopRow[]>();
  const chunkSize = 80;
  const readStatements: D1PreparedStatement[] = [];

  for (let i = 0; i < groupKeys.length; i += chunkSize) {
    const chunk = groupKeys.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    readStatements.push(db
      .prepare(
        `SELECT
          o.id, o.shop_id, o.group_key, o.clean_name, o.brand_group, o.shop_category,
          o.attr_type, o.attr_plan, o.attr_duration, o.attr_warranty, o.attr_sms, o.attr_region,
          o.price, o.stock_count, o.stock_status, o.item_url, o.updated_at,
          s.shop_name, s.shop_url, s.telegram, s.stale_days, s.product_count AS shop_product_count
        FROM offers o
        INNER JOIN shops s ON s.id = o.shop_id
        WHERE o.group_key IN (${placeholders})
        ORDER BY o.price ASC`,
      )
      .bind(...chunk));
  }

  // D1 的 invocation query 配额按 batch 调用计数，而不是其中的语句数。
  // 每条 SELECT 仍最多绑定 80 个 key，保留原有单语句绑定上限与价格排序。
  const readResults = await db.batch<OfferWithShopRow>(readStatements);
  for (const { results } of readResults) {
    for (const row of results || []) {
      let bucket = groupedRows.get(row.group_key);
      if (!bucket) {
        bucket = [];
        groupedRows.set(row.group_key, bucket);
      }
      bucket.push(row);
    }
  }

  const statements: D1PreparedStatement[] = [];

  for (const groupKey of groupKeys) {
    const rows = groupedRows.get(groupKey);
    if (!rows || rows.length === 0) {
      statements.push(db.prepare("DELETE FROM product_groups WHERE group_key = ?").bind(groupKey));
      continue;
    }

    rows.sort((a, b) => Number(a.price) - Number(b.price));
    const sortedPrices = rows.map((r) => Number(r.price));
    const minPrice = sortedPrices[0];
    const maxPrice = sortedPrices[sortedPrices.length - 1];
    const medianPrice = calculateMedian(sortedPrices);
    const distinctShops = new Set(rows.map((r) => r.shop_id));
    const lead = rows[0];

    const previewOffers = rows.slice(0, 12).map((row) => ({
      id: row.id,
      shopId: row.shop_id,
      shopName: row.shop_name,
      shopUrl: row.shop_url,
      telegram: row.telegram,
      price: row.price,
      stockCount: row.stock_count,
      stockStatus: row.stock_status,
      itemUrl: row.item_url,
      updatedAt: row.updated_at,
      staleDays: row.stale_days,
      shopProductCount: row.shop_product_count,
    }));

    statements.push(
      db
        .prepare(
          `INSERT INTO product_groups (
            group_key, display_name, brand_group, shop_category,
            attr_type, attr_plan, attr_duration, attr_warranty, attr_sms, attr_region,
            min_price, median_price, max_price, shop_count, offer_count,
            lead_shop_id, lead_shop_name, lead_shop_url, lead_item_url,
            stock_status, offers_preview_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(group_key) DO UPDATE SET
            display_name = excluded.display_name,
            brand_group = excluded.brand_group,
            shop_category = excluded.shop_category,
            attr_type = excluded.attr_type,
            attr_plan = excluded.attr_plan,
            attr_duration = excluded.attr_duration,
            attr_warranty = excluded.attr_warranty,
            attr_sms = excluded.attr_sms,
            attr_region = excluded.attr_region,
            min_price = excluded.min_price,
            median_price = excluded.median_price,
            max_price = excluded.max_price,
            shop_count = excluded.shop_count,
            offer_count = excluded.offer_count,
            lead_shop_id = excluded.lead_shop_id,
            lead_shop_name = excluded.lead_shop_name,
            lead_shop_url = excluded.lead_shop_url,
            lead_item_url = excluded.lead_item_url,
            stock_status = excluded.stock_status,
            offers_preview_json = excluded.offers_preview_json,
            updated_at = excluded.updated_at`,
        )
        .bind(
          groupKey,
          lead.clean_name,
          lead.brand_group,
          lead.shop_category,
          lead.attr_type,
          lead.attr_plan,
          lead.attr_duration,
          lead.attr_warranty,
          lead.attr_sms,
          lead.attr_region,
          minPrice,
          medianPrice,
          maxPrice,
          distinctShops.size,
          rows.length,
          lead.shop_id,
          lead.shop_name,
          lead.shop_url,
          lead.item_url,
          lead.stock_status,
          JSON.stringify(previewOffers),
          nowIso,
        ),
    );
  }

  return executeStatementChunks(db, statements);
}

/**
 * 清理已关停、永久封禁或全店清零店铺的历史在售报价，并级联清理或重算受影响同款商品组
 */
export async function clearShopOffers(
  db: D1Database,
  shopId: string,
  nowIso: string,
): Promise<number> {
  const { results: existingOfferGroups } = await db
    .prepare("SELECT DISTINCT group_key FROM offers WHERE shop_id = ?")
    .bind(shopId)
    .all<{ group_key: string }>();

  const affectedKeys = (existingOfferGroups || []).map((row) => row.group_key);
  if (affectedKeys.length === 0) {
    return 0;
  }

  await db.batch([
    db.prepare("DELETE FROM offers WHERE shop_id = ?").bind(shopId),
    db
      .prepare(
        `UPDATE shops
         SET product_count = 0, product_summary_json = '[]', content_hash = '', updated_at = ?
         WHERE id = ?`,
      )
      .bind(nowIso, shopId),
  ]);

  const groupWrites = await rebuildProductGroups(db, affectedKeys, nowIso);
  return 2 + groupWrites;
}

export interface PersistSnapshotOptions {
  /** 调用方已知当前数据库是否存在 shops.description 列时直接传入，避免重复探测 */
  hasDescriptionColumn?: boolean;
  /** 推送重复快照时合并心跳更新；定时采集仍按 next_sync_at 调度。 */
  minUnchangedIntervalMs?: number;
}

/**
 * 持久化单店抓取结果（内含 SHA-256 增量比对，命中未变化时跳过商品表与聚合同款表重写）
 */
export async function persistShopSnapshot(
  db: D1Database,
  shop: ShopRecord,
  snapshot: RawShopSnapshot,
  nowIso: string,
  options?: PersistSnapshotOptions,
): Promise<{
  status: "unchanged" | "updated";
  contentHash: string;
  itemCount: number;
  estimatedWrites: number;
  descriptionUpdated: boolean;
}> {
  const newHash = await computeSnapshotHash(snapshot);
  const nextSyncAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const today = nowIso.slice(0, 10);

  const hasIncomingDescription = typeof snapshot.description === "string";
  const nextDescription = hasIncomingDescription ? normalizeDescription(snapshot.description) : "";
  const hasDescriptionColumn = !hasIncomingDescription
    ? false
    : options?.hasDescriptionColumn ??
      (typeof shop.description === "string" ? true : await hasShopDescriptionColumn(db));
  const shouldWriteDescription = hasDescriptionColumn && hasIncomingDescription;
  let previousDescription = typeof shop.description === "string" ? shop.description : "";
  if (shouldWriteDescription && typeof shop.description !== "string") {
    const row = await db
      .prepare("SELECT description FROM shops WHERE id = ?")
      .bind(shop.id)
      .first<{ description?: string | null }>();
    previousDescription = typeof row?.description === "string" ? row.description : "";
  }
  const descriptionChanged = shouldWriteDescription && nextDescription !== previousDescription;

  // 未发生任何价格/商品变化：仅刷新同步时间戳（若简介有变化则顺带单行更新简介），不重写 offers/product_groups
  if (shop.content_hash && shop.content_hash === newHash) {
    const elapsed = Date.parse(nowIso) - Date.parse(shop.last_synced_at || "");
    if (!descriptionChanged && shop.sync_state === "ready" && !shop.last_error && !shop.consecutive_failures &&
        Number.isFinite(elapsed) && elapsed >= 0 && elapsed < (options?.minUnchangedIntervalMs || 0)) {
      return { status: "unchanged", contentHash: newHash, itemCount: shop.product_count, estimatedWrites: 0, descriptionUpdated: false };
    }
    if (descriptionChanged) {
      await db
        .prepare(
          `UPDATE shops
           SET description = ?, last_synced_at = ?, next_sync_at = ?, consecutive_failures = 0, last_error = '', stale_days = 0, sync_state = 'ready', updated_at = ?
           WHERE id = ?`,
        )
        .bind(nextDescription, nowIso, nextSyncAt, nowIso, shop.id)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE shops
           SET last_synced_at = ?, next_sync_at = ?, consecutive_failures = 0, last_error = '', stale_days = 0, sync_state = 'ready'
           WHERE id = ?`,
        )
        .bind(nowIso, nextSyncAt, shop.id)
        .run();
    }

    return {
      status: "unchanged",
      contentHash: newHash,
      itemCount: snapshot.items.length,
      estimatedWrites: 1,
      descriptionUpdated: descriptionChanged,
    };
  }

  // 发生变化：执行完整清洗与增量替换（入库前兜底剔除测试/补差价等占位条目）
  const normalizedOffers = snapshot.items
    .filter((item) => !isNonSalePlaceholderItem(item.rawName, item.shopCategory, item.price))
    .map((item) => normalizeOffer(shop.id, item, nowIso));
  const summaryJson = buildProductSummaryJson(normalizedOffers);

  // 读取已有报价一次，按所有持久字段比较；保留未变化行的 updated_at。
  const { results: existingRows } = await db.prepare("SELECT * FROM offers WHERE shop_id = ?")
    .bind(shop.id).all<Record<string, unknown>>();
  const existing = new Map((existingRows || []).map((row) => [String(row.id), row]));
  const columns: Array<[keyof NormalizedOffer, string]> = [
    ["groupKey", "group_key"], ["rawName", "raw_name"], ["cleanName", "clean_name"],
    ["brandGroup", "brand_group"], ["shopCategory", "shop_category"],
    ["attrType", "attr_type"], ["attrPlan", "attr_plan"], ["attrDuration", "attr_duration"],
    ["attrWarranty", "attr_warranty"], ["attrSms", "attr_sms"], ["attrRegion", "attr_region"],
    ["price", "price"], ["stockCount", "stock_count"], ["stockStatus", "stock_status"], ["itemUrl", "item_url"],
  ];
  const changedOffers = normalizedOffers.filter((offer) => {
    const previous = existing.get(offer.id);
    return !previous || columns.some(([key, column]) => offer[key] !== previous[column]);
  });
  const incomingIds = new Set(normalizedOffers.map((offer) => offer.id));
  const removed = (existingRows || []).filter((row) => !incomingIds.has(String(row.id)));
  const affectedGroups = new Set<string>();
  for (const row of removed) affectedGroups.add(String(row.group_key));
  for (const offer of changedOffers) {
    affectedGroups.add(offer.groupKey);
    const previous = existing.get(offer.id);
    if (previous) affectedGroups.add(String(previous.group_key));
  }
  // 聚合预览嵌入店名、网址和商品数，元数据改变时同步刷新相关组。
  if (shop.shop_name !== snapshot.shopName ||
      shop.telegram !== snapshot.telegram || shop.product_count !== normalizedOffers.length || shop.stale_days !== 0) {
    for (const row of existingRows || []) affectedGroups.add(String(row.group_key));
    for (const offer of normalizedOffers) affectedGroups.add(offer.groupKey);
  }

  const pricesSorted = normalizedOffers.map((o) => o.price).sort((a, b) => a - b);
  const shopMinPrice = pricesSorted.length ? pricesSorted[0] : null;
  const shopMedianPrice = pricesSorted.length ? calculateMedian(pricesSorted) : null;

  const batchStmts: D1PreparedStatement[] = removed.map((row) =>
    db.prepare("DELETE FROM offers WHERE id = ? AND shop_id = ?").bind(row.id, shop.id));

  for (const offer of changedOffers) {
    batchStmts.push(
      db
        .prepare(
          `INSERT INTO offers (
            id, shop_id, group_key, raw_name, clean_name, brand_group, shop_category,
            attr_type, attr_plan, attr_duration, attr_warranty, attr_sms, attr_region,
            price, stock_count, stock_status, item_url, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            group_key = excluded.group_key, raw_name = excluded.raw_name, clean_name = excluded.clean_name,
            brand_group = excluded.brand_group, shop_category = excluded.shop_category,
            attr_type = excluded.attr_type, attr_plan = excluded.attr_plan, attr_duration = excluded.attr_duration,
            attr_warranty = excluded.attr_warranty, attr_sms = excluded.attr_sms, attr_region = excluded.attr_region,
            price = excluded.price, stock_count = excluded.stock_count, stock_status = excluded.stock_status,
            item_url = excluded.item_url, updated_at = excluded.updated_at`,
        )
        .bind(
          offer.id,
          offer.shopId,
          offer.groupKey,
          offer.rawName,
          offer.cleanName,
          offer.brandGroup,
          offer.shopCategory,
          offer.attrType,
          offer.attrPlan,
          offer.attrDuration,
          offer.attrWarranty,
          offer.attrSms,
          offer.attrRegion,
          offer.price,
          offer.stockCount,
          offer.stockStatus,
          offer.itemUrl,
          offer.updatedAt,
        ),
    );
  }

  // 所有报价写入完成后再更新店铺主记录（绝不覆写 created_at）及当日观察快照
  batchStmts.push(
    db
      .prepare(
        `UPDATE shops SET
          shop_name = ?,
          canonical_url = ?,
          telegram = ?,
          ${shouldWriteDescription ? "description = ?," : ""}
          sync_state = 'ready',
          content_hash = ?,
          last_synced_at = ?,
          next_sync_at = ?,
          consecutive_failures = 0,
          last_error = '',
          stale_days = 0,
          shop_sell_count = ?,
          sales_visible = ?,
          deposit_visible = ?,
          deposit_money = ?,
          product_count = ?,
          product_summary_json = ?,
          updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        snapshot.shopName,
        snapshot.canonicalUrl,
        snapshot.telegram,
        ...(shouldWriteDescription ? [nextDescription] : []),
        newHash,
        nowIso,
        nextSyncAt,
        snapshot.shopSellCount,
        snapshot.salesVisible ? 1 : 0,
        snapshot.depositVisible ? 1 : 0,
        snapshot.depositMoney,
        normalizedOffers.length,
        summaryJson,
        nowIso,
        shop.id,
      ),
    db
      .prepare(
        `INSERT INTO shop_daily_snapshots (shop_id, day, product_count, min_price, median_price, total_sales, has_stock)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(shop_id, day) DO UPDATE SET
           product_count = excluded.product_count,
           min_price = excluded.min_price,
           median_price = excluded.median_price,
           total_sales = excluded.total_sales,
           has_stock = excluded.has_stock
         WHERE shop_daily_snapshots.product_count IS NOT excluded.product_count
            OR shop_daily_snapshots.min_price IS NOT excluded.min_price
            OR shop_daily_snapshots.median_price IS NOT excluded.median_price
            OR shop_daily_snapshots.total_sales IS NOT excluded.total_sales
            OR shop_daily_snapshots.has_stock IS NOT excluded.has_stock`,
      )
      .bind(
        shop.id,
        today,
        normalizedOffers.length,
        shopMinPrice,
        shopMedianPrice,
        snapshot.shopSellCount,
        normalizedOffers.some((offer) => offer.stockCount === null || offer.stockCount > 0) ? 1 : 0,
      ),
  );

  const snapshotWrites = await executeStatementChunks(db, batchStmts);

  const groupWrites = await rebuildProductGroups(db, [...affectedGroups], nowIso);

  // 估算写入行数（含索引列维护）
  const estimatedWrites = snapshotWrites + groupWrites;

  return {
    status: "updated",
    contentHash: newHash,
    itemCount: normalizedOffers.length,
    estimatedWrites,
    descriptionUpdated: descriptionChanged,
  };
}
