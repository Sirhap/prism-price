-- 为 visit_logs 按日期范围去重统计独立访客 IP 增加联合索引
CREATE INDEX IF NOT EXISTS idx_visit_logs_day_ip ON visit_logs(day, ip);
