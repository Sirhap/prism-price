---
name: ldxp-local-sync
description: 从本机采集并增量推送店铺和商品，支持保守限速、跨地点分片与中断续跑；用于用户要求本地同步或预览变化。
---

# 本地店铺和商品同步

脚本开源仓库：[Sirhap/ldxp-sync-kit](https://github.com/Sirhap/ldxp-sync-kit)。尚未取得代码时：

```bash
git clone https://github.com/Sirhap/ldxp-sync-kit.git
cd ldxp-sync-kit
cp local-sync/config.example.env local-sync/config.env
```

配置目标站点和密钥后，在仓库根目录执行同步。不要将配置文件或密钥提交到 GitHub。已有完整项目时也可在项目根目录使用同步脚本。

在包含 `local-sync/sync.mjs` 和 `package.json` 的项目根目录运行。先查看 `local-sync/README.md` 和 `node local-sync/sync.mjs --explain`，核对目标、密钥来源和删除行为。默认 `npm run sync:local -- [参数]` 只采集比较，`--apply` 才写入；用户已明确要求指定范围同步时直接执行，无需重复确认。

- 默认单并发，所有源站请求间隔由 config.env 的 `SYNC_INTERVAL_MIN_MS` 和 `SYNC_INTERVAL_MAX_MS` 控制，默认随机 1～2 秒，允许的最小值为 100 毫秒。只有用户明确要求才调快，调整上下限使用配置文件。`--interval-ms=5000` 覆盖为 5～6 秒；同一出口 IP 不要并行启动多个进程。不同地点的限速器不共享，分片不代表可以提高总速率。
- 多地点约定同一 `--shard=序号/总数` 总数且序号不同，按店铺 ID 稳定分片；新店留给下一轮。每片记录分开保存。`--limit=6` 小批验证，单店用 `--shop=ID或地址末段`。
- 风控、限流、验证码或非 JSON 响应由脚本按退避策略最多自动重试两次；仍受限则停止，不要换 IP 或绕过验证。部分失败、中断后，经用户确认源站恢复再用相同目标、分片、店铺和 limit 加 `--apply --resume`。检查退出码并分别报告 failed、unprocessed 和 alreadyAbsent，不能把未处理算成同步失败。
- 目标地址和密钥在 `local-sync/config.env` 或环境变量配置；旧项目可回退 `.dev.vars`。不要打印、复制或提交密钥。生成可迁移包用 `node local-sync/build-kit.mjs`，不附带密钥。
- 同步仅处理已收录且支持的店铺。未变化的快照跳过；`--apply` 会删除源站明确报告不存在或完整采集后无可收录商品的店铺，加 `--delete-unavailable` 还会删除关闭交易的店铺，连同目标站商品和历史快照。确认用户授权涵盖具体删除范围。不要重启服务器、启用定时任务或修改全局 Cloudflare 登录。分类规则改变时下一次成功同步才重分类。
