ALTER TABLE shops ADD COLUMN system_type TEXT NOT NULL DEFAULT 'unknown'
  CHECK (system_type IN ('ldxp', 'acg-faka', 'dujiaoka', 'other', 'unknown'));

-- 只回填已确认平台，保留自定义域名店铺为待识别。
UPDATE shops SET system_type = 'ldxp'
WHERE lower(shop_url) LIKE 'https://pay.ldxp.cn/%'
   OR lower(shop_url) LIKE 'https://wzyp.cn/%'
   OR lower(canonical_url) LIKE 'https://wzyp.cn/%';

CREATE INDEX idx_shops_system_type ON shops(system_type, sync_supported DESC, product_count DESC);
