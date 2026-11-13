# 棱镜比价

棱镜比价收录公开店铺信息，提供 AI 订阅与数字商品的多店参考报价。网站仅提供信息检索，不参与交易；价格、库存及售后以店铺页面为准。

项目使用 TypeScript、Cloudflare Workers、Static Assets 和 D1。也可通过 `deploy/huoshan/` 中的 Miniflare 配置运行在自托管服务器上。自动采集默认关闭，管理员可以通过认证接口推送店铺快照。

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm ci
npm run db:migrate:local
npm run dev
```

部署到 Cloudflare 前，请在 `wrangler.jsonc` 填写你自己的 D1 数据库 ID。

本地写接口需要在项目根目录 `.dev.vars` 配置 `INGEST_SECRET`。不要提交真实密钥或数据库。

## 检查

```bash
npm test
npm run test:sync
npm run typecheck
```

## 项目结构

- `public/`：前端静态页面及搜索引擎资源。
- `src/`：API、采集、分类和缓存逻辑。
- `migrations/`：数据库迁移。
- `tests/`：接口与同步测试。
- `deploy/huoshan/`：自托管部署文件，详见其 README。
- `local-sync/`：本地同步工具，独立版本见 [ldxp-sync-kit](https://github.com/Sirhap/ldxp-sync-kit)。

商品分类规则及维护方式见 [BRAND-RULES.md](BRAND-RULES.md)，对接码规则见 [INTEGRATION-CODES.md](INTEGRATION-CODES.md)。

## 许可证

[MIT](LICENSE)
