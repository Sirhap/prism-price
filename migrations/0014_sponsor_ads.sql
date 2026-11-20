CREATE TABLE sponsor_ads (
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
  image BLOB
);

CREATE INDEX idx_sponsor_ads_visible ON sponsor_ads(expires_at) WHERE revoked_at IS NULL AND redeemed_at IS NOT NULL;
CREATE INDEX idx_sponsor_ads_created ON sponsor_ads(created_at DESC, id DESC);
