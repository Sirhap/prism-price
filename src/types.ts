/**
 * 商品主分类；前端目录保持相同顺序。
 */
export const PRODUCT_GROUPS = [
  "ChatGPT",
  "Codex",
  "Claude",
  "Gemini",
  "Grok",
  "Cursor",
  "Kiro",
  "Antigravity",
  "DeepSeek",
  "Muse",
  "智谱",
  "Augment",
  "Perplexity",
  "千问",
  "AI视频",
  "AI绘图",
  "AI音乐",
  "AI创作",
  "中转",
  "虚拟卡",
  "代理IP",
  "邮箱账号",
  "平台账号",
  "工具教程",
  "手机卡",
  "游戏商品",
  "影音会员",
  "网盘服务",
  "生活优惠",
  "其它",
] as const;

export type ProductGroup = (typeof PRODUCT_GROUPS)[number];

export type AdapterType =
  | "shop_api"
  | "ka123_api"
  | "json_api"
  | "ssr_html"
  | "json_ld"
  | "push_ingest"
  | "manual";

export type StockStatus = "sufficient" | "normal" | "low";

/**
 * 适配器从源站抓取并初步映射后的商品明细
 */
export interface RawOfferItem {
  /** 源站内唯一的商品标识或商品直链 */
  itemKey: string;
  /** 源站商品原始标题 */
  rawName: string;
  /** 源站店铺内部自定义分类名 */
  shopCategory: string;
  /** 折合人民币后的参考价格 */
  price: number;
  /** 精确库存（部分发卡站隐藏精确数值，则为 null） */
  stockCount: number | null;
  /** 归一化库存状态 */
  stockStatus: StockStatus;
  /** 商品详情页或下单直链 */
  itemUrl: string;
}

/**
 * 适配器从源站抓取后的店铺快照
 */
export interface RawShopSnapshot {
  shopName: string;
  canonicalUrl: string;
  telegram: string;
  /** 源站公开店铺简介（未提供或无此接口时可省略或为空字符串） */
  description?: string;
  shopSellCount: number | null;
  salesVisible: boolean;
  depositVisible: boolean;
  depositMoney: number | null;
  items: RawOfferItem[];
}

/**
 * 经过 ETL 清洗与规则提取后的结构化报价
 */
export interface NormalizedOffer {
  id: string;
  shopId: string;
  groupKey: string;
  rawName: string;
  cleanName: string;
  brandGroup: ProductGroup;
  shopCategory: string;
  attrType: string;
  attrPlan: string;
  attrDuration: string;
  attrWarranty: string;
  attrSms: string;
  attrRegion: string;
  price: number;
  stockCount: number | null;
  stockStatus: StockStatus;
  itemUrl: string;
  updatedAt: string;
}

/**
 * 数据库中的店铺记录行
 */
export interface ShopRecord {
  id: string;
  shop_name: string;
  shop_url: string;
  canonical_url: string;
  adapter_type: AdapterType;
  system_type: import("./collector/shopSystems").ShopSystemType;
  telegram: string;
  /** 源站公开简介（0005 迁移前旧库缺此字段） */
  description?: string;
  sync_supported: number;
  sync_state: string;
  content_hash: string;
  last_synced_at: string | null;
  next_sync_at: string;
  consecutive_failures: number;
  last_error: string;
  stale_days: number;
  shop_sell_count: number | null;
  sales_visible: number;
  deposit_visible: number;
  deposit_money: number | null;
  product_count: number;
  product_summary_json: string;
  /** 真实初次收录时间（存量行可为 NULL，0005 迁移前旧库缺此字段） */
  created_at?: string | null;
  updated_at: string;
}

/**
 * 单店同步执行结果摘要
 */
export interface SyncShopOutcome {
  shopId: string;
  shopName: string;
  adapterType: AdapterType;
  status: "unchanged" | "updated" | "failed" | "skipped";
  itemCount: number;
  estimatedWrites: number;
  durationMs: number;
  contentHash?: string;
  /** 当商品摘要命中跳过但简介增量更新时为 true */
  descriptionUpdated?: boolean;
  error?: string;
}

/**
 * 一次切片轮询调度执行报告
 */
export interface SyncRunSummary {
  runId: string;
  triggerSource: "cron" | "manual" | "push";
  processedCount: number;
  skippedUnchanged: number;
  updatedCount: number;
  failedCount: number;
  estimatedD1Writes: number;
  durationMs: number;
  outcomes: SyncShopOutcome[];
}
