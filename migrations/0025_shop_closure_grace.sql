ALTER TABLE shops ADD COLUMN closed_since_at TEXT;
ALTER TABLE shops ADD COLUMN last_closed_at TEXT;

-- A success from any sync path or changing the source link starts a new observation period.
CREATE TRIGGER clear_shop_closure_observation
AFTER UPDATE OF last_synced_at, shop_url ON shops
WHEN NEW.closed_since_at IS NOT NULL
  AND (NEW.shop_url IS NOT OLD.shop_url
    OR (NEW.last_synced_at IS NOT NULL AND NEW.last_synced_at IS NOT OLD.last_synced_at))
BEGIN
  UPDATE shops SET closed_since_at = NULL, last_closed_at = NULL WHERE id = NEW.id;
END;
