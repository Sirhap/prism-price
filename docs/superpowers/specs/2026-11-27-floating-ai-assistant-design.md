# 悬浮 AI 检索助手设计（PRISM 棱镜比价）

日期：2026-11-27
状态：待实现
范围：规则版 + 完整 UI，模型接口预留配置

## 背景与目标

站点现有筛选（`normalizeProductQuery`）已经支持品牌、套餐、时长、价格、排序等维度，并有大量别名兼容，但用户用自然语言表达需求时仍需要手动拆解成多个筛选条件。

本次要新增一个右侧悬浮 AI 助手，支持：

- **比价意图**：用户说"便宜的 Claude 月付"，助手翻译成结构化筛选参数，结果仍走现有 `/api/products`，**价格与店铺数据绝不经过模型生成**。
- **指南意图**：用户问"怎么开店""对接码怎么用"，基于内置知识库给出带出处的回答。
- **混合意图**：先给筛选结果入口，再补一段文字说明。

## 部署约束（关键）

正式域名 `https://parity.sirhao.top` 由**火山服务器自托管 Miniflare/workerd** 提供（`deploy/huoshan/server.mjs`，`cf: false`），Cloudflare Worker/D1 仅为保留副本。因此：

- **Cloudflare Workers AI binding 不可用**，不添加 `ai` binding。
- 外部模型通过 OpenAI 兼容 HTTP API 调用，**配置在后台「AI 助手模型」面板维护**，保存到 `admin_settings` 的 `ai_api_base`、`ai_api_key`、`ai_model` 字段。
- API Key 只写不读：后台 GET 仅返回「是否已配置」，不回传明文；保存时留空表示不修改，勾选「清除」可删除密钥。
- 环境变量 `AI_API_BASE`、`AI_API_KEY`、`AI_MODEL` 仅作为运维兜底，后台未配置任何字段时才回退使用。
- 本期**不默认接真实模型**：规则层能覆盖比价与常见指南问题；模型调用封装为可选能力，后台配置齐全后自动启用，未配置时完全走规则。
- 数据库是服务器本地 SQLite（经 D1 接口访问），新迁移需在服务器上手动应用。

## 架构与组件边界

新增文件：

- `src/routes/ai.ts`：`/api/ai` 唯一入口，负责规则分流、知识库问答、可选模型调用、缓存与限流、统一响应。
- `src/ai/agent.ts`：工具调用型 Agent。把商品、店铺、指南查询封装成 OpenAI function tools，由模型自行决定调用，最多 3 轮；返回文字总结 + 真实报价卡片数据 + 来源。
- `src/ai/intent.ts`：纯函数。关键词规则做意图分类（`compare` / `guide` / `mixed` / `chat`）与筛选参数抽取；仅在未配置模型时作为回退。
- `src/ai/knowledge.ts`：内置知识片段（开店、对接码、收录、赞助、数据准确性、安全性等），既作为 Agent 的 `get_site_guide` 工具，也作为规则回退的回答来源。
- `src/ai/llm.ts`：可选模型客户端。优先读 `admin_settings` 模型配置，回退环境变量，支持 OpenAI 兼容的 `/chat/completions` 与 `tools/tool_calls`；未配置或接口不支持工具时返回 `null`，调用方降级到规则回答。
- `public/ai-assistant.js`：悬浮球 + 对话面板逻辑，独立 IIFE，不侵入 `app.js`。
- `migrations/0026_ai_cache.sql`：D1 问答缓存表与按 IP 限流表。
- `migrations/0027_ai_settings.sql`：`admin_settings` 新增模型配置字段。

改动文件：

- `src/index.ts`：在 `/api/` 通用分支之前加入 `/api/ai` 路由，避免被 `withPublicResponseCache` 缓存。
- `src/routes/admin.ts`：新增 `POST /api/control/ai-settings`，并在设置 GET 中返回脱敏的模型配置状态。
- `public/admin/index.html`、`public/admin/admin.js`：新增「AI 助手模型」配置表单。
- `deploy/huoshan/server.mjs`：按需透传环境变量兜底配置（未设置则不注入）。
- `public/index.html`：加入悬浮球与面板的 DOM 结构。
- `public/styles.css`：加入悬浮球与面板样式，含明暗主题与移动端适配。
- `public/i18n.js`：加入面板英文词条。

