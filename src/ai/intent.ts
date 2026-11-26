import { PRODUCT_GROUPS, type ProductGroup } from "../types";

/** AI 助手可识别的意图类型 */
export type AiIntent = "compare" | "guide" | "mixed" | "chat";

/** 规则层抽出的原始筛选候选，后续统一交给 normalizeProductQuery 校验 */
export interface IntentFilters {
  group: string;
  type: string;
  plan: string;
  duration: string;
  price: string;
  sort: string;
  q: string;
}

export interface IntentClassification {
  intent: AiIntent;
  filters: IntentFilters;
  /** 命中的规则信号，便于调试与前端提示 */
  signals: string[];
}

export const EMPTY_FILTERS: IntentFilters = {
  group: "all",
  type: "all",
  plan: "all",
  duration: "all",
  price: "all",
  sort: "",
  q: "",
};

/**
 * 品牌/分类别名映射。键为小写别名，值为 PRODUCT_GROUPS 中的规范分组。
 * 匹配时按别名长度降序，避免「gpt」抢先于「gpt-4」这类长词。
 */
const BRAND_ALIAS_LIST: ReadonlyArray<readonly [string, ProductGroup]> = [
  ["chatgpt", "ChatGPT"], ["chat gpt", "ChatGPT"], ["gpt-4", "ChatGPT"], ["gpt4", "ChatGPT"],
  ["gpt", "ChatGPT"], ["openai", "ChatGPT"], ["奥特曼", "ChatGPT"],
  ["codex", "Codex"],
  ["claude", "Claude"], ["克劳德", "Claude"], ["anthropic", "Claude"], ["sonnet", "Claude"], ["opus", "Claude"], ["haiku", "Claude"],
  ["gemini", "Gemini"], ["双子星", "Gemini"], ["bard", "Gemini"],
  ["grok", "Grok"],
  ["cursor", "Cursor"],
  ["kiro", "Kiro"],
  ["antigravity", "Antigravity"],
  ["deepseek", "DeepSeek"], ["深度求索", "DeepSeek"],
  ["智谱", "智谱"], ["glm", "智谱"], ["chatglm", "智谱"],
  ["augment", "Augment"],
  ["perplexity", "Perplexity"],
  ["千问", "千问"], ["qwen", "千问"], ["通义", "千问"],
  ["minimax", "MiniMax"],
  ["sora", "AI视频"], ["runway", "AI视频"], ["pika", "AI视频"], ["视频生成", "AI视频"],
  ["midjourney", "AI绘图"], ["绘图", "AI绘图"], ["画图", "AI绘图"], ["stable diffusion", "AI绘图"],
  ["suno", "AI音乐"], ["音乐生成", "AI音乐"],
  ["api中转", "中转"], ["中转", "中转"],
  ["虚拟卡", "虚拟卡"],
  ["代理ip", "代理IP"], ["ip代理", "代理IP"], ["机场", "代理IP"], ["代理", "代理IP"],
  ["邮箱账号", "邮箱账号"], ["gmail", "邮箱账号"], ["outlook", "邮箱账号"],
  ["成品号", "平台账号"], ["平台账号", "平台账号"],
  ["短信接码", "接码服务"], ["接码平台", "接码服务"], ["接码服务", "接码服务"],
  ["云手机", "云手机"],
  ["软件工具", "软件工具"],
  ["数字素材", "数字素材"],
  ["工具教程", "工具教程"],
  ["手机卡", "手机卡"], ["流量卡", "手机卡"],
  ["游戏商品", "游戏商品"], ["点卡", "游戏商品"],
  ["netflix", "影音会员"], ["奈飞", "影音会员"], ["spotify", "影音会员"], ["影音", "影音会员"],
  ["telegram会员", "社交会员"], ["tg会员", "社交会员"], ["社交会员", "社交会员"],
  ["网盘", "网盘服务"], ["百度网盘", "网盘服务"],
  ["生活优惠", "生活优惠"], ["优惠券", "生活优惠"],
];
const BRAND_ALIASES: ReadonlyArray<readonly [string, ProductGroup]> = [...BRAND_ALIAS_LIST]
  .sort((a, b) => b[0].length - a[0].length);

/** 套餐别名 → PRODUCT_PLAN_OPTIONS */
const PLAN_ALIAS_LIST: ReadonlyArray<readonly [string, string]> = [
  ["pro20", "pro20"], ["pro5", "pro5"],
  ["plus", "plus"], ["加号", "plus"],
  ["professional", "pro"], ["pro", "pro"],
  ["ultra", "ultra"],
  ["team", "team"], ["团队", "team"], ["business", "team"],
  ["免费", "free"], ["free", "free"],
];
const PLAN_ALIASES: ReadonlyArray<readonly [string, string]> = [...PLAN_ALIAS_LIST]
  .sort((a, b) => b[0].length - a[0].length);

/** 时长别名 → PRODUCT_DURATION_OPTIONS */
const DURATION_ALIAS_LIST: ReadonlyArray<readonly [string, string]> = [
  ["half-year", "half-year"], ["半年", "half-year"], ["6个月", "half-year"],
  ["quarter", "quarter"], ["季度", "quarter"], ["3个月", "quarter"],
  ["month", "month"], ["月付", "month"], ["包月", "month"], ["月度", "month"],
  ["week", "week"], ["周付", "week"], ["星期", "week"],
  ["day", "day"], ["日付", "day"], ["包天", "day"],
  ["year", "year"], ["年付", "year"], ["包年", "year"], ["年度", "year"],
];
const DURATION_ALIASES: ReadonlyArray<readonly [string, string]> = [...DURATION_ALIAS_LIST]
  .sort((a, b) => b[0].length - a[0].length);

