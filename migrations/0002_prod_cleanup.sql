-- 正式版迁移：移除 Demo 仿真状态表并清理演示用的异常测试店记录
DROP TABLE IF EXISTS mock_overrides;

DELETE FROM offers WHERE shop_id = 'real-catfk-banned';
DELETE FROM shop_daily_snapshots WHERE shop_id = 'real-catfk-banned';
DELETE FROM shops WHERE id = 'real-catfk-banned';

-- 确保已采集的正式店铺使用规范的 push_ingest 模式
UPDATE shops
SET adapter_type = 'push_ingest'
WHERE adapter_type = 'shop_api';
