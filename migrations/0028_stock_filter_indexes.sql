-- Keep the stock filter's candidate lookups small without indexing in-stock offers.
CREATE INDEX IF NOT EXISTS idx_offers_zero_stock ON offers(stock_count) WHERE stock_count = 0;
CREATE INDEX IF NOT EXISTS idx_shops_last_closed ON shops(last_closed_at) WHERE last_closed_at IS NOT NULL;
