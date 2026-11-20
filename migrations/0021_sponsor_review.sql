ALTER TABLE sponsor_ads ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (review_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE sponsor_ads ADD COLUMN reviewed_at INTEGER;
