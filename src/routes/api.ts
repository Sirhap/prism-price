import { normalizeSubmittedShopUrl } from "../collector/submittedShopUrl";
import { authenticated as adminAuthenticated, getIngestHash, handleAdminRoute, matchesIngestSecret, settings as adminSettings } from "./admin";
import { cachedQuery, cachedShopCount, catalogVersion, catalogIndexes } from "../cache/queryCache";
import { TYPE_SQL_EXPR, PLAN_SQL_EXPR, loadProductBuckets, summarizeProducts, catalogGroups } from "./productStats";
import {
  extractMainCategories,
  hideTelegramContacts,
  integrationCodeCandidateFilter,
  resolveIntegrationCodes,
  type ShopMainCategory,
} from "../collector/shopPresentation";
export { extractMainCategories, type ShopMainCategory };
import {
  SHOP_SYSTEMS,
  getShopColumnCapabilities,
  hasShopSystemColumn,
  inferShopSystem,
  normalizeShopSystem,
  shopReadSource,
} from "../collector/shopSystems";
import { resolveAdapter } from "../collector/adapters";
import { assertSafePublicUrl, normalizeDescription } from "../collector/adapters/fetcher";
import {
  PRODUCT_PLAN_SET,
  buildProductRelevanceOrder,
  containsMatch,
  normalizeProductQuery,
  normalizeShopSort,
  positiveInteger,
  searchTerms,
  type ShopSortOption,
} from "./search";
import { type AdapterType, type ShopRecord } from "../types";
import {
  computeStaleDays,
  deleteShopById,
  ensureSeedShops,
  ingestPushedSnapshots,
  runSyncBatch,
  upsertAdminShops,
  type AdminShopInput,
  type PushedShopEntry,
} from "../collector/scheduler";
import { persistShopSnapshot } from "../collector/etl/hashAndDiff";
import {
  calculateMedian,
  extractWarrantyText,
  isNonSalePlaceholderItem,
  normalizeOffer,
} from "../collector/etl/cleaner";

interface ProductGroupRow {
  group_key: string;
  display_name: string;
  brand_group: string;
  shop_category: string;
  attr_type: string;
  attr_plan: string;
  attr_duration: string;
  attr_warranty: string;
  attr_sms: string;
  attr_region: string;
  min_price: number;
  median_price: number;
  max_price: number;
  shop_count: number;
  offer_count: number;
  lead_shop_id: string;
  lead_shop_name: string;
  lead_shop_url: string;
  lead_item_url: string;
  stock_status: string;
  offers_preview_json: string;
  updated_at: string;
}

interface SnapshotRow {
  shop_id: string;
  day: string;
  product_count: number;
  min_price: number | null;
  median_price: number | null;
  total_sales: number | null;
  has_stock: number;
}

const ALLOWED_ADAPTERS: ReadonlySet<AdapterType> = new Set([
  "shop_api",
  "ka123_api",
  "ssr_html",
  "json_api",
  "json_ld",
  "push_ingest",
  "manual",
]);

/**
 * 返回带边缘短缓存头的公开只读 JSON 响应
 */
function jsonPublic(payload: unknown, maxAgeSeconds = 30): Response {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "telegram")
      .map(([key, item]) => [key, ["description", "shopName", "leadShopName", "name", "displayName", "rawName", "lastError"].includes(key) && typeof item === "string" ? hideTelegramContacts(item) : clean(item)]));
    return value;
  };
  return Response.json(clean(payload), {
    headers: {
      "Cache-Control": `public, max-age=${maxAgeSeconds}`,
    },
  });
}

function buildPriceRangeFilter(priceBand: string): { clause: string; params: number[] } {
  switch (priceBand) {
    case "under-10":
      return { clause: "min_price < ?", params: [10] };
    case "10-50":
      return { clause: "min_price >= ? AND min_price < ?", params: [10, 50] };
    case "50-150":
      return { clause: "min_price >= ? AND min_price < ?", params: [50, 150] };
    case "150-500":
      return { clause: "min_price >= ? AND min_price < ?", params: [150, 500] };
    case "500-plus":
      return { clause: "min_price >= ?", params: [500] };
    default:
      return { clause: "", params: [] };
  }
}

