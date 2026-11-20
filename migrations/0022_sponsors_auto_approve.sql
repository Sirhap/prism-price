ALTER TABLE admin_settings ADD COLUMN sponsors_auto_approve INTEGER NOT NULL DEFAULT 0
  CHECK (sponsors_auto_approve IN (0, 1));
