const RECENT_STOCK_MS = 24 * 60 * 60 * 1000;

interface StockFilter {
  hiddenOfferClause: string;
  groupsSql: string;
  params: string[];
}

/** Stock filters also exclude shops with an active closure observation. */
export async function resolveProductStockFilter(
  db: D1Database, hideRecent?: true, hideLastSync?: true,
): Promise<StockFilter | null> {
  if (!hideRecent && !hideLastSync) return null;
  const columns = await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM pragma_table_info('shops') WHERE name = 'last_full_sync_at') AS sync_times,
    EXISTS(SELECT 1 FROM pragma_table_info('shops') WHERE name = 'last_closed_at') AS closure_grace`)
    .first<{ sync_times: number; closure_grace: number }>();
  const clauses: string[] = [];
  const params: string[] = [];
  if (hideLastSync) {
    clauses.push("o.stock_count = 0");
    if (columns?.closure_grace) clauses.push("s.last_closed_at IS NOT NULL");
  } else {
    const cutoff = new Date(Date.now() - RECENT_STOCK_MS).toISOString();
    if (columns?.sync_times) {
      clauses.push("(o.stock_count = 0 AND (o.last_observed_at >= ? OR s.last_full_sync_at >= ?))");
      params.push(cutoff, cutoff);
    }
    if (columns?.closure_grace) {
      clauses.push("s.last_closed_at >= ?");
      params.push(cutoff);
    }
  }
  if (!clauses.length) return null;

  const hiddenOfferClause = clauses.join(" OR ");
  return { hiddenOfferClause, groupsSql: filteredGroupsSql(hiddenOfferClause), params };
}

/**
 * Reuse materialized groups except where a quote was filtered. Recompute those groups
 * before search, price filters and pagination including quotes beyond the stored preview.
 */
function filteredGroupsSql(hiddenOfferClause: string): string {
  return `WITH hidden_offers AS MATERIALIZED (
  SELECT o.id, o.group_key
  FROM offers o JOIN shops s ON s.id = o.shop_id
  WHERE ${hiddenOfferClause}
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
  FROM available_offers o JOIN shops s ON s.id = o.shop_id
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
  FROM product_groups p LEFT JOIN available_groups a ON a.group_key = p.group_key
  WHERE a.group_key IS NOT NULL OR p.group_key NOT IN (SELECT group_key FROM affected_groups)
)`;
}