function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function safeDecodeRouteParam(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

/**
 * 使用 SHA-256 + timingSafeEqual 校验管理员/推送密钥，防止时序泄露与未授权写入
 */
async function verifyAdminSecret(request: Request, env: Env): Promise<{ ok: boolean; status: number; message: string }> {
  const expected = env.INGEST_SECRET;
  let override: string | null = null;
  try { override = await getIngestHash(env.DB); } catch (error) { if (!/no such table/i.test(String(error))) throw error; }
  if (!expected && !override) {
    return { ok: false, status: 503, message: "服务端尚未配置 INGEST_SECRET" };
  }

  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const provided = match ? match[1].trim() : "";
  if (!provided) {
    return { ok: false, status: 401, message: "缺少 Bearer 授权凭据" };
  }

  if (override) return await matchesIngestSecret(provided, override)
    ? {ok:true,status:200,message:'ok'} : {ok:false,status:401,message:'授权密钥校验失败'};

  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  if (!crypto.subtle.timingSafeEqual(providedHash, expectedHash)) {
    return { ok: false, status: 401, message: "授权密钥校验失败" };
  }

  return { ok: true, status: 200, message: "ok" };
}

/**
 * GET /api/products - 从预聚合表直接检索商品并统计分面计数
 */
async function handleGetProducts(url: URL, env: Env, enableRecommendation = true): Promise<Response> {
  await ensureSeedShops(env.DB);

  // 同款商品展开剩余报价的按需查询分支
  const offerKey = (url.searchParams.get("offerKey") || "").trim();
  if (offerKey) {
    const groupRow = await env.DB.prepare("SELECT * FROM product_groups WHERE group_key = ?")
      .bind(offerKey)
      .first<ProductGroupRow>();
    if (!groupRow) {
      return jsonPublic({ items: [] });
    }
    const { results: fullOffers } = await env.DB.prepare(
      `SELECT
        o.id, o.shop_id, o.price, o.stock_count, o.stock_status, o.item_url, o.updated_at,
        s.shop_name, s.shop_url, s.telegram, s.last_synced_at, s.stale_days, s.product_count AS shop_product_count
       FROM offers o
       INNER JOIN shops s ON s.id = o.shop_id
       WHERE o.group_key = ?
       ORDER BY o.price ASC`,
    )
      .bind(offerKey)
      .all<Record<string, unknown>>();

    return jsonPublic({
      items: [
        {
          id: groupRow.group_key,
          name: groupRow.display_name,
          offers: (fullOffers || []).map((row) => ({
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
            staleDays: computeStaleDays(
              typeof row.last_synced_at === "string" ? row.last_synced_at : null,
              Number(row.stale_days ?? 0),
            ),
            shopProductCount: row.shop_product_count,
          })),
        },
      ],
    });
  }

  const normalizedQuery = normalizeProductQuery(url.searchParams);
  const { appliedFilters, appliedPriceRange } = normalizedQuery;
  const { q, group, type, plan, duration, price, sort } = appliedFilters;
  const page = positiveInteger(url.searchParams.get("page"), 1, 1_000_000);
  const pageSize = positiveInteger(url.searchParams.get("pageSize"), 30, 50);

  const searchParts: string[] = [];
  const searchParams: Array<string | number> = [];
  for (const term of searchTerms(q)) {
    const matches = ["display_name", "shop_category", "shop_name"].map((column) => containsMatch(column, term));
    searchParts.push(`(${matches[0].sql} OR ${matches[1].sql}
      OR group_key IN (SELECT group_key FROM offers WHERE shop_id IN
        (SELECT id FROM shops WHERE ${matches[2].sql}))) `);
    searchParams.push(...matches.map((match) => match.value));
  }
  const searchWhereSql = searchParts.length ? `WHERE ${searchParts.join(" AND ")}` : "";

  const filters: Array<{ key: string; clause: string; params: Array<string | number> }> = [];
  if (group !== "all") filters.push({ key: "group", clause: "brand_group = ?", params: [group] });
  if (type !== "all") filters.push({ key: "type", clause: `(${TYPE_SQL_EXPR}) = ?`, params: [type] });
  if (plan !== "all") filters.push({ key: "plan", clause: `(${PLAN_SQL_EXPR}) = ?`, params: [plan] });
  if (duration !== "all") filters.push({ key: "duration", clause: "attr_duration = ?", params: [duration] });
  if (appliedPriceRange.minPrice !== null || appliedPriceRange.maxPrice !== null) {
    const boundClauses: string[] = [];
    const boundParams: number[] = [];
    if (appliedPriceRange.minPrice !== null) {
      boundClauses.push("min_price >= ?");
      boundParams.push(appliedPriceRange.minPrice);
    }
    if (appliedPriceRange.maxPrice !== null) {
      boundClauses.push("min_price <= ?");
      boundParams.push(appliedPriceRange.maxPrice);
    }
    filters.push({ key: "price", clause: boundClauses.join(" AND "), params: boundParams });
  } else {
    const priceFilter = buildPriceRangeFilter(price);
    if (priceFilter.clause) filters.push({ key: "price", ...priceFilter });
  }

  const filterScope = (excludedKey?: string) => {
    const included = filters.filter((filter) => filter.key !== excludedKey);
    return {
      sql: included.length ? `WHERE ${included.map((filter) => filter.clause).join(" AND ")}` : "",
      params: included.flatMap((filter) => filter.params),
    };
  };
  const selectedScope = filterScope();
  const whereSql = [...searchParts, ...filters.map((filter) => filter.clause)].length
    ? `WHERE ${[...searchParts, ...filters.map((filter) => filter.clause)].join(" AND ")}` : "";
  const params = [...searchParams, ...selectedScope.params];

  let orderSql = "ORDER BY shop_count DESC, min_price ASC, group_key ASC";
  let orderParams: string[] = [];
  if (sort === "price-asc") {
    orderSql = "ORDER BY min_price ASC, shop_count DESC, group_key ASC";
  } else if (sort === "updated-desc") {
    orderSql = "ORDER BY updated_at DESC, min_price ASC, group_key ASC";
  } else {
    const relevanceOrder = buildProductRelevanceOrder(q);
    orderSql = relevanceOrder.orderSql;
    orderParams = relevanceOrder.params;
  }

  const offset = (page - 1) * pageSize;

  const includeFacets = url.searchParams.get("facets") !== "0";
  const indexes = await catalogIndexes(env.DB, url);
  const version = await catalogVersion(env.DB, url, indexes);
  // 文本相关度仍先排序；同相关度内对店铺数做饱和处理，叠加有上限的店铺排名分。
  let recommendationKey = '';
  if (sort === 'relevance' && enableRecommendation) {
    try {
      const config = await adminSettings(env.DB);
      const slot = Math.floor(Date.now() / 60000);
      const topShops = await cachedQuery(url, `product-recommended-shops:${version}:${config.revision}:${slot}`, async () => {
        const signal = await env.DB.prepare('SELECT 1 FROM shop_rank_settings WHERE favorite_count > 0 OR (? = 1 AND manual_rank IS NOT NULL) LIMIT 1').bind(config.manual_rank_enabled).first();
        if (!signal) return [];
        const {results} = await env.DB.prepare(`SELECT s.id FROM shops s JOIN shop_rank_settings r ON r.shop_id=s.id
          WHERE r.favorite_count > 0 OR (?=1 AND r.manual_rank IS NOT NULL)
          ORDER BY CASE WHEN ?=1 AND r.manual_rank IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN ?=1 THEN r.manual_rank END ASC, COALESCE(r.favorite_count,0) DESC,
          CASE WHEN COALESCE(r.favorite_count,0)=0 THEN s.last_synced_at END DESC, s.product_count DESC,s.id ASC LIMIT 20`)
          .bind(config.manual_rank_enabled,config.manual_rank_enabled,config.manual_rank_enabled).all<{id:string}>();
        return (results || []).map(row=>row.id);
      },60);
      if (topShops.length) {
        const ids = JSON.stringify(topShops).replace(/'/g,"''");
        const bonus = `COALESCE((SELECT MAX(4.0 / (1.0 + CAST(recommended.key AS INTEGER) * 0.1)) FROM json_each(CASE WHEN json_valid(offers_preview_json) THEN offers_preview_json ELSE '[]' END) AS preview JOIN json_each('${ids}') AS recommended ON json_extract(preview.value,'$.shopId')=recommended.value),0)`;
        const popularity = `(10.0 * shop_count / (shop_count + 10.0))`;
        orderSql = orderSql.replace('shop_count DESC, min_price ASC', `(${popularity} + ${bonus}) DESC, shop_count DESC, min_price ASC`);
        recommendationKey = `${config.revision}:${slot}`;
      }
    } catch (error) { if (!/no such table/i.test(String(error))) throw error; }
  }
  const scopeKey = searchTerms(q).join(" ");
  const buckets = await cachedQuery(url, `product-stats:${version}:${scopeKey}`, () =>
    loadProductBuckets(env.DB, searchWhereSql, searchParams));
  const stats = summarizeProducts(buckets, normalizedQuery);
  const siteGroups = includeFacets ? catalogGroups(q
    ? await cachedQuery(url, `product-stats:${version}:`, () => loadProductBuckets(env.DB, "", []))
    : buckets) : undefined;
  // 搜索已在统计扫描中确定匹配键，列表不再重新执行文本扫描和店名关联子查询。
  const useMatchedKeys = Boolean(q) || (filters.length > 0 && stats.groupKeys.length <= 500);
  const listFrom = useMatchedKeys ? "json_each(?) AS matched CROSS JOIN product_groups AS p" : "product_groups";
  const listWhere = useMatchedKeys
    ? `WHERE p.group_key = matched.value${selectedScope.sql ? ` AND ${selectedScope.sql.slice(6)}` : ""}`
    : whereSql;
  const listParams = useMatchedKeys ? [JSON.stringify(stats.groupKeys), ...selectedScope.params] : params;
  const readPage = async (): Promise<{ results: ProductGroupRow[] }> => {
    if (offset >= stats.total) return { results: [] };
    if (useMatchedKeys || !indexes.popular || recommendationKey) {
      // 排名只算一次，后续页按12/30个主键取行；不每翻一页就重排整个搜索结果。
      const ordered = await cachedQuery(url, `product-order:${version}:${recommendationKey}:${JSON.stringify([appliedFilters, appliedPriceRange])}`, async () => {
        const { results } = await env.DB.prepare(`SELECT group_key FROM ${listFrom} ${listWhere} ${orderSql}`)
          .bind(...listParams, ...orderParams).all<{ group_key: string }>();
        return results.map((row) => row.group_key);
      });
      const pageKeys = ordered.slice(offset, offset + pageSize);
      if (!pageKeys.length) return { results: [] };
      const { results } = await env.DB.prepare(`SELECT p.* FROM json_each(?) AS matched CROSS JOIN product_groups AS p
        WHERE p.group_key = matched.value${selectedScope.sql ? ` AND ${selectedScope.sql.slice(6)}` : ""}`)
        .bind(JSON.stringify(pageKeys), ...selectedScope.params).all<ProductGroupRow>();
      const rows = new Map(results.map((row) => [row.group_key, row]));
      return { results: pageKeys.flatMap((key) => { const row = rows.get(key); return row ? [row] : []; }) };
    }
    return env.DB.prepare(`SELECT * FROM product_groups ${listWhere} ${orderSql} LIMIT ? OFFSET ?`)
      .bind(...listParams, ...orderParams, pageSize, offset).all<ProductGroupRow>();
  };
  const [listRes, offerStatsRes] = await Promise.all([readPage(), cachedShopCount(url, env.DB, version)]);

  const items = (listRes.results || []).map((row) => {
    let offers: unknown[] = [];
    try {
      offers = JSON.parse(row.offers_preview_json);
    } catch {
      offers = [];
    }
    const itemType =
      row.attr_sms === "service"
        ? "sms-service"
        : row.attr_type === "cdk"
          ? "recharge"
          : row.attr_type;
    const itemPlan =
      row.attr_plan === "business"
        ? "team"
        : PRODUCT_PLAN_SET.has(row.attr_plan)
          ? row.attr_plan
          : "";
    return {
      id: row.group_key,
      name: row.display_name,
      group: row.brand_group,
      category: row.shop_category,
      attributes: {
        type: itemType,
        plan: itemPlan,
        duration: row.attr_duration,
        warranty: row.attr_warranty,
        sms: row.attr_sms === "service" ? "" : row.attr_sms,
        region: row.attr_region,
      },
      warrantyText: extractWarrantyText(row.display_name),
      minPrice: row.min_price,
      medianPrice: row.median_price,
      maxPrice: row.max_price,
      shopCount: row.shop_count,
      offerCount: row.offer_count,
      offersTruncated: row.offer_count > 12,
      stockStatus: row.stock_status,
      updatedAt: row.updated_at,
      shopId: row.lead_shop_id,
      shopName: row.lead_shop_name,
      shopUrl: row.lead_shop_url,
      itemUrl: row.lead_item_url,
      offers,
    };
  });

  const { total, offerTotal } = stats;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return jsonPublic({
    items,
    total,
    offerTotal,
    shopCount: offerStatsRes,
    page,
    pageSize,
    totalPages,
    appliedFilters,
    appliedPriceRange,
    catalogGroups: siteGroups,
    facets: includeFacets ? { ...stats.facets, countMode: "replace-dimension" } : undefined,
  });
}

/**
 * 格式化单店数据库记录为公开响应对象
 */
function formatShopRow(s: ShopRecord) {
  const systemType = inferShopSystem(s.shop_url, s.canonical_url) !== "unknown" ? inferShopSystem(s.shop_url, s.canonical_url) : (normalizeShopSystem(s.system_type) ?? "unknown");
  let productSummary: unknown[] = [];
  try {
    productSummary = JSON.parse(s.product_summary_json || "[]");
  } catch {
    productSummary = [];
  }
  return {
    id: s.id,
    shopName: s.shop_name,
    shopUrl: s.shop_url,
    canonicalUrl: s.canonical_url,
    description: hideTelegramContacts(s.description),
    integrationCodes: resolveIntegrationCodes(s).codes,
    mainCategories: extractMainCategories(s.product_summary_json),
    adapterType: s.adapter_type,
    systemType,
    systemTypeLabel: SHOP_SYSTEMS[systemType],
    syncSupported: s.sync_supported === 1,
    syncState: s.sync_state,
    contentHash: s.content_hash ? s.content_hash.slice(0, 12) : "",
    contentHashFull: s.content_hash || "",
    createdAt: typeof s.created_at === "string" && s.created_at.trim() ? s.created_at.trim() : null,
    lastSyncedAt: s.last_synced_at,
    nextSyncAt: s.next_sync_at,
    consecutiveFailures: s.consecutive_failures,
    lastError: s.last_error,
    staleDays: computeStaleDays(s.last_synced_at, s.stale_days),
    shopSellCount: s.shop_sell_count,
    ldxpProfile: {
      salesVisible: s.sales_visible === 1,
      depositVisible: s.deposit_visible === 1,
      depositMoney: s.deposit_money,
    },
    productCount: s.product_count,
    productSummary,
    updatedAt: s.updated_at,
  };
}

/**
 * 严格校验 YYYY-MM-DD 格式并转为 UTC 零点时间戳（屏蔽 2026-10-32 等非标准回绕串）
 */
function parseStrictIsoDayMs(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toISOString().slice(0, 10) === day ? ms : null;
}

/**
 * 计算观测区间自然日跨度与未采集缺失天数，避免把停机/未同步天数误判为全店缺货
 */
function computeObservationSpan(
  firstDay: string,
  latestDay: string,
  observedDays: number,
): { windowSpanDays: number; unobservedDays: number } {
  if (observedDays <= 0) {
    return { windowSpanDays: 0, unobservedDays: 0 };
  }
  if (observedDays === 1) {
    return { windowSpanDays: 1, unobservedDays: 0 };
  }
  const firstMs = parseStrictIsoDayMs(firstDay);
  const latestMs = parseStrictIsoDayMs(latestDay);
  if (firstMs === null || latestMs === null || latestMs < firstMs) {
    return { windowSpanDays: observedDays, unobservedDays: 0 };
  }
  const spanDays = Math.floor((latestMs - firstMs) / 86_400_000) + 1;
  return {
    windowSpanDays: Math.max(observedDays, spanDays),
    unobservedDays: Math.max(0, spanDays - observedDays),
  };
}

/**
 * 计算店铺 30 天观察窗口销量趋势与观测信号（精确处理 0、负数变化及全历史最早快照日期，绝不冒充 createdAt）
 */
function buildSalesTrendAndSignals(snapshots: SnapshotRow[], earliestSnapshotDay: string | null) {
  const snaps = [...snapshots].reverse();
  const observedDays = snaps.length;
  const activeDayStreak = snaps.filter((s) => s.has_stock === 1).length;
  const outOfStockDays = observedDays - activeDayStreak;
  const latest = snaps[snaps.length - 1];
  const first = snaps[0];
  const firstDay = first?.day || "";
  const latestDay = latest?.day || "";
  const { windowSpanDays, unobservedDays } = computeObservationSpan(firstDay, latestDay, observedDays);

  const salesSnaps = snaps.filter(
    (s) => s.total_sales !== null && s.total_sales !== undefined && Number.isFinite(Number(s.total_sales)),
  );
  const latestHasSales =
    latest !== undefined &&
    latest.total_sales !== null &&
    latest.total_sales !== undefined &&
    Number.isFinite(Number(latest.total_sales));

  let salesTrend: {
    observedDays: number;
    firstCount: number;
    currentCount: number;
    change: number;
    windowDays: number;
    coverageDays: number;
    status: "init" | "growing" | "flat" | "declining";
  } | null = null;

  if (observedDays > 0 && latestHasSales) {
    const firstSalesCount = Number(salesSnaps[0]!.total_sales);
    const currentSalesCount = Number(latest.total_sales);
    const change = currentSalesCount - firstSalesCount;
    const status =
      salesSnaps.length < 2
        ? "init"
        : change > 0
          ? "growing"
          : change === 0
            ? "flat"
            : "declining";

    salesTrend = {
      observedDays,
      firstCount: firstSalesCount,
      currentCount: currentSalesCount,
      change,
      windowDays: 30,
      coverageDays: salesSnaps.length,
      status,
    };
  }

  return {
    salesTrend,
    baseSignals: {
      observedDays,
      firstDay,
      latestDay,
      earliestSnapshotDay: earliestSnapshotDay || null,
      activeDayStreak,
      outOfStockDays,
      windowSpanDays,
      unobservedDays,
    },
  };
}

/**
 * 组装单店介绍与基础状态字段（不含任何报价明细或价格）
 */
function buildBaseShopProfile(
  shop: ShopRecord,
  snapshots: SnapshotRow[],
  earliestSnapshotDay: string | null,
) {
  const systemType = inferShopSystem(shop.shop_url, shop.canonical_url) !== "unknown" ? inferShopSystem(shop.shop_url, shop.canonical_url) : (normalizeShopSystem(shop.system_type) ?? "unknown");
  const mainCategories = extractMainCategories(shop.product_summary_json);
  const { salesTrend, baseSignals } = buildSalesTrendAndSignals(snapshots, earliestSnapshotDay);

  return {
    baseProfile: {
      id: shop.id,
      shopName: shop.shop_name,
      shopUrl: shop.shop_url,
      canonicalUrl: shop.canonical_url,
      description: hideTelegramContacts(shop.description),
      integrationCodes: resolveIntegrationCodes(shop).codes,
      mainCategories,
      adapterType: shop.adapter_type,
      systemType,
      systemTypeLabel: SHOP_SYSTEMS[systemType],
      syncSupported: shop.sync_supported === 1,
      syncState: shop.sync_state,
      lastError: shop.last_error,
      consecutiveFailures: shop.consecutive_failures,
      createdAt: typeof shop.created_at === "string" && shop.created_at.trim() ? shop.created_at.trim() : null,
      staleDays: computeStaleDays(shop.last_synced_at, shop.stale_days),
      lastSyncedAt: shop.last_synced_at,
      productCount: shop.product_count,
      shopSellCount: shop.shop_sell_count,
      ldxpProfile: {
        salesVisible: shop.sales_visible === 1,
        depositVisible: shop.deposit_visible === 1,
        depositMoney: shop.deposit_money,
      },
      salesTrend,
    },
    baseSignals,
  };
}

/**
 * GET /api/shops - 返回店铺摘要列表（支持 fields=sync 极简清单、onlyInStock 过滤与分页搜索模式）
 */
async function handleGetShops(url: URL, env: Env): Promise<Response> {
  const caps = await getShopColumnCapabilities(env.DB);
  await ensureSeedShops(env.DB, caps);
  const shopSource = shopReadSource(caps);

  const fieldsMode = (url.searchParams.get("fields") || "").trim();
  if (fieldsMode === "sync") {
    const { results } = await env.DB.prepare(
      `SELECT id, shop_name, shop_url, canonical_url, adapter_type, effective_system_type AS system_type, description, telegram, sync_supported, sync_state, content_hash, last_synced_at, stale_days, shop_sell_count, sales_visible, deposit_visible, deposit_money
       FROM ${shopSource}
       WHERE sync_supported = 1 OR effective_system_type = '16688'
       ORDER BY id ASC`,
    ).all<ShopRecord>();

    return Response.json(
      {
        systemTypePersistence: caps.systemType,
        descriptionPersistence: caps.description,
        partialSnapshotSupport: true,
        shops: (results || []).map((s) => {
          const systemType = inferShopSystem(s.shop_url, s.canonical_url) !== "unknown" ? inferShopSystem(s.shop_url, s.canonical_url) : (normalizeShopSystem(s.system_type) ?? "unknown");
          return {
            id: s.id,
            shopName: s.shop_name,
            shopUrl: s.shop_url,
            canonicalUrl: s.canonical_url,
            adapterType: s.adapter_type,
            systemType,
            systemTypeLabel: SHOP_SYSTEMS[systemType],
            description: typeof s.description === "string" ? s.description : "",
            telegram: s.telegram,
            syncSupported: s.sync_supported === 1,
            syncState: s.sync_state,
            contentHashFull: s.content_hash || "",
            lastSyncedAt: s.last_synced_at,
            staleDays: computeStaleDays(s.last_synced_at, s.stale_days),
            shopSellCount:s.shop_sell_count, salesVisible:s.sales_visible === 1, depositVisible:s.deposit_visible === 1, depositMoney:s.deposit_money,
          };
        }),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const q = (url.searchParams.get("q") || "").trim();
  const version = await catalogVersion(env.DB, url);
  const hasPageParam = url.searchParams.has("page");
  const page = positiveInteger(url.searchParams.get("page"), 1, 1_000_000);
  const pageSize = positiveInteger(url.searchParams.get("pageSize"), 36, 100);
  const isTruthyFlag = (val: string | null) => ["1", "true", "yes"].includes((val || "").trim().toLowerCase());
  const onlyInStock = isTruthyFlag(url.searchParams.get("onlyInStock")) || isTruthyFlag(url.searchParams.get("hasProducts"));
  const hasIntegrationCode = isTruthyFlag(url.searchParams.get("hasIntegrationCode"));
  const hasDescription = isTruthyFlag(url.searchParams.get("hasDescription"));
  const shopSort: ShopSortOption = "default";
  let ranking: Map<string, {rank:number; favoriteCount:number; manualRank:number|null; manualRecommended:boolean}> | null = null;
  let rankingRevision = 0;
  try {
    const cfg = await adminSettings(env.DB);
    rankingRevision = cfg.revision;
    const rows = await cachedQuery(url, `shop-ranking:${version}:${cfg.revision}:${Math.floor(Date.now()/60000)}`, async () => {
      const {results} = await env.DB.prepare(`SELECT s.id, COALESCE(r.favorite_count,0) AS favorite_count, r.manual_rank
        FROM shops s LEFT JOIN shop_rank_settings r ON r.shop_id=s.id
        ORDER BY CASE WHEN ?=1 AND r.manual_rank IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN ?=1 THEN r.manual_rank END ASC, COALESCE(r.favorite_count,0) DESC,
          CASE WHEN COALESCE(r.favorite_count,0)=0 THEN s.last_synced_at END DESC, s.product_count DESC, s.id ASC`)
        .bind(cfg.manual_rank_enabled,cfg.manual_rank_enabled).all<{id:string;favorite_count:number;manual_rank:number|null}>();
      return results || [];
    }, 60);
    ranking = new Map(rows.map((row,index) => [row.id,{rank:index+1,favoriteCount:Number(row.favorite_count),manualRank:row.manual_rank,manualRecommended:!!cfg.manual_rank_enabled && row.manual_rank !== null}]));
  } catch (error) { if (!/no such table/i.test(String(error))) throw error; }
  const rankedFormat = (row: ShopRecord) => ({...formatShopRow(row), ...(ranking?.get(row.id) || {})});

  const terms = searchTerms(q);
  const systemNameSql = `CASE effective_system_type ${Object.entries(SHOP_SYSTEMS).map(([key, label]) => `WHEN '${key}' THEN '${key === "ldxp" ? `${label} 店铺` : label}'`).join(" ")} END`;
  const columns = ["shop_name", "shop_url", "canonical_url", "description", "product_summary_json", systemNameSql];
  const matches = terms.map((term) => columns.map((column) => containsMatch(column, term)));
  const baseConditions: string[] = matches.map(
    (termMatches) => `(${termMatches.map((match) => match.sql).join(" OR ")})`,
  );
  if (onlyInStock) {
    baseConditions.push("product_count > 0");
  }

  if (hasDescription) {
    baseConditions.push("TRIM(description) != ''");
  }
  const baseParams: Array<string | number> = matches.flatMap((termMatches) => termMatches.map((match) => match.value));
  if (hasIntegrationCode) {
    // 先读取小字段候选集做精确识别，ID 集合以单个 JSON 参数传回 SQL，避免绑定数量上限。
    const ids = await cachedQuery(url, `shop-code-ids:${version}:${JSON.stringify([terms, onlyInStock, hasDescription])}`, async () => {
      const candidate = integrationCodeCandidateFilter();
      const candidateConditions = [...baseConditions, candidate.sql];
      const { results } = await env.DB.prepare(
        `SELECT id, shop_name, description, shop_url, canonical_url, submitted_integration_code FROM ${shopSource} WHERE ${candidateConditions.join(" AND ")}`,
      ).bind(...baseParams, ...candidate.params).all<Pick<ShopRecord, "id" | "shop_name" | "description" | "shop_url" | "canonical_url">>();
      return (results || []).filter((row) => resolveIntegrationCodes(row).codes.length > 0).map((row) => row.id);
    });
    baseConditions.push("id IN (SELECT value FROM json_each(?))");
    baseParams.push(JSON.stringify(ids));
  }
  const baseWhereSql = baseConditions.length ? `WHERE ${baseConditions.join(" AND ")}` : "";

  // 非法 systemType 不再抛出 HTTP 400 死锁，统一规范回退为 "all"
  const rawSystemType = (url.searchParams.get("systemType") || "all").trim();
  const systemType = rawSystemType.toLowerCase() === "all" ? undefined : normalizeShopSystem(rawSystemType);
  const allConditions = [...baseConditions, ...(systemType ? ["effective_system_type = ?"] : [])];
  const whereSql = allConditions.length ? `WHERE ${allConditions.join(" AND ")}` : "";
  const whereParams = [...baseParams, ...(systemType ? [systemType] : [])];

  const facetRows = await cachedQuery(url, `shop-facets:${version}:${JSON.stringify([terms, onlyInStock, hasDescription, hasIntegrationCode])}`, async () => {
    const { results } = await env.DB.prepare(`SELECT effective_system_type AS system_type, COUNT(*) AS cnt FROM ${shopSource} ${baseWhereSql} GROUP BY effective_system_type`)
      .bind(...baseParams).all<{ system_type: string; cnt: number }>();
    return results;
  });
  const systemFacets: Record<string, number> = Object.fromEntries(Object.keys(SHOP_SYSTEMS).map((key) => [key, 0]));
  for (const row of facetRows || []) systemFacets[row.system_type] = Number(row.cnt);
  const systemMetadata = {
    systemTypes: SHOP_SYSTEMS,
    appliedSystemType: systemType || "all",
    appliedOnlyInStock: onlyInStock,
    appliedHasIntegrationCode: hasIntegrationCode,
    appliedHasDescription: hasDescription,
    appliedSort: shopSort,
    systemTypePersistence: caps.systemType,
    descriptionPersistence: caps.description,
    createdAtPersistence: caps.createdAt,
    facets: { systemTypes: systemFacets },
  };
  const orderSqlMap: Record<ShopSortOption, string> = {
    default: "ORDER BY sync_supported DESC, product_count DESC, stale_days ASC, updated_at DESC, id ASC",
    "products-desc": "ORDER BY product_count DESC, sync_supported DESC, stale_days ASC, updated_at DESC, id ASC",
    "sales-desc": "ORDER BY COALESCE(shop_sell_count, -1) DESC, product_count DESC, updated_at DESC, id ASC",
    "updated-desc": "ORDER BY COALESCE(last_synced_at, '') DESC, updated_at DESC, id ASC",
  };
  const orderSql = orderSqlMap[shopSort];

  if (hasPageParam) {
    const offset = (page - 1) * pageSize;
    const matchedTotal = systemType ? systemFacets[systemType] : Object.values(systemFacets).reduce((sum, count) => sum + count, 0);
    const readShopPage = async (): Promise<{ results: ShopRecord[] }> => {
      if (offset >= matchedTotal) return { results: [] };
      const ordered = await cachedQuery(url, `shop-order:${version}:${rankingRevision}:${JSON.stringify([terms, onlyInStock, hasDescription, hasIntegrationCode, systemType, shopSort])}:${Math.floor(Date.now()/60000)}`, async () => {
        const { results } = await env.DB.prepare(`SELECT id FROM ${shopSource} ${whereSql} ${orderSql}`)
          .bind(...whereParams).all<{ id: string }>();
        return results.map((row) => row.id).sort((a,b) => (ranking?.get(a)?.rank ?? 1e9) - (ranking?.get(b)?.rank ?? 1e9));
      }, 60);
      const ids = ordered.slice(offset, offset + pageSize);
      if (!ids.length) return { results: [] };
      const { results } = await env.DB.prepare(`SELECT p.* FROM json_each(?) AS matched
        CROSS JOIN (SELECT * FROM ${shopSource}) AS p WHERE p.id = matched.value`)
        .bind(JSON.stringify(ids)).all<ShopRecord>();
      const byId = new Map(results.map((row) => [row.id, row]));
      return { results: ids.flatMap((id) => { const row = byId.get(id); return row ? [row] : []; }) };
    };
    const [allRow, pageRes] = await Promise.all([cachedShopCount(url, env.DB, version), readShopPage()]);
    const matchRow = { total: matchedTotal };

    const totalAll = allRow;
    const total = Number(matchRow?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return jsonPublic({
      shops: (pageRes.results || []).map(rankedFormat),
      total,
      totalAll,
      page,
      pageSize,
      totalPages,
      ...systemMetadata,
    });
  }

  const [allRow, { results: shops }] = await Promise.all([
    cachedShopCount(url, env.DB, version),
    env.DB.prepare(`SELECT * FROM ${shopSource} ${whereSql} ${orderSql}`)
      .bind(...whereParams)
      .all<ShopRecord>(),
  ]);
  const formatted = (shops || []).map(rankedFormat).sort((a,b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));

  return jsonPublic({
    shops: formatted,
    total: formatted.length,
    totalAll: allRow,
    ...systemMetadata,
  });
}

/**
 * GET /api/shops/:id - 轻量店铺介绍接口（绝不查询 offers，不返回商品清单或价格）
 */
async function handleGetShopIntro(shopId: string, env: Env): Promise<Response> {
  const caps = await getShopColumnCapabilities(env.DB);
  await ensureSeedShops(env.DB, caps);
  const shopSource = shopReadSource(caps);

  const shop = await env.DB.prepare(`SELECT * FROM ${shopSource} WHERE id = ?`).bind(shopId).first<ShopRecord>();
  if (!shop) {
    return Response.json({ error: "店铺不存在" }, { status: 404 });
  }

  const [{ results: snapshots }, earliestRow] = await Promise.all([
    env.DB.prepare("SELECT * FROM shop_daily_snapshots WHERE shop_id = ? ORDER BY day DESC LIMIT 30")
      .bind(shopId)
      .all<SnapshotRow>(),
    env.DB.prepare("SELECT MIN(day) AS earliest_day FROM shop_daily_snapshots WHERE shop_id = ?")
      .bind(shopId)
      .first<{ earliest_day: string | null }>(),
  ]);

  const { baseProfile, baseSignals } = buildBaseShopProfile(
    shop,
    snapshots || [],
    earliestRow?.earliest_day ?? null,
  );

  return jsonPublic({
    shop: {
      ...baseProfile,
      shopSignals: baseSignals,
    },
    capabilities: {
      systemTypePersistence: caps.systemType,
      descriptionPersistence: caps.description,
      createdAtPersistence: caps.createdAt,
    },
  });
}

/**
 * GET /api/shops/:id/products - 向后兼容的店铺明细接口（保留全店商品清单与价格统计供已有测试/监控使用）
 */
async function handleGetShopDetail(shopId: string, env: Env): Promise<Response> {
  const caps = await getShopColumnCapabilities(env.DB);
  await ensureSeedShops(env.DB, caps);
  const shopSource = shopReadSource(caps);

  const shop = await env.DB.prepare(`SELECT * FROM ${shopSource} WHERE id = ?`).bind(shopId).first<ShopRecord>();
  if (!shop) {
    return Response.json({ error: "店铺不存在" }, { status: 404 });
  }

  const [{ results: offers }, { results: snapshots }, earliestRow] = await Promise.all([
    env.DB.prepare("SELECT * FROM offers WHERE shop_id = ? ORDER BY price ASC").bind(shopId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM shop_daily_snapshots WHERE shop_id = ? ORDER BY day DESC LIMIT 30")
      .bind(shopId)
      .all<SnapshotRow>(),
    env.DB.prepare("SELECT MIN(day) AS earliest_day FROM shop_daily_snapshots WHERE shop_id = ?")
      .bind(shopId)
      .first<{ earliest_day: string | null }>(),
  ]);

  const { baseProfile, baseSignals } = buildBaseShopProfile(
    shop,
    snapshots || [],
    earliestRow?.earliest_day ?? null,
  );
  const prices = (offers || []).map((o) => Number(o.price)).sort((a, b) => a - b);

  return jsonPublic({
    shop: {
      ...baseProfile,
      shopSignals: {
        ...baseSignals,
        products: (offers || []).length,
        minPrice: prices[0] ?? null,
        medianPrice: prices.length ? calculateMedian(prices) : null,
      },
      productItems: (offers || []).map((o) => ({
        id: o.id,
        name: o.clean_name,
        rawName: o.raw_name,
        group: o.brand_group,
        category: o.shop_category,
        price: o.price,
        stockCount: o.stock_count,
        stockStatus: o.stock_status,
        itemUrl: o.item_url,
        updatedAt: o.updated_at,
      })),
    },
    capabilities: {
      systemTypePersistence: caps.systemType,
      descriptionPersistence: caps.description,
      createdAtPersistence: caps.createdAt,
    },
  });
}

/**
 * POST /api/admin/shops - 管理员批量导入或更新店铺配置
 */
async function handleAdminUpsertShops(request: Request, env: Env): Promise<Response> {
  const auth = await verifyAdminSecret(request, env);
  if (!auth.ok) {
    return Response.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as { shops?: unknown } | null;
  if (!body || !Array.isArray(body.shops) || body.shops.length === 0) {
    return Response.json({ error: "请求体必须包含非空 shops 数组" }, { status: 400 });
  }
  if (body.shops.length > 50) {
    return Response.json({ error: "单次最多导入 50 家店铺" }, { status: 400 });
  }

  const validated: AdminShopInput[] = [];
  for (const item of body.shops) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return Response.json({ error: "shops 元素必须为对象" }, { status: 400 });
    }
    const raw = item as Record<string, unknown>;
    const shopUrl = typeof raw.shopUrl === "string" ? raw.shopUrl.trim() : "";
    if (!isValidHttpUrl(shopUrl)) {
      return Response.json({ error: `无效的店铺链接: ${shopUrl || "(空)"}` }, { status: 400 });
    }

    if (raw.canonicalUrl !== undefined && raw.canonicalUrl !== null && typeof raw.canonicalUrl !== "string") {
      return Response.json({ error: "canonicalUrl 必须为字符串" }, { status: 400 });
    }
    const canonicalUrl = typeof raw.canonicalUrl === "string" && raw.canonicalUrl.trim()
      ? raw.canonicalUrl.trim()
      : shopUrl;
    if (!isValidHttpUrl(canonicalUrl)) {
      return Response.json({ error: `无效的规范链接: ${canonicalUrl}` }, { status: 400 });
    }

    const rawAdapter = raw.adapterType === undefined ? undefined : String(raw.adapterType).trim() as AdapterType;
    if (rawAdapter !== undefined && !ALLOWED_ADAPTERS.has(rawAdapter)) {
      return Response.json({ error: `不支持的适配器类型: ${rawAdapter}` }, { status: 400 });
    }

    const systemType = raw.systemType === undefined ? undefined : normalizeShopSystem(raw.systemType);
    if (raw.systemType !== undefined && !systemType) {
      return Response.json({ error: "不支持的系统类型", allowedSystemTypes: SHOP_SYSTEMS }, { status: 400 });
    }

    if (raw.description !== undefined && typeof raw.description !== "string") {
      return Response.json({ error: "description 必须为字符串" }, { status: 400 });
    }
    const description =
      typeof raw.description === "string" ? normalizeDescription(raw.description).slice(0, 5000) : undefined;

    const productSummary = Array.isArray(raw.productSummary)
      ? raw.productSummary
          .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === "object"))
          .map((p) => ({
            name: String(p.name || "").trim(),
            price: Number(p.price || 0),
          }))
          .filter((p) => p.name && Number.isFinite(p.price) && p.price > 0)
          .slice(0, 6)
      : undefined;

    const trimmedId = typeof raw.id === "string" ? raw.id.trim() : "";
    const trimmedName = typeof raw.shopName === "string" ? raw.shopName.trim() : "";

    validated.push({
      id: trimmedId || undefined,
      shopName: trimmedName || undefined,
      shopUrl,
      canonicalUrl,
      adapterType: rawAdapter,
      systemType,
      description,
      telegram: typeof raw.telegram === "string" ? raw.telegram.trim() : "",
      shopSellCount: typeof raw.shopSellCount === "number" && Number.isFinite(raw.shopSellCount) ? raw.shopSellCount : undefined,
      staleDays: typeof raw.staleDays === "number" && Number.isFinite(raw.staleDays) ? raw.staleDays : undefined,
      lastSyncedAt: typeof raw.lastSyncedAt === "string" && raw.lastSyncedAt.trim() ? raw.lastSyncedAt.trim() : undefined,
      productSummary,
    });
  }

  if (validated.some((entry) => entry.systemType !== undefined) && !await hasShopSystemColumn(env.DB)) {
    return Response.json({ error: "系统类型数据库迁移尚未完成，请完成迁移后重试", code: "SHOP_SYSTEM_MIGRATION_PENDING" }, { status: 503 });
  }
  const result = await upsertAdminShops(env.DB, validated);
  return Response.json({ ok: true, upserted: result.upserted });
}

/** 提交店铺地址：仅入库待同步，不代表已核实商品或库存。 */
async function handlePublicShopSubmission(request: Request, env: Env): Promise<Response> {
  if (!(await adminSettings(env.DB)).submissions_enabled) return Response.json({error:'暂不接受新店提交'}, {status:403});
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin && requestOrigin !== new URL(request.url).origin) return Response.json({ error: "请求来源不匹配" }, { status: 403 });
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return Response.json({ error: "请使用 JSON 提交" }, { status: 415 });
  if (Number(request.headers.get("Content-Length") || 0) > 4096) return Response.json({ error: "提交内容过长" }, { status: 413 });
  const raw = await request.text();
  if (raw.length > 4096) return Response.json({ error: "提交内容过长" }, { status: 413 });
  let data: { shopUrl?: unknown; integrationCode?: unknown };
  try { data = JSON.parse(raw) as { shopUrl?: unknown; integrationCode?: unknown }; } catch { return Response.json({ error: "请求格式不正确" }, { status: 400 }); }
  const canonical = normalizeSubmittedShopUrl(data?.shopUrl);
  if (!canonical) return Response.json({ error: "请输入有效的公网店铺网址" }, { status: 400 });
  const integrationCode = typeof data.integrationCode === 'string' ? data.integrationCode.trim() : '';
  if (data.integrationCode !== undefined && typeof data.integrationCode !== 'string') return Response.json({error:'对接码格式无效'}, {status:400});
  if (integrationCode && (integrationCode.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(integrationCode))) return Response.json({error:'对接码只能包含字母、数字、空格、下划线和连字符'}, {status:400});
  const url = new URL(canonical);
  const known = ['wzyp.cn', 'catfk.com', 'www.16688.com.cn'].includes(url.hostname);
  const token = known ? url.pathname.split('/')[2] : '';
  const browserSupported = ['wzyp.cn', 'catfk.com'].includes(url.hostname);
  const aliases = new Set([canonical.toLowerCase()]);
  const hostAliases: Record<string,string[]> = {'wzyp.cn':['pay.ldxp.cn'],'catfk.com':['www.catfk.com'],'www.16688.com.cn':['16688.com.cn']};
  for (const host of hostAliases[url.hostname] || []) aliases.add(canonical.toLowerCase().replace(`://${url.hostname}`, `://${host}`));
  for (const item of [...aliases]) if (item.startsWith('https://')) aliases.add(`http://${item.slice(8)}`);
  const aliasJson = JSON.stringify([...aliases]);
  const existing = await env.DB.prepare("SELECT id FROM shops WHERE lower(rtrim(canonical_url, '/')) IN (SELECT value FROM json_each(?)) OR lower(rtrim(shop_url, '/')) IN (SELECT value FROM json_each(?)) LIMIT 1").bind(aliasJson,aliasJson).first<{ id: string }>();
  if (existing) return Response.json({ ok: true, existing: true, shopId: existing.id });
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  const id = `submitted-${digest}`;
  const now = new Date().toISOString();
  const result = await env.DB.prepare("INSERT OR IGNORE INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,sync_supported,sync_state,next_sync_at,updated_at,submitted_integration_code) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM shops WHERE id LIKE 'submitted-%' AND updated_at >= ?) < 30")
    .bind(id, token ? `店铺 ${token}` : url.hostname, canonical, canonical, browserSupported ? 'push_ingest' : 'manual', browserSupported ? 1 : 0, browserSupported ? 'pending' : 'manual', now, now, integrationCode, dayStart.toISOString()).run();
  if (!result.meta.changes) {
    const duplicate = await env.DB.prepare("SELECT id FROM shops WHERE id = ? OR lower(rtrim(canonical_url, '/')) = ? LIMIT 1").bind(id, canonical.toLowerCase()).first<{id: string}>();
    return duplicate ? Response.json({ ok: true, existing: true, shopId: duplicate.id }) : Response.json({ error: "今日提交数量已满，请稍后再试" }, { status: 429 });
  }
  return Response.json({ ok: true, existing: false, shopId: id }, { status: 201 });
}

const browserSyncInFlight = new Set<string>();

/** 浏览器提交为不可信输入；仅更新支持的平台，不因缺项删除已有报价。 */
async function handleBrowserShopSync(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: '请求来源不匹配' }, { status: 403 });
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) return Response.json({ error: '请使用 JSON' }, { status: 415 });
  if (Number(request.headers.get('Content-Length') || 0) > 1024 * 1024) return Response.json({ error: '数据过大' }, { status: 413 });
  const raw = await request.text();
  if (raw.length > 1024 * 1024) return Response.json({ error: '数据过大' }, { status: 413 });
  let body: { shopId?: unknown; shopName?: unknown; items?: unknown };
  try { body = JSON.parse(raw); } catch { return Response.json({ error: '请求格式不正确' }, { status: 400 }); }
  const id = typeof body?.shopId === 'string' ? body.shopId.trim() : '';
  if (!id || id.length > 200 || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > 2000) return Response.json({ error: '店铺或商品数据无效' }, { status: 400 });
  if (browserSyncInFlight.has(id)) return Response.json({ error: '店铺正在同步，请稍后再试' }, { status: 429 });
  browserSyncInFlight.add(id);
  try {
    const shop = await env.DB.prepare('SELECT * FROM shops WHERE id = ? LIMIT 1').bind(id).first<ShopRecord>();
    if (!shop) return Response.json({ error: '店铺不存在' }, { status: 404 });
    let source: URL;
    try { source = new URL(shop.shop_url); } catch { return Response.json({ error: '店铺地址无效' }, { status: 400 }); }
    if (!['wzyp.cn', 'pay.ldxp.cn', 'catfk.com', 'www.catfk.com'].includes(source.hostname.toLowerCase()) || !/^\/shop\/[a-zA-Z0-9_-]+\/?$/.test(source.pathname)) return Response.json({ error: '该店铺暂不支持浏览器同步' }, { status: 400 });
    const last = Date.parse(shop.last_synced_at || '');
    if (Number.isFinite(last) && Date.now() - last >= 0 && Date.now() - last < 5 * 60_000) return Response.json({ error: '店铺最近已同步，请 5 分钟后再试' }, { status: 429 });
    const allowedHost = source.hostname.toLowerCase().includes('catfk.com') ? 'catfk.com' : 'wzyp.cn';
    const input = body.items as Array<Record<string, unknown>>;
    const items: import('../types').RawOfferItem[] = [];
    const keys = new Set<string>();
    for (const item of input) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return Response.json({ error: '商品数据无效' }, { status: 400 });
      const key = typeof item.itemKey === 'string' ? item.itemKey.trim() : '';
      const name = typeof item.rawName === 'string' ? item.rawName.trim() : '';
      const price = item.price;
      if (!key || key.length > 180 || !name || name.length > 500 || typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price >= 99999 || keys.has(key)) return Response.json({ error: '商品字段无效或重复' }, { status: 400 });
      keys.add(key);
      const stock = typeof item.stockCount === 'number' && Number.isSafeInteger(item.stockCount) && item.stockCount >= 0 ? item.stockCount : null;
      let itemUrl = `https://${allowedHost}/item/${encodeURIComponent(key)}`;
      if (typeof item.itemUrl === 'string' && item.itemUrl) {
        try { const u = new URL(item.itemUrl); if (u.protocol !== 'https:' || ![allowedHost, ...(allowedHost === 'catfk.com' ? ['www.catfk.com'] : ['pay.ldxp.cn'])].includes(u.hostname.toLowerCase()) || u.port || u.username || u.password) return Response.json({ error: '商品链接域名不匹配' }, { status: 400 }); itemUrl = u.href; } catch { return Response.json({ error: '商品链接无效' }, { status: 400 }); }
      }
      items.push({ itemKey: key, rawName: name, shopCategory: typeof item.shopCategory === 'string' ? item.shopCategory.slice(0, 200) : '', price, stockCount: stock, stockStatus: stock !== null && stock <= 5 ? 'low' : stock !== null && stock <= 20 ? 'normal' : 'sufficient', itemUrl });
    }
    const previous = await env.DB.prepare('SELECT id,raw_name,shop_category,price,stock_count,stock_status,item_url FROM offers WHERE shop_id = ?').bind(id).all<{id:string;raw_name:string;shop_category:string;price:number;stock_count:number|null;stock_status:string;item_url:string}>();
    for (const row of previous.results || []) {
      const key = row.id.startsWith(`${id}:`) ? row.id.slice(id.length + 1) : '';
      if (!key || keys.has(key)) continue;
      items.push({ itemKey:key, rawName:row.raw_name, shopCategory:row.shop_category, price:Number(row.price), stockCount:row.stock_count, stockStatus:row.stock_status === 'low' || row.stock_status === 'normal' ? row.stock_status : 'sufficient', itemUrl:row.item_url });
    }
    if (items.length > 2000) return Response.json({ error: '合并后商品超过 2000 件，请使用管理员同步' }, { status: 400 });
    const incomingName = typeof body.shopName === 'string' ? hideTelegramContacts(body.shopName.trim()).slice(0, 120) : '';
    const displayName = shop.id.startsWith('submitted-') && shop.sync_state === 'pending' && incomingName ? incomingName : shop.shop_name;
    const result = await persistShopSnapshot(env.DB, shop, { shopName:displayName, canonicalUrl:shop.canonical_url, telegram:shop.telegram || '', shopSellCount:shop.shop_sell_count, salesVisible:!!shop.sales_visible, depositVisible:!!shop.deposit_visible, depositMoney:shop.deposit_money, items }, new Date().toISOString());
    return Response.json({ ok:true, status:result.status, itemCount:result.itemCount });
  } finally { browserSyncInFlight.delete(id); }
}

