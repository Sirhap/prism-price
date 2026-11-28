const RECENT_STOCK_MS = 24 * 60 * 60 * 1000;
export const STOCK_CATALOG_WINDOW_SECONDS = 30;

export function stockCatalogWindowStart(time: number): number {
  const windowMs = STOCK_CATALOG_WINDOW_SECONDS * 1000;
  return Math.floor(time / windowMs) * windowMs;
}

interface StockFilter {
  hiddenOfferClause: string;
  hiddenOffersSql: string;
  groupsSql: string;
  pageGroupsSql: string;
  params: string[];
}

/** Stock filters also exclude shops with an active closure observation. */
export async function resolveProductStockFilter(
  db: D1Database, hideRecent?: true, hideLastSync?: true, asOf = Date.now(),
): Promise<StockFilter | null> {
  if (!hideRecent && !hideLastSync) return null;
  const columns = await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM pragma_table_info('shops') WHERE name = 'last_full_sync_at') AS sync_times,
    EXISTS(SELECT 1 FROM pragma_table_info('shops') WHERE name = 'last_closed_at') AS closure_grace`)
    .first<{ sync_times: number; closure_grace: number }>();
  const stockCondition = hideLastSync
    ? "o.stock_count = 0"
    : columns?.sync_times ? "o.stock_count = 0 AND (o.last_observed_at >= ? OR s.last_full_sync_at >= ?)" : "";
  const closureCondition = columns?.closure_grace
    ? hideLastSync ? "s.last_closed_at IS NOT NULL" : "s.last_closed_at >= ?"
    : "";
  if (!stockCondition && !closureCondition) return null;

  const params: string[] = [];
  if (!hideLastSync) {
    const cutoff = new Date(asOf - RECENT_STOCK_MS).toISOString();
    if (stockCondition) params.push(cutoff, cutoff);
    if (closureCondition) params.push(cutoff);
  }

  const hiddenOfferClause = [stockCondition, closureCondition].filter(Boolean).map(condition => `(${condition})`).join(" OR ");
  // Separate candidates so SQLite can start from the partial stock and closure indexes.
  const hiddenSources: string[] = [];
  if (stockCondition) hiddenSources.push(`SELECT o.id, o.group_key FROM offers o
    CROSS JOIN shops s ON s.id = o.shop_id WHERE ${stockCondition}`);
  if (closureCondition) hiddenSources.push(`SELECT o.id, o.group_key FROM shops s
    CROSS JOIN offers o ON o.shop_id = s.id WHERE ${closureCondition}`);
  const hiddenOffersSql = hiddenSources.join(" UNION ALL ");
  const pageHiddenOffers = `SELECT o.id, o.group_key FROM requested_stock_groups k
    CROSS JOIN offers o ON o.group_key = k.group_key
    CROSS JOIN shops s ON s.id = o.shop_id WHERE ${hiddenOfferClause}`;
  return {
    hiddenOfferClause,
    hiddenOffersSql,
    groupsSql: filteredGroupsSql(hiddenOffersSql),
    pageGroupsSql: filteredGroupsSql(pageHiddenOffers, true),
    params,
  };
}

/** Only group fields used by the default list's counters and ordering. */
export function stockHomepageGroupsSql(hiddenOffersSql: string, recommendsShops: boolean): string {
  const recommendations = recommendsShops ? `recommended_shops AS MATERIALIZED (
    SELECT value AS shop_id, 4.0 / (1.0 + key * 0.1) AS bonus FROM json_each(?)
  ),` : "";
  const position = recommendsShops ? ", ROW_NUMBER() OVER (PARTITION BY o.group_key ORDER BY o.price, o.id) AS position" : "";
  const liveBonus = recommendsShops ? `, MAX((SELECT bonus FROM recommended_shops WHERE shop_id = o.shop_id))
    FILTER (WHERE o.position <= 12) AS bonus` : "";
  const groupColumns = "p.group_key, p.brand_group, p.attr_type, p.attr_plan, p.attr_duration, p.attr_sms";
  return `WITH hidden_offers AS MATERIALIZED (
    ${hiddenOffersSql}
  ), affected_groups AS MATERIALIZED (
    SELECT DISTINCT group_key FROM hidden_offers
  ), ${recommendations} available_offers AS (
    SELECT o.group_key, o.shop_id, o.price${position}
    FROM affected_groups a CROSS JOIN offers o ON o.group_key = a.group_key
    WHERE o.id NOT IN (SELECT id FROM hidden_offers)
  ), available_groups AS MATERIALIZED (
    SELECT o.group_key, MIN(o.price) AS min_price, COUNT(DISTINCT o.shop_id) AS shop_count,
      COUNT(*) AS offer_count${liveBonus}
    FROM available_offers o CROSS JOIN shops s ON s.id = o.shop_id
    GROUP BY o.group_key
  ), stock_home_groups AS (
    SELECT ${groupColumns}, p.min_price, p.offer_count
    FROM product_groups p WHERE p.group_key NOT IN (SELECT group_key FROM affected_groups)
    UNION ALL
    SELECT ${groupColumns}, a.min_price, a.offer_count
    FROM available_groups a CROSS JOIN product_groups p ON p.group_key = a.group_key
  )`;
}

/**
 * Reuse materialized groups except where a quote was filtered. Recompute those groups
 * before search, price filters and pagination including quotes beyond the stored preview.
 */
function filteredGroupsSql(hiddenOffers: string, pageOnly = false): string {
  const requestedGroups = pageOnly ? "requested_stock_groups(group_key) AS MATERIALIZED (SELECT value FROM json_each(?))," : "";
  const productSource = pageOnly
    ? "requested_stock_groups k CROSS JOIN product_groups p ON p.group_key = k.group_key"
    : "product_groups p";
  return `WITH ${requestedGroups} hidden_offers AS MATERIALIZED (
  ${hiddenOffers}
), affected_groups AS MATERIALIZED (
  SELECT DISTINCT group_key FROM hidden_offers
), available_offers AS (
  SELECT o.id, o.group_key, o.shop_id, o.price, o.stock_count, o.stock_status, o.item_url, o.updated_at,
    ROW_NUMBER() OVER (PARTITION BY o.group_key ORDER BY o.price, o.id) AS position,
    COUNT(*) OVER (PARTITION BY o.group_key) AS group_size
  FROM affected_groups a CROSS JOIN offers o ON o.group_key = a.group_key
  WHERE o.id NOT IN (SELECT id FROM hidden_offers)
), available_groups AS (
  SELECT o.group_key, MIN(o.price) AS min_price,
    AVG(o.price) FILTER (WHERE o.position IN ((o.group_size + 1) / 2, (o.group_size + 2) / 2)) AS median_price,
    MAX(o.price) AS max_price, COUNT(DISTINCT o.shop_id) AS shop_count, COUNT(*) AS offer_count,
    MAX(o.shop_id) FILTER (WHERE o.position = 1) AS lead_shop_id,
    MAX(s.shop_name) FILTER (WHERE o.position = 1) AS lead_shop_name,
    MAX(s.shop_url) FILTER (WHERE o.position = 1) AS lead_shop_url,
    MAX(o.item_url) FILTER (WHERE o.position = 1) AS lead_item_url,
    MAX(o.stock_status) FILTER (WHERE o.position = 1) AS stock_status,
    json_group_array(json_object(
      'id', o.id, 'shopId', o.shop_id, 'shopName', s.shop_name, 'shopUrl', s.shop_url,
      'price', o.price, 'stockCount', o.stock_count, 'stockStatus', o.stock_status,
      'itemUrl', o.item_url, 'updatedAt', o.updated_at, 'staleDays', s.stale_days,
      'shopProductCount', s.product_count
    ) ORDER BY o.position) FILTER (WHERE o.position <= 12) AS offers_preview_json
  FROM available_offers o CROSS JOIN shops s ON s.id = o.shop_id
  GROUP BY o.group_key
), stock_filtered_groups AS (
  SELECT p.group_key, p.display_name, p.brand_group, p.shop_category, p.attr_type,
    p.attr_plan, p.attr_duration, p.attr_warranty, p.attr_sms, p.attr_region, p.updated_at,
    COALESCE(a.min_price, p.min_price) AS min_price,
    COALESCE(a.median_price, p.median_price) AS median_price,
    COALESCE(a.max_price, p.max_price) AS max_price,
    COALESCE(a.shop_count, p.shop_count) AS shop_count,
    COALESCE(a.offer_count, p.offer_count) AS offer_count,
    COALESCE(a.lead_shop_id, p.lead_shop_id) AS lead_shop_id,
    COALESCE(a.lead_shop_name, p.lead_shop_name) AS lead_shop_name,
    COALESCE(a.lead_shop_url, p.lead_shop_url) AS lead_shop_url,
    COALESCE(a.lead_item_url, p.lead_item_url) AS lead_item_url,
    COALESCE(a.stock_status, p.stock_status) AS stock_status,
    COALESCE(a.offers_preview_json, p.offers_preview_json) AS offers_preview_json
  FROM ${productSource} LEFT JOIN available_groups a ON a.group_key = p.group_key
  WHERE a.group_key IS NOT NULL OR p.group_key NOT IN (SELECT group_key FROM affected_groups)
)`;
}
