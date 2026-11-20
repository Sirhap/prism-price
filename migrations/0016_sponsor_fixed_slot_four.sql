CREATE TABLE sponsor_ads_next (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT NOT NULL,
  duration INTEGER NOT NULL CHECK (duration > 0),
  unit TEXT NOT NULL CHECK (unit IN ('days', 'months')),
  created_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER,
  title TEXT,
  image_type TEXT,
  image BLOB,
  placement TEXT NOT NULL DEFAULT 'carousel'
    CHECK (placement IN ('carousel', 'fixed-1', 'fixed-2', 'fixed-3', 'fixed-4'))
);

INSERT INTO sponsor_ads_next (
  id, code_hash, code_hint, duration, unit, created_at, redeemed_at, expires_at, revoked_at, title, image_type, image, placement
)
SELECT id, code_hash, code_hint, duration, unit, created_at, redeemed_at, expires_at, revoked_at, title, image_type, image, placement
FROM sponsor_ads;

DROP TABLE sponsor_ads;
ALTER TABLE sponsor_ads_next RENAME TO sponsor_ads;

CREATE INDEX idx_sponsor_ads_visible ON sponsor_ads(expires_at)
  WHERE revoked_at IS NULL AND redeemed_at IS NOT NULL;
CREATE INDEX idx_sponsor_ads_created ON sponsor_ads(created_at DESC, id DESC);
CREATE INDEX idx_sponsor_ads_placement ON sponsor_ads(placement, expires_at)
  WHERE revoked_at IS NULL AND redeemed_at IS NOT NULL;