/**
 * DELETE /api/admin/shops/:id - 管理员下架指定店铺并级联清理商品组
 */
async function handleAdminDeleteShop(shopId: string, request: Request, env: Env): Promise<Response> {
  const auth = await verifyAdminSecret(request, env);
  if (!auth.ok) {
    return Response.json({ error: auth.message }, { status: auth.status });
  }

  const cleanId = shopId.trim();
  if (!cleanId) {
    return Response.json({ error: "缺少店铺 ID" }, { status: 400 });
  }

  const result = await deleteShopById(env.DB, cleanId);
  if (!result.deleted) {
    return Response.json({ error: "店铺不存在" }, { status: 404 });
  }

  return Response.json({ ok: true, deleted: true, shopId: cleanId });
}

/**
 * POST /api/ingest - 接收本地/国内采集脚本推送的店铺快照切片
 */
async function handlePostIngest(request: Request, env: Env): Promise<Response> {
  const auth = await verifyAdminSecret(request, env);
  if (!auth.ok) {
    return Response.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as
    | { shops?: PushedShopEntry[] }
    | PushedShopEntry
    | null;

  if (!body) {
    return Response.json({ error: "请求体必须为合法 JSON" }, { status: 400 });
  }

  const rawEntries: PushedShopEntry[] = Array.isArray((body as { shops?: unknown }).shops)
    ? (body as { shops: PushedShopEntry[] }).shops
    : [body as PushedShopEntry];

  if (rawEntries.length === 0) {
    return Response.json({ error: "shops 列表不能为空" }, { status: 400 });
  }
  if (rawEntries.length > 5) {
    return Response.json({ error: "为控制 Workers Free 10ms CPU 上限，单次最多推送 5 家店铺" }, { status: 400 });
  }

  for (const entry of rawEntries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return Response.json({ error: "shops 元素必须为对象" }, { status: 400 });
    }
    if (typeof entry.shopId !== "string" || !entry.shopId.trim() || typeof entry.shopUrl !== "string" || !isValidHttpUrl(entry.shopUrl)) {
      return Response.json({ error: "店铺必须提供非空 shopId 和有效 shopUrl" }, { status: 400 });
    }
    // 显式空数组表示清空店铺；缺失或损坏的 items 不能被当作清空指令。
    if (entry.snapshot !== undefined && (!entry.snapshot || typeof entry.snapshot !== "object" || Array.isArray(entry.snapshot) || !Array.isArray(entry.snapshot.items))) {
      return Response.json({ error: "snapshot 必须为对象且包含 items 数组" }, { status: 400 });
    }
    if (entry.snapshot?.items) {
      for (const snapItem of entry.snapshot.items) {
        if (
          !snapItem ||
          typeof snapItem !== "object" ||
          Array.isArray(snapItem) ||
          typeof snapItem.itemKey !== "string" ||
          !snapItem.itemKey.trim() ||
          typeof snapItem.rawName !== "string" ||
          typeof snapItem.price !== "number" ||
          !Number.isFinite(snapItem.price)
        ) {
          return Response.json({ error: "snapshot.items 元素必须包含有效的 itemKey、rawName 与有限数字 price" }, { status: 400 });
        }
      }
    }
    if (entry.snapshot?.description !== undefined && typeof entry.snapshot.description !== "string") {
      return Response.json({ error: "snapshot.description 必须为字符串" }, { status: 400 });
    }
    if (entry.partial !== undefined && typeof entry.partial !== "boolean") return Response.json({ error: "partial 必须为布尔值" }, { status: 400 });
    if (entry.partial && !entry.snapshot) return Response.json({ error: "partial 需要商品快照" }, { status: 400 });
    if (entry.error !== undefined && typeof entry.error !== "string") {
      return Response.json({ error: "error 必须为字符串" }, { status: 400 });
    }
    if (entry.systemType !== undefined) {
      const normalized = normalizeShopSystem(entry.systemType);
      if (!normalized) return Response.json({ error: "不支持的系统类型", allowedSystemTypes: SHOP_SYSTEMS }, { status: 400 });
      entry.systemType = normalized;
    }
  }

  let batchItemsTotal = 0;
  const sanitized: PushedShopEntry[] = rawEntries.map((entry) => {
    const cleanEntry: PushedShopEntry = {
      ...entry,
      shopId: entry.shopId.trim(),
      shopUrl: entry.shopUrl.trim(),
    };
    if (!cleanEntry.snapshot) {
      return cleanEntry;
    }
    const snap = cleanEntry.snapshot;
    const items = snap.items.slice(0, 2000).map((it) => ({
      ...it,
      itemKey: it.itemKey.trim(),
      shopCategory: typeof it.shopCategory === "string" ? it.shopCategory : "",
      stockCount: typeof it.stockCount === "number" && Number.isFinite(it.stockCount) ? it.stockCount : null,
      stockStatus: it.stockStatus === "low" || it.stockStatus === "normal" || it.stockStatus === "sufficient" ? it.stockStatus : "sufficient",
      itemUrl: typeof it.itemUrl === "string" ? it.itemUrl : cleanEntry.shopUrl,
    }));
    batchItemsTotal += items.length;
    const description =
      typeof snap.description === "string"
        ? normalizeDescription(snap.description).slice(0, 5000)
        : undefined;
    return {
      ...cleanEntry,
      snapshot: {
        ...snap,
        shopName: typeof snap.shopName === "string" && snap.shopName ? snap.shopName : new URL(cleanEntry.shopUrl).hostname,
        canonicalUrl: typeof snap.canonicalUrl === "string" && snap.canonicalUrl ? snap.canonicalUrl : cleanEntry.shopUrl,
        telegram: typeof snap.telegram === "string" ? snap.telegram : "",
        shopSellCount: typeof snap.shopSellCount === "number" && Number.isFinite(snap.shopSellCount) ? snap.shopSellCount : null,
        salesVisible: Boolean(snap.salesVisible),
        depositVisible: Boolean(snap.depositVisible),
        depositMoney: typeof snap.depositMoney === "number" && Number.isFinite(snap.depositMoney) ? snap.depositMoney : null,
        ...(description !== undefined ? { description } : {}),
        items,
      },
    };
  });

  if (rawEntries.length > 1 && batchItemsTotal > 1500) {
    return Response.json(
      { error: "单次合并推送商品总数超过 1500 条，请将超大店铺单独分批推送" },
      { status: 400 },
    );
  }

  if (sanitized.some((entry) => entry.systemType !== undefined) && !await hasShopSystemColumn(env.DB)) {
    return Response.json({ error: "系统类型数据库迁移尚未完成，请完成迁移后重试", code: "SHOP_SYSTEM_MIGRATION_PENDING" }, { status: 503 });
  }
  const summary = await ingestPushedSnapshots(env, sanitized);
  return Response.json(summary);
}

