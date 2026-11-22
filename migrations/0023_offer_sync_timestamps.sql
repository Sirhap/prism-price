-- Full snapshots refresh all retained offers through the shop row.
ALTER TABLE shops ADD COLUMN last_full_sync_at TEXT;

-- Partial snapshots refresh only the offers observed in the source response.
ALTER TABLE offers ADD COLUMN last_observed_at TEXT;
