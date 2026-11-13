-- 覆盖品牌内默认排序和全局价格排序，减少分页时的临时排序。
CREATE INDEX IF NOT EXISTS idx_pg_brand_popular
  ON product_groups(brand_group, shop_count DESC, min_price ASC, group_key ASC);
CREATE INDEX IF NOT EXISTS idx_pg_price
  ON product_groups(min_price ASC, shop_count DESC, group_key ASC);
