ALTER TABLE sponsor_ads ADD COLUMN image_key TEXT;

CREATE TABLE sponsor_image_parts (
  sponsor_id TEXT NOT NULL REFERENCES sponsor_ads(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  content BLOB NOT NULL,
  PRIMARY KEY (sponsor_id, part)
);
