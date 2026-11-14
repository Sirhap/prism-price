import { PRODUCT_GROUPS } from "../types";

/** 允许的商品类型规范枚举（已将 cdk 合并至 recharge） */
export const PRODUCT_TYPE_OPTIONS = ["ready", "recharge", "api", "sms-service", "tutorial"] as const;
export type ProductTypeOption = (typeof PRODUCT_TYPE_OPTIONS)[number];

/** 允许的套餐规范枚举（已移除 advanced/codex/k12，并将 business 合并至 team） */
export const PRODUCT_PLAN_OPTIONS = ["free", "plus", "pro", "ultra", "team", "pro5", "pro20"] as const;
export type ProductPlanOption = (typeof PRODUCT_PLAN_OPTIONS)[number];

/** 允许的时长规范枚举 */
export const PRODUCT_DURATION_OPTIONS = ["day", "week", "month", "quarter", "half-year", "year"] as const;
export type ProductDurationOption = (typeof PRODUCT_DURATION_OPTIONS)[number];

/** 允许的价格区间规范枚举 */
export const PRODUCT_PRICE_OPTIONS = ["under-10", "10-50", "50-150", "150-500", "500-plus"] as const;
export type ProductPriceOption = (typeof PRODUCT_PRICE_OPTIONS)[number];

/** 允许的排序方式（shop-desc 已合并为 relevance 别名） */
export const PRODUCT_SORT_OPTIONS = ["relevance", "price-asc", "updated-desc"] as const;
export type ProductSortOption = (typeof PRODUCT_SORT_OPTIONS)[number];

/** 不存在订阅套餐概念的品牌分组（切换至这些分组时清除 plan） */
export const NON_PLAN_GROUPS: ReadonlySet<string> = new Set([
  "Muse",
  "AI视频",
  "AI绘图",
  "AI音乐",
  "影音会员",
  "社交会员",
  "网盘服务",
  "生活优惠",
  "手机卡",
  "游戏商品",
  "AI创作",
  "DeepSeek",
  "中转",
  "虚拟卡",
  "代理IP",
  "邮箱账号",
  "平台账号",
  "接码服务",
  "云手机",
  "软件工具",
  "数字素材",
  "工具教程",
]);

/** 不存在套餐周期概念的品牌分组（切换至这些分组时清除 duration） */
export const NON_DURATION_GROUPS: ReadonlySet<string> = new Set([
  "生活优惠",
  "手机卡",
  "游戏商品",
  "虚拟卡",
  "邮箱账号",
  "平台账号",
  "中转",
  "数字素材",
  "工具教程",
]);

/** 主分类前端展示别名映射 */
export const GROUP_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  AI创作: "AI 视频 / 创作",
  中转: "中转额度",
  代理IP: "代理 / IP",
  工具教程: "工具与教程",
};

const PRODUCT_TYPE_SET: ReadonlySet<string> = new Set(PRODUCT_TYPE_OPTIONS);
export const PRODUCT_PLAN_SET: ReadonlySet<string> = new Set(PRODUCT_PLAN_OPTIONS);
const PRODUCT_DURATION_SET: ReadonlySet<string> = new Set(PRODUCT_DURATION_OPTIONS);
const PRODUCT_PRICE_SET: ReadonlySet<string> = new Set(PRODUCT_PRICE_OPTIONS);
const PRODUCT_SORT_SET: ReadonlySet<string> = new Set(PRODUCT_SORT_OPTIONS);
const GROUP_CANONICAL_MAP = new Map<string, string>([
  ...PRODUCT_GROUPS.map((group) => [group.toLowerCase(), group] as const),
  ["ai 视频 / 创作", "AI创作"],
  ["ai视频/创作", "AI创作"],
  ["中转额度", "中转"],
  ["代理 / ip", "代理IP"],
  ["代理/ip", "代理IP"],
  ["工具与教程", "工具教程"],
]);

export interface AppliedProductFilters {
  q: string;
  group: string;
  type: string;
  plan: string;
  duration: string;
  price: string;
  sort: ProductSortOption;
}

export interface AppliedPriceRange {
  minPrice: number | null;
  maxPrice: number | null;
}

export interface NormalizedProductQuery {
  appliedFilters: AppliedProductFilters;
  appliedPriceRange: AppliedPriceRange;
  allowsPlan: boolean;
  allowsDuration: boolean;
}

/** 允许的店铺列表排序方式 */
export const SHOP_SORT_OPTIONS = ["default", "products-desc", "sales-desc", "updated-desc"] as const;
export type ShopSortOption = (typeof SHOP_SORT_OPTIONS)[number];
const SHOP_SORT_SET: ReadonlySet<string> = new Set(SHOP_SORT_OPTIONS);

/**
 * 规范化店铺列表排序参数；非法或空值统一回退为 "default"。
 */
export function normalizeShopSort(raw: string | null): ShopSortOption {
  const normalized = (raw || "").trim().toLowerCase();
  return SHOP_SORT_SET.has(normalized) ? (normalized as ShopSortOption) : "default";
}

/**
 * 解析自定义价格上下限参数（非负有限数值，保留 2 位小数，超出上限或非法返回 null）。
 */
export function parseCustomPriceBound(raw: string | null): number | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return null;
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0 || num >= 1_000_000) {
    return null;
  }
  return Math.round(num * 100) / 100;
}

/**
 * 规范化自定义价格区间；若下限大于上限则自动交换。
 */
export function normalizeCustomPriceRange(rawMin: string | null, rawMax: string | null): AppliedPriceRange {
  let minPrice = parseCustomPriceBound(rawMin);
  let maxPrice = parseCustomPriceBound(rawMax);
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  return { minPrice, maxPrice };
}

