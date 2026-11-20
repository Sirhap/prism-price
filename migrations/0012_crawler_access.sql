CREATE TABLE IF NOT EXISTS crawler_blocked_ips (
  ip TEXT PRIMARY KEY,
  blocked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crawler_access_logs (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  visited_at TEXT NOT NULL,
  ip TEXT NOT NULL,
  request_path TEXT NOT NULL,
  method TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  blocked INTEGER NOT NULL CHECK (blocked IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_crawler_access_day_time
  ON crawler_access_logs(day DESC, visited_at DESC, id DESC);