关键原则：事实性数据（价格、库存、店铺名）一律来自现有 API，助手只负责理解、转参数和解释。

## 数据流与意图分流

请求链路：前端 `POST /api/ai { question }` → `src/routes/ai.ts` → 规则层 → 分支处理 → 统一结构响应。

### 主路径：工具调用 Agent（配置模型后启用）

把站点能力作为工具交给模型，由模型自行决定查什么，而不是用关键词硬编码意图：

- `search_products`：参数 `q / group / plan / duration / price / sort`，内部调用现有 `handleGetProducts`，返回真实最低价、同款店数、最低价店铺。
- `search_shops`：参数 `q / has_integration_code / sort`，内部调用现有 `handleGetShops`，返回店铺与对接码。
- `get_site_guide`：参数 `topic`，召回内置知识片段（开店、对接码、收录、赞助等）。

模型可连续调用工具，最多 3 轮；最终文字总结与卡片数据一起返回。价格、库存、店铺信息全部来自工具结果，模型不得编造。模型未配置、超时或接口不支持 `tools` 时返回 `null`，自动回退规则层。

### 回退：规则层（`src/ai/intent.ts`）

- **比价类**：命中品牌名、价格词、套餐词、时长词 → 抽出 `group / plan / duration / price / sort`。
- **指南类**：命中"开店 / 对接码 / 收录 / 赞助 / 授权码 / 怎么用 / 如何"等 → 走知识库。
- **混合**：同时有品牌或明确价格条件 + 指南词。
- **chat**：都没有，返回具体问法示例。

服务端用现有 `normalizeProductQuery` 二次校验参数，非法值自动回退 `all`，并用 `allowsPlan` / `allowsDuration` 剔除不适配维度。

### 响应结构

- `compare`：`{ type: "compare", filters, apiUrl: "/api/products?..." }`。前端展示"已按 XXX 筛选"和跳转按钮，点击后打开现有列表页。
- `answer`：`{ type: "answer", message, sources: [{ title, url }] }`。
- `mixed`：`{ type: "mixed", filters, apiUrl, message, sources }`。
- `hint`：`{ type: "hint", message, suggestions: [...] }`。

所有响应带 `meta: { source: "rule" | "model", intent }`，便于排查。

### 前端展示

右上角悬浮球点击展开对话面板；消息以气泡呈现。比价结果在面板内直接请求 `/api/products` 并渲染真实报价卡片（商品名、最低价、同款店数、最低价店铺），卡片点击打开商家商品页，底部提供「查看全部结果」入口。指南回答附来源链接；快捷问题可一键发送，点击后面板保持展开。

## 额度保护与错误处理

- **缓存**：问题归一化后 SHA-256 作为 key，结果存 `ai_cache`，24 小时内直接复用。
- **限流**：按访客 IP 每天 30 次，`ai_rate_limit` 表计数，超限返回友好提示。
- **降级**：模型未配置、超时或报错时，指南类退回知识库命中的规则答案；无命中则返回快捷问题。
- **前端态**：加载骨架、错误重试、来源链接、移动端适配、`Esc` 关闭、焦点陷阱。

## 测试策略

- **单测（Vitest）**：`intent.ts` 分类与参数抽取、`knowledge.ts` 召回排序、`normalizeProductQuery` 校验回退。
- **集成测试（vitest-pool-workers）**：`/api/ai` 的 compare 响应结构、指南回答、缓存命中、限流、未知问题降级。
- **前端手动验收**：悬浮球展开/收起、移动端布局、键盘可访问性、筛选跳转、来源链接。

## 成本

规则版零外部调用、零模型成本。启用模型后按所选服务商计费，缓存与规则前置可显著降低调用量。

## 明确不做（YAGNI）

- 不做向量检索 / Vectorize 索引。
- 不做多轮对话记忆，每次请求独立。
- 不做用户账号体系或登录态。
- 不让模型直接生成价格、店铺名、库存等事实性数据。
- 不做赞助内容的 AI 推荐。
- 本期不默认启用真实模型。
