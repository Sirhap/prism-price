ALTER TABLE sponsor_ads ADD COLUMN placement TEXT NOT NULL DEFAULT 'carousel'
  CHECK (placement IN ('carousel', 'fixed-1', 'fixed-2', 'fixed-3'));

CREATE INDEX idx_sponsor_ads_placement ON sponsor_ads(placement, expires_at)
  WHERE revoked_at IS NULL AND redeemed_at IS NOT NULL;
