ALTER TABLE admin_settings ADD COLUMN sponsors_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (sponsors_enabled IN (0, 1));
