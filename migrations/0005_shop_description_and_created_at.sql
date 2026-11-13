-- 为 shops 表增加源站简介与真实初次收录时间（存量行 created_at 保持 NULL，不用 updated_at 冒充）
ALTER TABLE shops ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN created_at TEXT;
