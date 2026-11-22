CREATE TABLE offer_classification_details (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  classification TEXT
);
