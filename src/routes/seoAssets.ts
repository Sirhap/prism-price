import { isDailyD1Limit } from "../cache/publicResponseCache";
import { cachedQuery, catalogVersion } from "../cache/queryCache";
import {
  hideTelegramContacts,
  integrationCodeCandidateFilter,
  resolveIntegrationCodes,
} from "../collector/shopPresentation";
import {
  SHOP_SYSTEMS,
  getShopColumnCapabilities,
  inferShopSystem,
  normalizeShopSystem,
  shopReadSource,
} from "../collector/shopSystems";
import {
  BRAND_SEO_PROFILES,
  CORE_SEO_FAQS,
  OPEN_STORE_URL,
  SHOP_SYSTEM_GUIDES,
  SITE_ALT_NAME,
  SITE_NAME,
  SITE_ORIGIN,
} from "../config/seoMetadata";
import { PRODUCT_GROUPS } from "../types";
import { GROUP_DISPLAY_NAMES, positiveInteger } from "./search";

const xmlEsc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function extractLastmod(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const datePart = raw.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
}

interface SitemapEntry {
  loc: string;
  lastmod?: string | null;
  changefreq?: "daily" | "weekly";
  priority?: string;
}

function renderUrlSetXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const parts = [`<loc>${xmlEsc(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`<lastmod>${xmlEsc(entry.lastmod)}</lastmod>`);
      if (entry.changefreq) parts.push(`<changefreq>${entry.changefreq}</changefreq>`);
      if (entry.priority) parts.push(`<priority>${entry.priority}</priority>`);
      return `  <url>${parts.join("")}</url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function staticCoreEntries(): SitemapEntry[] {
  const basePages: SitemapEntry[] = [
    { loc: `${SITE_ORIGIN}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${SITE_ORIGIN}/about/`, changefreq: "weekly", priority: "0.95" },
    { loc: `${SITE_ORIGIN}/guide/`, changefreq: "weekly", priority: "0.9" },
    { loc: `${SITE_ORIGIN}/guide/ai-pricing/`, changefreq: "weekly", priority: "0.9" },
    { loc: `${SITE_ORIGIN}/guide/integration-codes/`, changefreq: "weekly", priority: "0.9" },
    { loc: `${SITE_ORIGIN}/guide/open-store/`, changefreq: "weekly", priority: "0.9" },
    { loc: `${SITE_ORIGIN}/open-store-guide/`, changefreq: "weekly", priority: "0.9" },
    { loc: `${SITE_ORIGIN}/catalog/`, changefreq: "daily", priority: "0.85" },
    { loc: `${SITE_ORIGIN}/catalog/shops/`, changefreq: "daily", priority: "0.85" },
    { loc: `${SITE_ORIGIN}/catalog/products/`, changefreq: "daily", priority: "0.85" },
    { loc: `${SITE_ORIGIN}/catalog/brands/`, changefreq: "daily", priority: "0.85" },
    { loc: `${SITE_ORIGIN}/catalog/integration-codes/`, changefreq: "daily", priority: "0.85" },
  ];

  const brandPages: SitemapEntry[] = PRODUCT_GROUPS.map((group) => ({
    loc: `${SITE_ORIGIN}/catalog/brands/${encodeURIComponent(group)}/`,
    changefreq: "daily",
    priority: group in BRAND_SEO_PROFILES ? "0.85" : "0.7",
  }));

  return [...basePages, ...brandPages];
}

function isMissingSchemaError(error: unknown): boolean {
  return /no such table|no such column/i.test(String(error));
}

/**
 * 动态生成 /sitemap.xml（主站点地图：核心页 + 品牌页 + 高价值店铺与商品组），兼顾低 D1 读取与无表环境优雅降级。
 */
export async function handleSitemapXml(url: URL, env: Env): Promise<Response> {
  const entries: SitemapEntry[] = [...staticCoreEntries()];

  try {
    const version = await catalogVersion(env.DB, url);
    const dynamicEntries = await cachedQuery(
      url,
      `sitemap-main-entries:${version}`,
      async (): Promise<SitemapEntry[]> => {
        const [{ results: shops }, { results: products }] = await Promise.all([
          env.DB.prepare(
            "SELECT id, updated_at FROM shops ORDER BY product_count DESC, updated_at DESC, id ASC LIMIT 500",
          ).all<{ id: string; updated_at: string }>(),
          env.DB.prepare(
            "SELECT group_key, updated_at FROM product_groups ORDER BY shop_count DESC, updated_at DESC, group_key ASC LIMIT 1000",
          ).all<{ group_key: string; updated_at: string }>(),
        ]);

        const list: SitemapEntry[] = [];
        for (const s of shops || []) {
          list.push({
            loc: `${SITE_ORIGIN}/catalog/shops/${encodeURIComponent(s.id)}/`,
            lastmod: extractLastmod(s.updated_at),
            changefreq: "daily",
            priority: "0.7",
          });
        }
        for (const p of products || []) {
          list.push({
            loc: `${SITE_ORIGIN}/catalog/products/${encodeURIComponent(p.group_key)}/`,
            lastmod: extractLastmod(p.updated_at),
            changefreq: "daily",
            priority: "0.75",
          });
        }
        return list;
      },
      600,
    );
    entries.push(...dynamicEntries);
  } catch (error) {
    if (isDailyD1Limit(error)) throw error;
    if (!isMissingSchemaError(error)) {
      console.warn(JSON.stringify({ event: "sitemap_dynamic_fallback", error: String(error) }));
    }
  }

  return new Response(renderUrlSetXml(entries), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
}

/**
 * 分片站点地图：支持按 page 分页导出全量店铺 (/sitemap-shops.xml) 或商品 (/sitemap-products.xml)。
 */
export async function handleShardedSitemapXml(kind: "shops" | "products", url: URL, env: Env): Promise<Response> {
  const page = positiveInteger(url.searchParams.get("page"), 1, 100);
  const shardSize = 2000;
  const offset = (page - 1) * shardSize;
  let entries: SitemapEntry[] = [];

  try {
    const version = await catalogVersion(env.DB, url);
    entries = await cachedQuery(
      url,
      `sitemap-${kind}:${version}:${page}`,
      async (): Promise<SitemapEntry[]> => {
        if (kind === "shops") {
          const { results } = await env.DB.prepare(
            "SELECT id, updated_at FROM shops ORDER BY product_count DESC, id ASC LIMIT ? OFFSET ?",
          )
            .bind(shardSize, offset)
            .all<{ id: string; updated_at: string }>();
          return (results || []).map((s) => ({
            loc: `${SITE_ORIGIN}/catalog/shops/${encodeURIComponent(s.id)}/`,
            lastmod: extractLastmod(s.updated_at),
            changefreq: "daily",
            priority: "0.7",
          }));
        }

        const { results } = await env.DB.prepare(
          "SELECT group_key, updated_at FROM product_groups ORDER BY shop_count DESC, group_key ASC LIMIT ? OFFSET ?",
        )
          .bind(shardSize, offset)
          .all<{ group_key: string; updated_at: string }>();
        return (results || []).map((p) => ({
          loc: `${SITE_ORIGIN}/catalog/products/${encodeURIComponent(p.group_key)}/`,
          lastmod: extractLastmod(p.updated_at),
          changefreq: "daily",
          priority: "0.75",
        }));
      },
      600,
    );
  } catch (error) {
    if (isDailyD1Limit(error)) throw error;
    if (!isMissingSchemaError(error)) {
      console.warn(JSON.stringify({ event: "sitemap_shard_fallback", kind, error: String(error) }));
    }
  }

  return new Response(renderUrlSetXml(entries), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
}

function buildCoreLlmsMarkdown(): string {
  const brandLines = Object.values(BRAND_SEO_PROFILES)
    .map(
      (b) =>
        `- [${GROUP_DISPLAY_NAMES[b.group] || b.group} 比价目录](${SITE_ORIGIN}/catalog/brands/${encodeURIComponent(b.group)}/): ${b.summary} ${b.officialPriceNote}`,
    )
    .join("\n");

  const systemLines = SHOP_SYSTEM_GUIDES.map((s) => `- **${s.label}**：${s.summary}`).join("\n");

  const faqLines = CORE_SEO_FAQS.map((item) => `### ${item.q}\n${item.a}`).join("\n\n");

  return `# ${SITE_NAME} (${SITE_ALT_NAME})

> ${SITE_NAME}是一个专注公开卡网比价、店铺收录、店铺对接码查询与 AI 数字订阅多店报价对比的信息检索导航平台（${SITE_ORIGIN}/）。支持联动小铺、云猫寄售、16688交易平台、独角数卡、二次元发卡等系统，涵盖 ChatGPT、Codex、Claude、Gemini、Cursor、Grok、DeepSeek 与 API 中转等热门商品。

## 核心入口与页面地图

- [首页交互搜索与实时比价工作台](${SITE_ORIGIN}/): 支持按商品关键词、品牌、商品形态（成品账号/代充兑换码/API中转/接码服务）、套餐、时长、价格区间对比多店报价，也可切换至「看收录店铺」按卡网系统、在售状态与对接码筛选。
- [卡网导航百科与常见问答总览](${SITE_ORIGIN}/about/): 独立页面汇总热门 AI 品牌比价入口、店铺对接码查询、联动小铺开店引导与平台 FAQ。
- [AI 订阅比价总指南](${SITE_ORIGIN}/guide/): 如何核实规格、交付方式、库存与售后风控。
- [ChatGPT / Codex / Claude / Gemini 多店对比指南](${SITE_ORIGIN}/guide/ai-pricing/): 官网参考定价与成品号、代充、中转对比明细。
- [店铺对接码（分销码）查询与规范](${SITE_ORIGIN}/guide/integration-codes/): 什么是店铺对接码、如何筛选与一键复制、如何在店铺简介标注以便系统识别。
- [卡网开店与联动小铺开店入驻指南](${SITE_ORIGIN}/guide/open-store/): 联动小铺开店步骤、上架命名建议、提交收录路径（[开店注册入口](${OPEN_STORE_URL})）。
- [开店与对接货源三步图解](${SITE_ORIGIN}/open-store-guide/): 从注册联动小铺、复制店铺对接码到绑定货源商品的三步图文操作教程。
- [卡网目录总览](${SITE_ORIGIN}/catalog/): 静态化全量目录总导航。
- [公开店铺目录](${SITE_ORIGIN}/catalog/shops/): 全部已收录卡网店铺档案（含系统类型、商品数、公开对接码与脱敏简介）。
- [AI 与数字商品目录](${SITE_ORIGIN}/catalog/products/): 按同款规格聚合的多店比价详情页。
- [店铺对接码专题目录](${SITE_ORIGIN}/catalog/integration-codes/): 汇总已识别公开对接码或分销码的卡网店铺。

## 核心品牌比价专题

${brandLines}

## 支持收录的卡网系统

${systemLines}

## 常用 URL 筛选参数（面向检索跳转）

- 按品牌筛选：\`${SITE_ORIGIN}/?group=ChatGPT\`、\`${SITE_ORIGIN}/?group=Codex\`、\`${SITE_ORIGIN}/?group=Claude\`、\`${SITE_ORIGIN}/?group=Gemini\`
- 搜索对接码店铺：\`${SITE_ORIGIN}/?mode=shop&hasIntegrationCode=1\`
- 筛选联动小铺店铺：\`${SITE_ORIGIN}/?mode=shop&systemType=ldxp\`

## 常见问题（FAQ）

${faqLines}

## 数据真实性与免责边界

- 本站仅做公开卡网店铺信息收录与价格参考对比，不参与任何交易、代购或资金结算。
- 展示的报价与库存来自周期性公开快照，可能存在时间差，下单前请前往源站店铺核实实时价格、库存与售后条款。
- 为保护隐私与安全，所有公开页面、目录及知识索引均自动过滤隐藏 Telegram 等私人社交联系方式。
`;
}

/**
 * 提供标准 /llms.txt（零 D1 读取，供大模型和 AI 搜索 Agent 快速理解站点实体、目录及服务边界）。
 */
export function handleLlmsTxt(): Response {
  return new Response(buildCoreLlmsMarkdown(), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/**
 * 提供扩展版 /llms-full.txt（在核心索引基础上注入脱敏实时统计、热门品牌报价快照与精选对接码店铺）。
 */
export async function handleLlmsFullTxt(url: URL, env: Env): Promise<Response> {
  const baseDoc = buildCoreLlmsMarkdown();
  let dynamicSummary = "";

  try {
    const version = await catalogVersion(env.DB, url);
    dynamicSummary = await cachedQuery(
      url,
      `llms-full-summary:${version}`,
      async () => {
        const caps = await getShopColumnCapabilities(env.DB);
        const shopSource = shopReadSource(caps);
        const candidate = integrationCodeCandidateFilter();

        const [shopCountRow, groupCountRow, brandDistRes, hotProductsRes, codeShopRes] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS cnt FROM shops").first<{ cnt: number }>(),
          env.DB.prepare("SELECT COUNT(*) AS cnt FROM product_groups").first<{ cnt: number }>(),
          env.DB.prepare(
            "SELECT brand_group, COUNT(*) AS cnt, MIN(min_price) AS lowest FROM product_groups GROUP BY brand_group ORDER BY cnt DESC LIMIT 15",
          ).all<{ brand_group: string; cnt: number; lowest: number }>(),
          env.DB.prepare(
            `SELECT group_key, display_name, brand_group, min_price, shop_count
             FROM product_groups
             WHERE brand_group IN ('ChatGPT', 'Codex', 'Claude', 'Gemini', 'Cursor', 'Grok', 'DeepSeek', '中转')
             ORDER BY shop_count DESC, min_price ASC
             LIMIT 30`,
          ).all<{
            group_key: string;
            display_name: string;
            brand_group: string;
            min_price: number;
            shop_count: number;
          }>(),
          env.DB.prepare(
            `SELECT id, shop_name, shop_url, canonical_url, effective_system_type AS system_type, description, submitted_integration_code, product_count
             FROM ${shopSource}
             WHERE ${candidate.sql}
             ORDER BY product_count DESC, id ASC
             LIMIT 40`,
          )
            .bind(...candidate.params)
            .all<{
              id: string;
              shop_name: string;
              shop_url: string;
              canonical_url: string;
              system_type: string;
              description: string;
              submitted_integration_code: string;
              product_count: number;
            }>(),
        ]);

        const totalShops = Number(shopCountRow?.cnt || 0);
        const totalGroups = Number(groupCountRow?.cnt || 0);

        const brandRowsText = (brandDistRes.results || [])
          .map((b) => {
            const label = GROUP_DISPLAY_NAMES[b.brand_group] || b.brand_group;
            const low = Number.isFinite(Number(b.lowest)) ? `最低参考 ¥${Number(b.lowest).toFixed(2)}` : "";
            return `- **${label}**：已聚合 ${Number(b.cnt)} 个商品规格组${low ? `（${low}）` : ""} — [查看目录](${SITE_ORIGIN}/catalog/brands/${encodeURIComponent(b.brand_group)}/)`;
          })
          .join("\n");

        const productRowsText = (hotProductsRes.results || [])
          .map((p) => {
            const name = hideTelegramContacts(p.display_name);
            const price = Number(p.min_price);
            return `- [${name}](${SITE_ORIGIN}/catalog/products/${encodeURIComponent(p.group_key)}/)（${p.brand_group}）：最低参考 ¥${Number.isFinite(price) ? price.toFixed(2) : "—"}，共 ${Number(p.shop_count)} 家店铺在售`;
          })
          .join("\n");

        const codeShopsText = (codeShopRes.results || [])
          .map((s) => {
            const { codes } = resolveIntegrationCodes(s);
            if (!codes.length) return "";
            const inferred = inferShopSystem(s.shop_url, s.canonical_url);
            const sysType = inferred !== "unknown" ? inferred : (normalizeShopSystem(s.system_type) ?? "unknown");
            const sysLabel = SHOP_SYSTEMS[sysType];
            const cleanName = hideTelegramContacts(s.shop_name);
            return `- [${cleanName}](${SITE_ORIGIN}/catalog/shops/${encodeURIComponent(s.id)}/)（${sysLabel}，商品数 ${Number(s.product_count) || 0}）— 对接码：\`${codes.join("`, `")}\``;
          })
          .filter(Boolean)
          .slice(0, 30)
          .join("\n");

        return `
## 实时收录数据快照（动态聚合）

- **已收录公开卡网店铺总数**：${totalShops} 家
- **已聚合参考商品规格组总数**：${totalGroups} 组

### 热门品牌与品类分布
${brandRowsText || "- 暂无商品分布数据"}

### 代表性高在售 AI 商品比价样本
${productRowsText || "- 暂无热门商品样本"}

### 代表性含对接码（分销码）店铺样本
${codeShopsText || "- 暂无对接码店铺样本"}
`;
      },
      600,
    );
  } catch (error) {
    if (isDailyD1Limit(error)) throw error;
    if (!isMissingSchemaError(error)) {
      console.warn(JSON.stringify({ event: "llms_full_fallback", error: String(error) }));
    }
  }

  return new Response(`${baseDoc}\n${dynamicSummary}`.trim() + "\n", {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
}
