import { PRODUCT_GROUPS } from "../types";
import { PRODUCT_DURATION_OPTIONS, PRODUCT_PLAN_SET, PRODUCT_TYPE_OPTIONS, type NormalizedProductQuery } from "./search";

export const TYPE_SQL_EXPR = "CASE WHEN attr_sms = 'service' THEN 'sms-service' WHEN attr_type = 'cdk' THEN 'recharge' ELSE attr_type END";
export const PLAN_SQL_EXPR = "CASE WHEN attr_plan = 'business' THEN 'team' WHEN attr_plan IN ('free', 'plus', 'pro', 'ultra', 'team', 'pro5', 'pro20') THEN attr_plan ELSE '' END";
const types = new Set<string>(PRODUCT_TYPE_OPTIONS);
const durations = new Set<string>(PRODUCT_DURATION_OPTIONS);

export interface ProductStatBucket {
  brand_group: string;
  normalized_type: string;
  normalized_plan: string;
  attr_duration: string;
  min_price: number;
  groups: number;
  offers: number;
  keys: string[];
}

interface ProductScopeRow extends Omit<ProductStatBucket, "groups" | "offers" | "keys"> {
  offer_count: number;
  group_key: string;
}

/** 一次紧凑投影扫描，内存合并规格/精确价格桶，避免 SQLite 临时排序表再计一次读取。 */
export async function loadProductBuckets(db: D1Database, searchWhere: string, params: Array<string | number>): Promise<ProductStatBucket[]> {
  const { results } = await db.prepare(`SELECT brand_group, (${TYPE_SQL_EXPR}) AS normalized_type,
    (${PLAN_SQL_EXPR}) AS normalized_plan, attr_duration, min_price, offer_count,
    group_key
    FROM product_groups ${searchWhere}`)
    .bind(...params).all<ProductScopeRow>();
  const buckets = new Map<string, ProductStatBucket>();
  for (const row of results) {
    const key = JSON.stringify([row.brand_group, row.normalized_type, row.normalized_plan, row.attr_duration, row.min_price]);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { brand_group: row.brand_group, normalized_type: row.normalized_type, normalized_plan: row.normalized_plan,
        attr_duration: row.attr_duration, min_price: row.min_price, groups: 0, offers: 0, keys: [] };
      buckets.set(key, bucket);
    }
    bucket.groups += 1;
    bucket.offers += Number(row.offer_count);
    bucket.keys.push(row.group_key);
  }
  return [...buckets.values()];
}

function priceBand(value: number): string {
  if (value < 10) return "under-10";
  if (value < 50) return "10-50";
  if (value < 150) return "50-150";
  if (value < 500) return "150-500";
  return "500-plus";
}

/** 从同一份桶数据计算替换本维度后的计数；精确价格保证自定义上下限不被区间近似。 */
export function summarizeProducts(buckets: readonly ProductStatBucket[], query: NormalizedProductQuery) {
  const { group, type, plan, duration, price } = query.appliedFilters;
  const { minPrice, maxPrice } = query.appliedPriceRange;
  const groups: Record<string, number> = Object.fromEntries(PRODUCT_GROUPS.map((name) => [name, 0]));
  const options: Record<"type" | "plan" | "duration", Record<string, number>> = { type: {}, plan: {}, duration: {} };
  const prices: Record<string, number> = { "under-10": 0, "10-50": 0, "50-150": 0, "150-500": 0, "500-plus": 0 };
  let total = 0;
  let offerTotal = 0;
  const groupKeys: string[] = [];
  const add = (target: Record<string, number>, key: string, count: number) => { target[key] = (target[key] || 0) + count; };
  for (const bucket of buckets) {
    const count = Number(bucket.groups);
    const band = priceBand(Number(bucket.min_price));
    const matchGroup = group === "all" || group === bucket.brand_group;
    const matchType = type === "all" || type === bucket.normalized_type;
    const matchPlan = plan === "all" || plan === bucket.normalized_plan;
    const matchDuration = duration === "all" || duration === bucket.attr_duration;
    const matchPrice = minPrice !== null || maxPrice !== null
      ? (minPrice === null || bucket.min_price >= minPrice) && (maxPrice === null || bucket.min_price <= maxPrice)
      : price === "all" || price === band;
    if (matchType && matchPlan && matchDuration && matchPrice && bucket.brand_group in groups) add(groups, bucket.brand_group, count);
    if (matchGroup && matchPlan && matchDuration && matchPrice && types.has(bucket.normalized_type)) add(options.type, bucket.normalized_type, count);
    if (query.allowsPlan && matchGroup && matchType && matchDuration && matchPrice && PRODUCT_PLAN_SET.has(bucket.normalized_plan)) add(options.plan, bucket.normalized_plan, count);
    if (query.allowsDuration && matchGroup && matchType && matchPlan && matchPrice && durations.has(bucket.attr_duration)) add(options.duration, bucket.attr_duration, count);
    if (matchGroup && matchType && matchPlan && matchDuration) add(prices, band, count);
    if (matchGroup && matchType && matchPlan && matchDuration && matchPrice) {
      total += count;
      offerTotal += Number(bucket.offers);
      for (const key of bucket.keys) groupKeys.push(key);
    }
  }
  return { total, offerTotal, groupKeys, facets: { groups, options, prices } };
}

export function catalogGroups(buckets: readonly ProductStatBucket[]): Record<string, number> {
  const groups: Record<string, number> = Object.fromEntries(PRODUCT_GROUPS.map((name) => [name, 0]));
  for (const bucket of buckets) if (bucket.brand_group in groups) groups[bucket.brand_group] += Number(bucket.groups);
  return groups;
}
