# 火山服务器部署

正式域名当前由火山服务器提供，Cloudflare Worker/D1 为保留副本；`wrangler.jsonc` 的空域名路由是有意设置。对外发布需更新服务器 release，不能只执行 Wrangler 上传。`entry.ts` 提供受独立密钥保护的同步入口，
`worker.mjs` 是 esbuild 打包产物。`server.mjs` 使用固定版本的 Miniflare/workerd，
提供 HTMLRewriter、D1、Cache API 和静态资源兼容环境，不运行 Wrangler 开发服务器。
Miniflare 是 Cloudflare 的开发/测试工具，本部署是自托管兼容方案，没有 Cloudflare 托管 D1 的高可用和 Time Travel 保证。

- 安装目录：`/opt/ldxp-cf-demo/current`，实际版本以 `readlink -f /opt/ldxp-cf-demo/current` 为准，源码放在 `releases/` 独立目录。
- 数据：`/var/lib/ldxp-cf-demo/d1`；缓存：同目录 `cache`。
- 密钥与服务器配置：`/etc/ldxp-cf-demo.env`，仅 root 可读，由 systemd 注入；不要把密钥放到网站静态目录。
- 正式域名：`https://parity.sirhao.top`，由 Cloudflare 代理到服务器 OpenResty，再转发至本机 8787。
- OpenResty 配置：`/opt/1panel/www/conf.d/parity.conf`；Origin CA 证书位于 `/opt/1panel/www/sites/parity/ssl`，私钥权限 0600，证书有效至 2041-11-08。
- `wrangler.jsonc` 已移除该域名路由，避免以后部署旧 Worker 时重新抢占正式域名。
- `ldxp-cf-demo.service`：开机启动，异常自动重启，以独立 `ldxp` 用户运行。
- `ldxp-sync.timer`：默认停用，不自动采集商品和店铺。运行层 `AUTO_SYNC_ENABLED=false` 再作一层保护。
- `ldxp-push.timer`：默认停用，不自动启动源站采集后推送；保留 `POST /api/ingest` 管理员 Bearer 密钥推送接口，自动采集关闭不影响接收推送。
- `ldxp-backup.timer`：每日北京时间 03:00 在线备份，保留最近 14 份。

原始 D1 导出与源码压缩包在服务器 `/opt/ldxp-cf-demo/backups`，首次导入后另做在线 SQLite 备份。
Cloudflare Worker 和数据库保留；正式域名已脱离旧 Worker，服务由火山服务器提供。两端数据库从迁移快照后独立写入，不自动双向同步。

## 维护

```sh
systemctl status ldxp-cf-demo
journalctl -u ldxp-cf-demo -n 80
systemctl list-timers 'ldxp-*'
systemctl start ldxp-backup.service
```

重新构建：在项目根目录运行 `node_modules/.bin/esbuild deploy/huoshan/entry.ts --bundle --format=esm --platform=neutral --target=es2022 --outfile=deploy/huoshan/worker.mjs`。
将完整源码/静态资源与打包结果放进新 release，在 `deploy/huoshan` 内运行 `npm ci --omit=dev`，
本次新版本通过软链接复用旧版固定的 `node_modules`，不要删除 `20261112-1845`；后续独立安装依赖后可解除该依赖。
切换 `current` 软链接并重启 `ldxp-cf-demo.service`，验证后保留旧版本。

## 回滚

本次是首次安装。若需撤销，停用 `ldxp-sync.timer`、`ldxp-push.timer`、`ldxp-backup.timer`
及 `ldxp-cf-demo.service` 即可；原 Cloudflare 网站继续运行，服务器数据和备份保留。
后续代码发布回滚可将 `current` 指回上一个 release 后重启服务。
数据库恢复前先停采集 timer、停止应用并备份当前数据库；不要直接覆盖运行中的 SQLite 文件。

当前维护策略：自动采集和自动推送定时任务均禁用，备份 timer 保持启用。页面不展示后台同步异常或原始 HTML 错误，记录仍保留在数据库及日志中。后续如要启用自动采集，应由维护人员显式修改 AUTO_SYNC_ENABLED 并确认对应 timer，而不是为排查页面问题自动运行全量采集。
