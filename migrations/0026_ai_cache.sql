-- AI 助手问答结果缓存：相同问题在有效期内直接复用，避免重复调用 Workers AI。
CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key TEXT PRIMARY KEY,
  intent TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_expires_at ON ai_cache(expires_at);

-- AI 助手按 IP 的每日调用计数，用于免费额度保护。
CREATE TABLE IF NOT EXISTS ai_rate_limit (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_rate_limit_expires_at ON ai_rate_limit(expires_at);
