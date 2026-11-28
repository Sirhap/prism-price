---
name: ldxp-local-sync
description: 从本机采集并增量推送店铺和商品，支持保守限速、跨地点分片与中断续跑；用于用户要求本地同步或预览变化。
---

# 本地店铺和商品同步

在包含 `local-sync/sync.mjs` 和 `package.json` 的仓库根目录运行。已有项目或同步工具时用该仓库的最新脚本；没有代码时克隆 [Sirhap/ldxp-sync-kit](https://github.com/Sirhap/ldxp-sync-kit)。

已有配置直接使用。首次配置时复制 `local-sync/config.example.env` 为 `local-sync/config.env`，填写 `API_BASE`（正式站为 `https://parity.sirhao.top`）和该目标的 `INGEST_SECRET`。避免打印、转发或提交密钥。整店旧报价读取需要密钥，涉及下架复核的只读预览也一样。

用用户指定的店铺 ID 或链接末段替换示例 `S123456`。

```bash
npm run sync:local -- --shop=S123456                    # 仅预览
npm run sync:local -- --shop=S123456 --apply            # 按授权同步一店
npm run sync:local -- --shop=S123456 --apply --resume   # 续跑同一次同步
```

- 仅查询或预览时省略 `--apply`。正式同步按用户授权范围执行，`--apply` 可能删除已确认不可用的店铺或下架报价。保留其他店铺。打烊店铺须等满 7 天并再次确认；细则见仓库的 `local-sync/README.md`。
- 续跑沿用同一目标、店铺、分片、`--limit` 和断点文件。多地点用 `--shard=1/3` 等不同序号；各地点共享分片总数，默认单并发、间隔随机 1～2 秒。
- 16688 采集走 `www.16688.store`，旧链接和原断点仍可用。`--verify-all-16688` 只筛选 16688。部分采集保留未获明确下架确认的旧报价。
- 单店源站风控时跳过，目标站鉴权失败或限流时停止。检查退出码和最终汇总，分别报告已推送、失败、风控跳过、未处理及已删除数量。需要核对参数和行为时，运行 `npm run sync:local -- --explain`。
