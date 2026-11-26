# 悬浮 AI 检索助手设计（PRISM 棱镜比价）

日期：2026-11-27
状态：待实现

## 背景与目标

站点现有筛选（`normalizeProductQuery`）已经支持品牌、套餐、时长、价格、排序等维度，并有大量别名兼容，但用户用自然语言表达需求时仍需要手动拆解成多个筛选条件。

本次要新增一个右下角悬浮 AI 助手，支持：

- **比价意图**：用户说"便宜的 Claude 月付"，AI 翻译成结构化筛选参数，结果仍走现有 `/api/products`，**价格与店铺数据绝不经过模型生成**。
- **指南意图**：用户问"怎么开店""对接码怎么用"，基于站点公开指南内容生成带出处的回答。
- **混合意图**：拆成"比价结果 + 文字回答"两段返回。

## 约束

- Cloudflare 账号为 **Free 计划**，Workers AI 每天 10,000 Neurons，超出后停止服务（不扣费）。
- 小模型 `@cf/meta/llama-3.2-3b` 约 13 Neurons/次，理论上限约 770 次/天；设计目标是把实际模型调用压到 100–300 次/天。
- 现有前端为原生 JS（`public/app.js`、`public/i18n.js`），无框架；沿用现有 modal / 焦点陷阱 / 主题 / i18n 习惯。
- Worker 入口 `src/index.ts`，API 分发在 `src/routes/api.ts`；公开 GET 请求会经过 `withPublicResponseCache`。

## 架构与组件边界

新增文件：

- `src/routes/ai.ts`：`/api/ai` 唯一入口，负责规则前置分流、调用 Workers AI、组装响应、缓存与限流。
- `src/ai/intent.ts`：纯函数模块。关键词规则做意图分类（`compare` / `guide` / `mixed` / `chit-chat`）与筛选参数抽取；规则先行，能确定的不让模型猜。
- `src/ai/knowledge.ts`：从 `llms.txt`、`about`、`guide` 整理出的固定知识片段（约 10–20 段 FAQ），作为问答静态上下文。不实时抓页面，避免额外 D1 / 网络开销。
- `public/ai-assistant.js`：悬浮球 + 对话面板逻辑，独立 IIFE，不侵入 `app.js`。
- `migrations/0026_ai_cache.sql`：D1 缓存表。

改动文件：

- `src/index.ts`：在 `/api/` 通用分支之前加入 `/api/ai` 路由，避免被 `withPublicResponseCache` 缓存。
- `wrangler.jsonc`：加入 `ai` binding。
- `public/index.html`：加入悬浮球与面板的 DOM 结构。
- `public/styles.css`：加入悬浮球与面板样式，含明暗主题与移动端适配。

关键原则：AI 只输出意图与参数，价格、库存、店铺信息一律来自现有 `/api/products` 与 `/api/shops`。

## 数据流与意图分流

请求链路：前端 `POST /api/ai { question }` → `src/routes/ai.ts` → 规则前置 → 分支处理 → 统一结构响应。

### 规则层（`src/ai/intent.ts`）

先拦截两类：

- **比价类**：命中品牌名（ChatGPT / Claude / Codex / Gemini 等）、价格词（"便宜 / 最低价 / 多少钱"）、套餐词（plus / pro / 月付 / 年付）→ 直接抽取 `group / plan / duration / price / sort` 参数，不调 AI。
- **指南类**：命中"怎么开店 / 对接码 / 收录 / 赞助 / 授权码"等 → 走知识库问答。

兜底才调 Workers AI：用 `@cf/meta/llama-3.2-3b` 做一次极短 prompt 分类，输出 `{ intent, filters }`。服务端再用现有 `normalizeProductQuery` 校验参数，非法值回退为 `all`。

### 响应结构

- `compare`：`{ type: "compare", filters, apiUrl: "/api/products?..." }`。前端拿 `apiUrl` 走现有商品加载和卡片渲染流程，面板里显示"已帮你按 XXX 筛选"和跳转链接。
- `guide`：`{ type: "answer", text, sources: [{ title, url }] }`。知识片段 + 问题喂给模型，回答带出处链接。
- `mixed`：拆成两段返回，先比价结果后文字回答。

### 前端展示

悬浮球点击展开对话面板；用户消息与回答以气泡呈现；比价结果复用现有商品卡片样式，不另写一套。

## 额度保护与错误处理

- **缓存**：问题文本归一化后做 key，结果存 D1 表 `ai_cache`，24 小时内相同问题直接返回，不调模型。
- **限流**：按 IP 每天 30 次，用 KV 计数 + TTL 24h；超限返回友好提示"今日体验次数已用完，可稍后再试"。
- **降级**：模型超时或额度耗尽时，比价类退回规则结果，指南类返回预置常见问题快捷入口，不让用户看到报错页。
- **前端态**：加载中骨架、错误重试按钮、来源链接可点击、移动端适配、`Esc` 关闭面板、焦点陷阱（沿用现有 `trapModalFocus`）。

## 测试策略

- **单测（Vitest）**：`intent.ts` 纯函数，覆盖各种中文问法的分类、参数抽取、非法值回退。
- **集成测试（vitest-pool-workers）**：mock `env.AI`，验证规则命中不调模型、缓存命中不调模型、`compare` 返回结构正确、降级路径生效。
- **前端手动验收**：悬浮球展开/收起、移动端布局、键盘可访问性、比价跳转、指南回答来源链接。

## 成本估算

3B 模型约 13 Neurons/次，10,000/天 ≈ 770 次。加上规则前置和缓存，实际模型调用预计 100–300 次/天，远在免费额度内。

## 明确不做（YAGNI）

- 不做向量检索 / Vectorize 索引。
- 不做多轮对话记忆，每次请求独立。
- 不做用户账号体系或登录态。
- 不让模型直接生成价格、店铺名、库存等事实性数据。
- 不做赞助内容的 AI 推荐。
