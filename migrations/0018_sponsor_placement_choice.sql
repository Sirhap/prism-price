ALTER TABLE sponsor_ads ADD COLUMN placement_choice INTEGER NOT NULL DEFAULT 0
  CHECK (placement_choice IN (0, 1));
