-- 访问明细记录表（保存每次去重访问的客户端 IP、识别地区与设备信息）
CREATE TABLE IF NOT EXISTS visit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  visited_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visit_logs_visited_at ON visit_logs(visited_at DESC);
