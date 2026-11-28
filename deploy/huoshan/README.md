# 火山服务器部署

正式域名当前由火山服务器提供，Cloudflare Worker/D1 为保留副本；`wrangler.jsonc` 的空域名路由是有意设置。对外发布需更新服务器 release，不能只执行 Wrangler 上传。`entry.ts` 提供受独立密钥保护的同步入口，
`worker.mjs` 是 esbuild 打包产物。`server.mjs` 使用固定版本的 Miniflare/workerd，
提供 HTMLRewriter、D1、Cache API 和静态资源兼容环境，不运行 Wrangler 开发服务器。
Miniflare 是 Cloudflare 的开发/测试工具，本部署是自托管兼容方案，没有 Cloudflare 托管 D1 的高可用和 Time Travel 保证。

- 安装目录：`/opt/ldxp-cf-demo/current`，实际版本以 `readlink -f /opt/ldxp-cf-demo/current` 为准，源码放在 `releases/` 独立目录。
- 数据：`/var/lib/ldxp-cf-demo/d1`。火山部署禁用 Miniflare 的磁盘 Cache API，应用查询和响应共用进程内缓存，最多 512 项、约 24 MiB。重启后按请求预热。旧版本遗留的 `/var/lib/ldxp-cf-demo/cache` 可以在新版确认运行后单独安排清理。
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

## 发布

项目根目录安装开发依赖后，使用以下命令构建并验证指定的 Git 提交。默认使用 `HEAD`。

```sh
bash deploy/huoshan/deploy.sh --ref HEAD
```

正式发布使用已推送的提交和核对过的线上版本名。将下方的版本名替换为 `current` 指向的目录名。

```sh
ssh huoshan-server 'readlink -f /opt/ldxp-cf-demo/current'
bash deploy/huoshan/deploy.sh --ref HEAD --apply --expect <当前版本目录名>
```

脚本通过 `huoshan-server` 上传并验证发布包，在服务器上锁定发布、核对上一版本、备份并校验 SQLite，再切换 `current` 并重启服务。它会验证源站和正式域名的首页、后台静态资源与公共 API。验证失败时自动切回上一应用版本。数据库备份保存于 `/opt/ldxp-cf-demo/backups/<新版本>/pre-deploy.sqlite`。

数据库迁移、运行依赖升级及系统配置变更单独执行。同步时间功能需要先备份生产 SQLite，再在事务中应用 `0023_offer_sync_timestamps.sql`。旧报价在下一次成功观察后开始显示同步时间。常规发布复用上一版本的运行依赖，并校验依赖清单一致。清理历史版本时，保留 `current`、回退版本及仍被引用的 `node_modules` 所在目录。

切换内存缓存后，用正式域名重复请求同一分页商品或店铺查询，确认 HTTP 200 和第二次请求的 `X-Prism-Cache: HIT`，再检查磁盘可用空间和 `/var/lib/ldxp-cf-demo/cache` 的增长情况。清理旧缓存前确认当前 release 已停用磁盘 Cache API。回滚旧版时 Miniflare 可以重建 Cache API 数据。店铺和报价由 D1 SQLite 读取。

上线商品详情补查前，在线备份并校验 SQLite，再在事务中应用 `0024_offer_classification_details.sql`。该迁移只新建报价分类证据缓存表。商品在后续成功同步时按新规则归类，已有详情判定随报价删除而清理。

上线 7 天打烊观察前，备份生产 SQLite，再应用 `0025_shop_closure_grace.sql`。观察从新版同步首次确认打烊时开始，成功同步或确认恢复营业会重置。部署后更新各机器的同步脚本，再恢复自动同步。

上线 16688 域名切换时，先核对同一店铺编号的新旧记录是否重复，备份生产 SQLite，并在事务中应用 `0029_market16688_store_domain.sql`。迁移保留店铺、商品和聚合组 ID。随后验证线上店铺、报价及目录链接，再更新各运行同步工具的机器。

上线访客时间筛选及爬虫拦截前，先备份生产 SQLite，再按顺序应用 `0011_visit_logs_day_ip_index.sql` 和 `0012_crawler_access.sql`（按当前库已应用的迁移跳过）。黑名单只信任 `CF-Connecting-IP`，须先确认源站只接受可信 Cloudflare 回源，或由 OpenResty 丢弃直连请求携带的该头部。若配置了公开页面/API 的边缘缓存，也应确认这些请求会到达应用，否则命中缓存的请求既不会拦截也不会被记录。

自动规则在公开页面及公开 API 的 GET/HEAD 请求上拦截明确的爬虫和脚本标识（包括 curl、wget），拦截返回不可缓存的 500 并保留记录，不自动写入手动 IP 黑名单。`robots.txt` 和其中显式放行的索引爬虫访问公开页面可通过 UA 规则，公开 API 仍检查 UA。用浏览器或默认 Node.js `fetch` 验证公开页面的正常响应。

同步客户端用现有的 Bearer 密钥读取 `GET /api/shops` 和 `GET /api/shops/:id/products`，校验通过后可跳过访客 UA 规则和 IP 黑名单。带 Bearer 凭据的同步读取响应禁止缓存。同步预览在配置密钥后也使用这一鉴权。

上线赞助推广前先备份 SQLite，再按顺序应用 `0014_sponsor_ads.sql` 至 `0022_sponsors_auto_approve.sql`（已应用的跳过，并在事务中执行重建表的迁移）。后台「赞助推广」总开关默认开启；关闭时隐藏展示和入口、暂停公开投稿，授权记录保留，有效期照常计算。「自动审批」默认关闭，开启仅作用于后续新投稿，轮播满位时新投稿仍进入待审批。授权码可绑定位置或交由投稿人选择，每个码只可投稿一次。管理员可在「赞助推广 → 审批与授权码管理」查看素材和链接，并通过或驳回。待审批的内容仅管理员可见，通过时开始计算有效期，已上线的旧推广沿用原到期时间。顶部轮播最多同时投放 4 张。四个固定位可以接收多条推广，前台同时展示最多 4 条，所有有效内容不定时上下轮动。赞助图片最大 5 MB，支持原图和裁剪。投稿可附 HTTP(S) 跳转链接，带链接的卡片在新标签页打开目标。到期、作废或删除的内容会停止展示。

## 回滚

本次是首次安装。若需撤销，停用 `ldxp-sync.timer`、`ldxp-push.timer`、`ldxp-backup.timer`
及 `ldxp-cf-demo.service` 即可；原 Cloudflare 网站继续运行，服务器数据和备份保留。
后续代码发布回滚可将 `current` 指回上一个 release 后重启服务。
数据库恢复前先停采集 timer、停止应用并备份当前数据库；不要直接覆盖运行中的 SQLite 文件。

当前维护策略：自动采集和自动推送定时任务均禁用，备份 timer 保持启用。页面不展示后台同步异常或原始 HTML 错误，记录仍保留在数据库及日志中。后续如要启用自动采集，应由维护人员显式修改 AUTO_SYNC_ENABLED 并确认对应 timer，而不是为排查页面问题自动运行全量采集。