/**
 * 规范化品牌分组参数；非法值或 "all" 统一回退为 "all"。
 */
export function normalizeProductGroup(raw: string | null): string {
  const trimmed = (raw || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "all") {
    return "all";
  }
  return GROUP_CANONICAL_MAP.get(trimmed.toLowerCase()) || "all";
}

/**
 * 统一解析、兼容旧别名并按上下文联动清理商品筛选参数，避免出现失效或矛盾组合。
 */
export function normalizeProductQuery(params: URLSearchParams): NormalizedProductQuery {
  const q = (params.get("q") || "").trim();
  const group = normalizeProductGroup(params.get("group"));

  const rawType = (params.get("type") || "").trim().toLowerCase();
  const rawSms = (params.get("sms") || "").trim().toLowerCase();
  let type = rawType === "cdk" ? "recharge" : rawType;
  if (!PRODUCT_TYPE_SET.has(type)) {
    type = "all";
  }
  if (type === "all" && rawSms === "service") {
    type = "sms-service";
  }

  const allowsPlan = !NON_PLAN_GROUPS.has(group) && type !== "sms-service" && type !== "api";
  const allowsDuration = !NON_DURATION_GROUPS.has(group);

  const rawPlan = (params.get("plan") || "").trim().toLowerCase();
  let plan = rawPlan === "business" ? "team" : rawPlan;
  if (!allowsPlan || !PRODUCT_PLAN_SET.has(plan)) {
    plan = "all";
  }

  const rawDuration = (params.get("duration") || "").trim().toLowerCase();
  const duration = allowsDuration && PRODUCT_DURATION_SET.has(rawDuration) ? rawDuration : "all";

  const appliedPriceRange = normalizeCustomPriceRange(params.get("minPrice"), params.get("maxPrice"));
  const hasCustomPrice = appliedPriceRange.minPrice !== null || appliedPriceRange.maxPrice !== null;
  const rawPrice = (params.get("price") || "").trim().toLowerCase();
  const price = !hasCustomPrice && PRODUCT_PRICE_SET.has(rawPrice) ? rawPrice : "all";

  const rawSort = (params.get("sort") || "").trim().toLowerCase();
  const mappedSort = rawSort === "shop-desc" ? "relevance" : rawSort;
  const sort: ProductSortOption = PRODUCT_SORT_SET.has(mappedSort)
    ? (mappedSort as ProductSortOption)
    : "relevance";

  return {
    appliedFilters: { q, group, type, plan, duration, price, sort },
    appliedPriceRange,
    allowsPlan,
    allowsDuration,
  };
}

/**
 * 限制关键词数量与长度，避免超过 D1 单条语句的绑定参数上限。
 */
export function searchTerms(query: string): string[] {
  return [...new Set(query.normalize("NFKC").toLowerCase().trim().split(/\s+/u))]
    .filter(Boolean).slice(0, 6).map((term) => term.slice(0, 80));
}

/**
 * 构造商品列表默认排序 SQL；当存在搜索词且 sort=relevance 时优先按搜索相关度排序。
 * 全部使用 = 与 INSTR(LOWER(...), ?)，不受 LIKE 50 字节限制且绑定参数严格可控（<= 28 个）。
 */
export function buildProductRelevanceOrder(query: string): { orderSql: string; params: string[] } {
  const tieBreaker = "shop_count DESC, min_price ASC, group_key ASC";
  const terms = searchTerms(query);
  if (terms.length === 0) {
    return {
      orderSql: `ORDER BY ${tieBreaker}`,
      params: [],
    };
  }

  const fullQuery = query.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ").slice(0, 120);
  const scoreParts: string[] = [
    "CASE WHEN LOWER(display_name) = ? THEN 120 ELSE 0 END",
    "CASE WHEN INSTR(LOWER(display_name), ?) = 1 THEN 60 ELSE 0 END",
    "CASE WHEN INSTR(LOWER(display_name), ?) > 0 THEN 35 ELSE 0 END",
    "CASE WHEN LOWER(brand_group) = ? THEN 45 ELSE 0 END",
  ];
  const params: string[] = [fullQuery, fullQuery, fullQuery, fullQuery];

  for (const term of terms) {
    scoreParts.push(
      "CASE WHEN INSTR(LOWER(display_name), ?) > 0 THEN 20 ELSE 0 END",
      "CASE WHEN INSTR(LOWER(brand_group), ?) > 0 THEN 12 ELSE 0 END",
      "CASE WHEN INSTR(LOWER(shop_category), ?) > 0 THEN 8 ELSE 0 END",
      "CASE WHEN INSTR(LOWER(lead_shop_name), ?) > 0 THEN 3 ELSE 0 END",
    );
    params.push(term, term, term, term);
  }

  return {
    orderSql: `ORDER BY (${scoreParts.join(" + ")}) DESC, ${tieBreaker}`,
    params,
  };
}

/** LIKE 中的用户输入始终按字面量处理。 */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * 构建字面包含匹配；column 必须来自内部列名或受控 SQL 表达式。
 * D1 的 LIKE pattern 限制按 UTF-8 字节计算，长词改用 INSTR 而不截断或丢失条件。
 */
export function containsMatch(column: string, term: string): { sql: string; value: string } {
  const pattern = containsPattern(term);
  if (new TextEncoder().encode(pattern).byteLength <= 50) {
    return { sql: `${column} LIKE ? ESCAPE '\\'`, value: pattern };
  }
  return { sql: `INSTR(LOWER(${column}), ?) > 0`, value: term };
}

export function positiveInteger(raw: string | null, fallback: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) || fallback : fallback;
}