/** 站点指南类意图的触发词 */
const GUIDE_KEYWORDS = [
  "开店", "入驻", "开铺", "对接码", "分销码", "货源", "收录", "提交店铺", "添加店铺",
  "赞助", "推广", "授权码", "投放", "怎么用", "如何", "教程", "规则", "安全吗", "靠谱吗",
] as const;

/** 比价类意图的触发词（品牌与套餐会单独识别） */
const COMPARE_KEYWORDS = [
  "比价", "报价", "价格", "多少钱", "哪家", "哪个店", "最便宜", "便宜", "低价", "性价比",
  "优惠", "库存", "有货", "缺货", "对比", "买", "月付", "年付", "套餐",
] as const;

const PRICE_LOW_PATTERN = /便宜|最低价|最便宜|低价|性价比|省钱/;
const PRICE_BAND_UNDER_10 = /(10|十)\s*(元|块)?\s*(以内|以下|内)/;
const PRICE_BAND_500_PLUS = /(500|五百)\s*(元|块)?\s*(以上|起)/;
const PRICE_RANGE_PATTERN = /(\d+)\s*(?:-|~|到|至)\s*(\d+)\s*(?:元|块)?/;

function normalizeText(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasEnglishWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(text);
}

function matchAlias<T>(text: string, aliases: ReadonlyArray<readonly [string, T]>): T | null {
  for (const [alias, value] of aliases) {
    if (/^[a-z0-9-]+$/.test(alias) ? hasEnglishWord(text, alias) : text.includes(alias)) {
      return value;
    }
  }
  return null;
}

function detectPriceBand(text: string): string {
  if (PRICE_BAND_UNDER_10.test(text)) return "under-10";
  if (PRICE_BAND_500_PLUS.test(text)) return "500-plus";
  const range = PRICE_RANGE_PATTERN.exec(text);
  if (!range) return "all";
  const low = Number(range[1]);
  if (low < 10) return "under-10";
  if (low < 50) return "10-50";
  if (low < 150) return "50-150";
  if (low < 500) return "150-500";
  return "500-plus";
}

/**
 * 规则前置的意图分类：能靠关键词确定的绝不调用模型，节省 Workers AI 免费额度。
 */
export function classifyIntent(question: string): IntentClassification {
  const text = normalizeText(question);
  const signals: string[] = [];

  const group = matchAlias(text, BRAND_ALIASES);
  const plan = matchAlias(text, PLAN_ALIASES);
  const duration = matchAlias(text, DURATION_ALIASES);
  const price = detectPriceBand(text);

  if (group) signals.push(`brand:${group}`);
  if (plan) signals.push(`plan:${plan}`);
  if (duration) signals.push(`duration:${duration}`);
  if (price !== "all") signals.push(`price:${price}`);

  const guideHits = GUIDE_KEYWORDS.filter((keyword) => text.includes(keyword));
  const compareHits = COMPARE_KEYWORDS.filter((keyword) => text.includes(keyword));
  const hasPriceWord = PRICE_LOW_PATTERN.test(text) || compareHits.length > 0;
  const hasCompareSignal = Boolean(group) || Boolean(plan) || Boolean(duration) || price !== "all" || hasPriceWord;

  signals.push(...guideHits.map((keyword) => `guide:${keyword}`));

  let intent: AiIntent;
  if (guideHits.length > 0 && hasCompareSignal) {
    // 有明确品牌/价格条件时按混合处理，否则「开店要多少钱」这类仍归为指南。
    intent = group || price !== "all" ? "mixed" : "guide";
  } else if (guideHits.length > 0) {
    intent = "guide";
  } else if (hasCompareSignal) {
    intent = "compare";
  } else {
    intent = "chat";
  }

  const filters: IntentFilters = {
    ...EMPTY_FILTERS,
    group: group ?? "all",
    plan: plan ?? "all",
    duration: duration ?? "all",
    price,
    sort: PRICE_LOW_PATTERN.test(text) ? "price-asc" : "",
    q: "",
  };

  return { intent, filters, signals };
}

/**
 * 把已校验的筛选参数翻译成一句中文说明，供前端气泡展示。
 */
export function describeFilters(filters: IntentFilters): string {
  const parts: string[] = [];
  if (filters.group !== "all") parts.push(filters.group);
  if (filters.type !== "all") parts.push(filters.type === "recharge" ? "充值/卡密" : filters.type);
  if (filters.plan !== "all") parts.push(filters.plan.toUpperCase());
  const durationLabels: Record<string, string> = {
    day: "按天", week: "按周", month: "按月", quarter: "按季度", "half-year": "半年", year: "按年",
  };
  if (filters.duration !== "all") parts.push(durationLabels[filters.duration] ?? filters.duration);
  const priceLabels: Record<string, string> = {
    "under-10": "10 元以内", "10-50": "10–50 元", "50-150": "50–150 元", "150-500": "150–500 元", "500-plus": "500 元以上",
  };
  if (filters.price !== "all") parts.push(priceLabels[filters.price] ?? filters.price);
  if (filters.sort === "price-asc") parts.push("价格从低到高");
  if (filters.q) parts.push(`关键词「${filters.q}」`);
  return parts.length > 0 ? parts.join(" · ") : "全部商品";
}

/** 供测试与复用：判断文本是否只包含指南意图 */
export function isGuideQuestion(question: string): boolean {
  const text = normalizeText(question);
  return GUIDE_KEYWORDS.some((keyword) => text.includes(keyword));
}

export const AI_KNOWN_GROUPS: readonly string[] = PRODUCT_GROUPS;
