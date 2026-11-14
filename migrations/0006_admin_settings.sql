-- Settings and credentials are stored separately from shop snapshots.
CREATE TABLE IF NOT EXISTS admin_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  ingest_hash TEXT,
  favorites_enabled INTEGER NOT NULL DEFAULT 1,
  manual_rank_enabled INTEGER NOT NULL DEFAULT 0,
  submissions_enabled INTEGER NOT NULL DEFAULT 1,
  open_store_url TEXT NOT NULL DEFAULT 'https://wzyp.cn/merchant/register?invite_token=sirhao',
  revision INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO admin_settings (id,password_salt,password_hash) VALUES (1,'7IVXWNShN9D3u0Fz+8rlFA==','Ny+jrk4K01u/L/CRuFozuLVoUsbfY2GCwUkAFR4cLEg=');
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admin_login_attempts (client_hash TEXT PRIMARY KEY, failures INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shop_rank_settings (shop_id TEXT PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE, manual_rank INTEGER, favorite_count INTEGER NOT NULL DEFAULT 0 CHECK (favorite_count >= 0));
CREATE TABLE IF NOT EXISTS shop_favorite_votes (client_id TEXT NOT NULL, shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE, PRIMARY KEY(client_id,shop_id));
CREATE TRIGGER IF NOT EXISTS favorite_vote_add AFTER INSERT ON shop_favorite_votes BEGIN
 INSERT INTO shop_rank_settings(shop_id,favorite_count) VALUES (NEW.shop_id,1) ON CONFLICT(shop_id) DO UPDATE SET favorite_count = favorite_count + 1;
END;
CREATE TRIGGER IF NOT EXISTS favorite_vote_remove AFTER DELETE ON shop_favorite_votes BEGIN
 UPDATE shop_rank_settings SET favorite_count = MAX(0,favorite_count - 1) WHERE shop_id = OLD.shop_id;
END;