/**
 * POST /api/sync - 管理员手动触发服务端抓取批处理（带鉴权）
 */
async function handlePostSync(request: Request, env: Env): Promise<Response> {
  const auth = await verifyAdminSecret(request, env);
  if (!auth.ok) {
    return Response.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => ({}))) as { shopId?: string };
  const summary = await runSyncBatch(env, "manual", body?.shopId);
  return Response.json(summary);
}

function inferProbeAdapterType(parsedUrl: URL): AdapterType {
  const host = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname.toLowerCase();
  if (host === "pay.ldxp.cn" || host === "wzyp.cn" || host === "catfk.com" || /^\/shop\/[^/]+/.test(path)) {
    return "shop_api";
  }
  if (path.endsWith("/api/catalog")) {
    return "ka123_api";
  }
  if (path.endsWith(".json")) {
    return "json_api";
  }
  return "json_ld";
}

/**
 * POST /api/admin/shops/probe - 管理员只读试采校验接口（0 D1 读写，支持接入前结构化预检与 SSRF 防护）
 */
async function handleAdminProbeShop(request: Request, env: Env): Promise<Response> {
  const auth = await verifyAdminSecret(request, env);
  if (!auth.ok) {
    return Response.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as {
    shopUrl?: unknown;
    canonicalUrl?: unknown;
    adapterType?: unknown;
  } | null;

  const shopUrl = typeof body?.shopUrl === "string" ? body.shopUrl.trim() : "";
  if (!shopUrl || !isValidHttpUrl(shopUrl)) {
    return Response.json({ error: "请提供合法的 HTTP(S) shopUrl" }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = assertSafePublicUrl(shopUrl);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "目标 URL 未通过公网安全校验" },
      { status: 400 },
    );
  }

  const canonicalUrl =
    typeof body?.canonicalUrl === "string" && body.canonicalUrl.trim()
      ? body.canonicalUrl.trim()
      : shopUrl;
  if (!isValidHttpUrl(canonicalUrl)) {
    return Response.json({ error: "canonicalUrl 必须为合法的 HTTP(S) 链接" }, { status: 400 });
  }

  const requestedAdapter =
    body?.adapterType === undefined || body?.adapterType === ""
      ? inferProbeAdapterType(parsedUrl)
      : (String(body.adapterType).trim() as AdapterType);

  if (!ALLOWED_ADAPTERS.has(requestedAdapter)) {
    return Response.json({ error: `不支持的适配器类型: ${requestedAdapter}` }, { status: 400 });
  }

  const adapter = resolveAdapter(requestedAdapter);
  if (!adapter) {
    return Response.json(
      { error: `适配器 ${requestedAdapter} 不支持自动抓取试采（仅支持主动抓取类适配器）` },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();
  const virtualShop: ShopRecord = {
    id: "probe",
    shop_name: parsedUrl.hostname,
    shop_url: shopUrl,
    canonical_url: canonicalUrl,
    adapter_type: requestedAdapter,
    system_type: inferShopSystem(shopUrl, canonicalUrl),
    telegram: "",
    description: "",
    sync_supported: 1,
    sync_state: "pending",
    content_hash: "",
    last_synced_at: null,
    next_sync_at: nowIso,
    consecutive_failures: 0,
    last_error: "",
    stale_days: 0,
    shop_sell_count: null,
    sales_visible: 0,
    deposit_visible: 0,
    deposit_money: null,
    product_count: 0,
    product_summary_json: "[]",
    created_at: null,
    updated_at: nowIso,
  };

  try {
    const snapshot = await adapter.fetchSnapshot(virtualShop, env);
    const validRawItems = snapshot.items.filter(
      (item) => !isNonSalePlaceholderItem(item.rawName, item.shopCategory, item.price),
    );
    const filteredPlaceholderCount = snapshot.items.length - validRawItems.length;
    const sampleOffers = validRawItems.slice(0, 5).map((item) => {
      const normalized = normalizeOffer("probe", item, nowIso);
      return {
        cleanName: normalized.cleanName,
        brandGroup: normalized.brandGroup,
        attrType: normalized.attrType,
        attrPlan: normalized.attrPlan,
        attrDuration: normalized.attrDuration,
        price: normalized.price,
        stockStatus: normalized.stockStatus,
      };
    });
    const systemType = inferShopSystem(shopUrl, snapshot.canonicalUrl || canonicalUrl);

    return Response.json({
      ok: true,
      dryRun: true,
      adapterType: requestedAdapter,
      systemType,
      systemTypeLabel: SHOP_SYSTEMS[systemType],
      shopName: snapshot.shopName,
      canonicalUrl: snapshot.canonicalUrl,
      description: snapshot.description ?? "",
      telegram: snapshot.telegram,
      shopSellCount: snapshot.shopSellCount,
      depositMoney: snapshot.depositMoney,
      rawItemCount: snapshot.items.length,
      filteredPlaceholderCount,
      validItemCount: validRawItems.length,
      sampleOffers,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        dryRun: true,
        adapterType: requestedAdapter,
        shopUrl,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 422 },
    );
  }
}

/**
 * GET /api/sync/logs - 只读同步执行摘要（用于运维排查，返回脱敏汇总统计）
 */
async function handleGetSyncLogs(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, trigger_source, processed_count, skipped_unchanged, updated_count, failed_count, estimated_d1_writes, created_at FROM sync_runs ORDER BY created_at DESC LIMIT 15",
  ).all<Record<string, unknown>>();

  return jsonPublic(
    {
      logs: (results || []).map((row) => ({
        id: row.id,
        triggerSource: row.trigger_source,
        processedCount: Number(row.processed_count ?? 0),
        skippedUnchanged: Number(row.skipped_unchanged ?? 0),
        updatedCount: Number(row.updated_count ?? 0),
        failedCount: Number(row.failed_count ?? 0),
        estimatedD1Writes: Number(row.estimated_d1_writes ?? 0),
        createdAt: row.created_at,
      })),
    },
    10,
  );
}

/**
 * 路由总入口（处理所有 /api/* 动态请求）
 */
export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === 'GET' && pathname === '/api/control/product-ranking-preview') {
    if (!await adminAuthenticated(request,env.DB)) return Response.json({error:'请先登录'},{status:401,headers:{'Cache-Control':'no-store'}});
    const query=(url.searchParams.get('q') || '').trim();
    if (!query || query.length>120) return Response.json({error:'请输入不超过 120 个字符的搜索词'},{status:400,headers:{'Cache-Control':'no-store'}});
    const previewUrl=new URL('/api/products',url); previewUrl.searchParams.set('q',query); previewUrl.searchParams.set('sort','relevance'); previewUrl.searchParams.set('pageSize','30');
    const [original,updated] = await Promise.all([handleGetProducts(previewUrl,env,false),handleGetProducts(previewUrl,env,true)]);
    if (!original.ok || !updated.ok) return Response.json({error:'排序预览暂不可用'},{status:503,headers:{'Cache-Control':'no-store'}});
    const baseline=await original.json() as {items:Array<{id:string;name:string;shopCount:number;minPrice:number}>};
    const adjusted=await updated.json() as {items:Array<{id:string;name:string;shopCount:number;minPrice:number;offers:Array<{shopId?:string}>}>};
    const positions=new Map(baseline.items.map((item,index)=>[item.id,index+1]));
    const scoring=buildProductRelevanceOrder(query), expression=/^ORDER BY \((.*)\) DESC, /.exec(scoring.orderSql)?.[1];
    const scores=new Map<string,number>();
    if (expression && adjusted.items.length) {
      const {results}=await env.DB.prepare(`SELECT group_key, (${expression}) AS score FROM product_groups WHERE group_key IN (SELECT value FROM json_each(?))`)
        .bind(...scoring.params,JSON.stringify(adjusted.items.map(item=>item.id))).all<{group_key:string;score:number}>();
      for(const row of results || []) scores.set(row.group_key,Number(row.score));
    }
    const cfg=await adminSettings(env.DB);
    const {results:recommended}=await env.DB.prepare(`SELECT s.id FROM shops s JOIN shop_rank_settings r ON r.shop_id=s.id
      WHERE r.favorite_count>0 OR (?=1 AND r.manual_rank IS NOT NULL)
      ORDER BY CASE WHEN ?=1 AND r.manual_rank IS NOT NULL THEN 0 ELSE 1 END,CASE WHEN ?=1 THEN r.manual_rank END ASC,
      r.favorite_count DESC,CASE WHEN r.favorite_count=0 THEN s.last_synced_at END DESC,s.product_count DESC,s.id ASC LIMIT 20`)
      .bind(cfg.manual_rank_enabled,cfg.manual_rank_enabled,cfg.manual_rank_enabled).all<{id:string}>();
    const ranks=new Map((recommended || []).map((row,index)=>[row.id,index]));
    return Response.json({items:adjusted.items.map((item,index)=>{
      const bonus=Math.max(0,...(item.offers || []).map(offer=>ranks.has(String(offer.shopId)) ? 4/(1+ranks.get(String(offer.shopId))!*0.1) : 0));
      return {id:item.id,name:item.name,shopCount:item.shopCount,minPrice:item.minPrice,rank:index+1,previousRank:positions.get(item.id) ?? null,textScore:scores.get(item.id) ?? null,shopBonus:Number(bonus.toFixed(2))};
    })},{headers:{'Cache-Control':'no-store'}});
  }

  const control = await handleAdminRoute(request, env);
  if (control) return control;

  if (request.method === "GET" && pathname === "/api/products") {
    return handleGetProducts(url, env);
  }
  if (request.method === "GET" && pathname === "/api/shops") {
    return handleGetShops(url, env);
  }

  const shopDetailMatch = pathname.match(/^\/api\/shops\/([^/]+)\/products$/);
  if (request.method === "GET" && shopDetailMatch) {
    const shopId = safeDecodeRouteParam(shopDetailMatch[1]);
    if (!shopId) {
      return Response.json({ error: "非法的店铺路径参数" }, { status: 400 });
    }
    return handleGetShopDetail(shopId, env);
  }

  const shopIntroMatch = pathname.match(/^\/api\/shops\/([^/]+)$/);
  if (request.method === "GET" && shopIntroMatch) {
    const shopId = safeDecodeRouteParam(shopIntroMatch[1]);
    if (!shopId) {
      return Response.json({ error: "非法的店铺路径参数" }, { status: 400 });
    }
    return handleGetShopIntro(shopId, env);
  }

  if (request.method === "POST" && pathname === "/api/shops/browser-sync") {
    return handleBrowserShopSync(request, env);
  }

  if (request.method === "POST" && pathname === "/api/shops/submit") {
    return handlePublicShopSubmission(request, env);
  }

  if (request.method === "POST" && pathname === "/api/admin/shops") {
    return handleAdminUpsertShops(request, env);
  }
  if (request.method === "POST" && pathname === "/api/admin/shops/probe") {
    return handleAdminProbeShop(request, env);
  }

  const adminDeleteMatch = pathname.match(/^\/api\/admin\/shops\/([^/]+)$/);
  if (request.method === "DELETE" && adminDeleteMatch) {
    const shopId = safeDecodeRouteParam(adminDeleteMatch[1]);
    if (!shopId) {
      return Response.json({ error: "非法的店铺路径参数" }, { status: 400 });
    }
    return handleAdminDeleteShop(shopId, request, env);
  }

  if (request.method === "POST" && pathname === "/api/ingest") {
    return handlePostIngest(request, env);
  }
  if (request.method === "POST" && pathname === "/api/sync") {
    return handlePostSync(request, env);
  }
  if (request.method === "GET" && pathname === "/api/sync/logs") {
    return handleGetSyncLogs(env);
  }

  return Response.json({ error: "API route not found" }, { status: 404 });
}
