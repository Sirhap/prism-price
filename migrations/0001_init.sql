-- Cloudflare D1 (SQLite) 初始化表结构
-- 设计原则：写入时预清洗、预聚合、配合 SHA-256 Hash Diff 最大限度节省 Free 版每日 10 万行写入额度

CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  shop_name TEXT NOT NULL,
  shop_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  adapter_type TEXT NOT NULL DEFAULT 'json_api', -- 'json_api' | 'ssr_html' | 'manual'
  telegram TEXT NOT NULL DEFAULT '',
  sync_supported INTEGER NOT NULL DEFAULT 1,       -- 1 = 支持自动同步, 0 = 待适配/人工快照
  sync_state TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'ready' | 'error' | 'manual'
  content_hash TEXT NOT NULL DEFAULT '',           -- SHA-256 摘要，用于跳过未变更店铺的商品覆写
  last_synced_at TEXT,
  next_sync_at TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  stale_days INTEGER NOT NULL DEFAULT 0,
  shop_sell_count INTEGER,
  sales_visible INTEGER NOT NULL DEFAULT 0,
  deposit_visible INTEGER NOT NULL DEFAULT 0,
  deposit_money REAL,
  product_count INTEGER NOT NULL DEFAULT 0,
  product_summary_json TEXT NOT NULL DEFAULT '[]', -- 单行存预览摘要 JSON，D1 无论多大只算 1 行写
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shops_next_sync ON shops(sync_supported, next_sync_at);
CREATE INDEX IF NOT EXISTS idx_shops_updated ON shops(updated_at);

-- 在售商品报价明细表（仅存当前有货商品）
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,                             -- `${shop_id}:${item_key}`
  shop_id TEXT NOT NULL,
  group_key TEXT NOT NULL,                         -- 同款聚类的归一化键
  raw_name TEXT NOT NULL,
  clean_name TEXT NOT NULL,
  brand_group TEXT NOT NULL,                       -- 12 个主分类之一
  shop_category TEXT NOT NULL DEFAULT '',
  attr_type TEXT NOT NULL DEFAULT '',              -- ready | recharge | cdk | api | ''
  attr_plan TEXT NOT NULL DEFAULT '',              -- plus | free | k12 | codex | team | pro5 | pro20 | ''
  attr_duration TEXT NOT NULL DEFAULT '',          -- day | week | month | year | ''
  attr_warranty TEXT NOT NULL DEFAULT '',          -- yes | partial | no | ''
  attr_sms TEXT NOT NULL DEFAULT '',               -- service | done | pending | ''
  attr_region TEXT NOT NULL DEFAULT '',            -- us | ''
  price REAL NOT NULL,
  stock_count INTEGER,                             -- 未知为 NULL
  stock_status TEXT NOT NULL DEFAULT 'sufficient', -- sufficient | normal | low
  item_url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_offers_group_key ON offers(group_key, price);
CREATE INDEX IF NOT EXISTS idx_offers_shop_id ON offers(shop_id);
CREATE INDEX IF NOT EXISTS idx_offers_facets ON offers(brand_group, attr_type, attr_plan, price);

-- 同款商品预聚合表（支撑 /api/products 免去读路径 10ms CPU 聚合计算）
CREATE TABLE IF NOT EXISTS product_groups (
  group_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  brand_group TEXT NOT NULL,
  shop_category TEXT NOT NULL DEFAULT '',
  attr_type TEXT NOT NULL DEFAULT '',
  attr_plan TEXT NOT NULL DEFAULT '',
  attr_duration TEXT NOT NULL DEFAULT '',
  attr_warranty TEXT NOT NULL DEFAULT '',
  attr_sms TEXT NOT NULL DEFAULT '',
  attr_region TEXT NOT NULL DEFAULT '',
  min_price REAL NOT NULL,
  median_price REAL NOT NULL,
  max_price REAL NOT NULL,
  shop_count INTEGER NOT NULL,
  offer_count INTEGER NOT NULL,
  lead_shop_id TEXT NOT NULL,
  lead_shop_name TEXT NOT NULL,
  lead_shop_url TEXT NOT NULL,
  lead_item_url TEXT NOT NULL,
  stock_status TEXT NOT NULL DEFAULT 'sufficient',
  offers_preview_json TEXT NOT NULL,               -- 预存按价格升序的前 12 条报价 JSON
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pg_brand_price ON product_groups(brand_group, min_price);
CREATE INDEX IF NOT EXISTS idx_pg_shop_count ON product_groups(shop_count DESC, min_price ASC);
CREATE INDEX IF NOT EXISTS idx_pg_updated ON product_groups(updated_at DESC);

-- 每日快照流水表（支撑「店铺档案」7天/30天趋势观察）
CREATE TABLE IF NOT EXISTS shop_daily_snapshots (
  shop_id TEXT NOT NULL,
  day TEXT NOT NULL,                               -- YYYY-MM-DD
  product_count INTEGER NOT NULL,
  min_price REAL,
  median_price REAL,
  total_sales INTEGER,
  has_stock INTEGER NOT NULL,                      -- 1 = 当日有货, 0 = 全部缺货
  PRIMARY KEY (shop_id, day)
);

-- 采集同步日志表（方便 Demo 面板直观观测每次切片运行和 Hash 跳过效果）
CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL,                    -- 'cron' | 'manual'
  processed_count INTEGER NOT NULL,
  skipped_unchanged INTEGER NOT NULL,
  updated_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  estimated_d1_writes INTEGER NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 仅用于 Demo 仿真源站的可持久化状态（避免在 Worker 全局内存保存可变状态）
CREATE TABLE IF NOT EXISTS mock_overrides (
  shop_id TEXT PRIMARY KEY,
  price_delta REAL NOT NULL DEFAULT 0,
  toggle_stock_out INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

