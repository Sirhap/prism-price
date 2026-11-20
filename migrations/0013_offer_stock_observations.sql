ALTER TABLE offers ADD COLUMN stock_zero_day TEXT;
ALTER TABLE offers ADD COLUMN stock_zero_days INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER reset_offer_stock_observation
AFTER UPDATE OF stock_count ON offers
WHEN NEW.stock_count IS NOT 0 AND OLD.stock_zero_day IS NOT NULL
BEGIN
  UPDATE offers SET stock_zero_day = NULL, stock_zero_days = 0 WHERE id = NEW.id;
END;
