-- 悬浮 AI 助手的模型配置，由后台「AI 助手」面板维护。
ALTER TABLE admin_settings ADD COLUMN ai_api_base TEXT;
ALTER TABLE admin_settings ADD COLUMN ai_api_key TEXT;
ALTER TABLE admin_settings ADD COLUMN ai_model TEXT;
