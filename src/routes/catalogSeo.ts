import { cachedQuery, catalogVersion } from "../cache/queryCache";
import {
  extractMainCategories,
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
  CORE_SEO_FAQS,
  OPEN_STORE_URL,
  SHOP_SYSTEM_GUIDES,
  SITE_ALT_NAME,
  SITE_NAME,
  SITE_ORIGIN,
  getBrandProfile,
} from "../config/seoMetadata";
import { PRODUCT_GROUPS } from "../types";
import { GROUP_DISPLAY_NAMES, normalizeProductGroup } from "./search";

const PAGE_SIZE = 30;

const TYPE_LABELS: Readonly<Record<string, string>> = {
  ready: "成品账号",
  recharge: "代充 / 兑换码",
  cdk: "代充 / 兑换码",
  api: "API / 中转",
  "sms-service": "接码服务",
  tutorial: "教程",
};

const PLAN_LABELS: Readonly<Record<string, string>> = {
  free: "Free 普号",
  plus: "Plus",
  pro: "Pro",
  ultra: "Ultra",
  team: "Team / Business",
  business: "Team / Business",
  pro5: "Pro / Max 5x",
  pro20: "Pro / Max 20x",
};

const DURATION_LABELS: Readonly<Record<string, string>> = {
  day: "日卡",
  week: "周卡",
  month: "月卡",
  quarter: "季卡",
  "half-year": "半年",
  year: "年卡",
};

const STOCK_LABELS: Readonly<Record<string, string>> = {
  sufficient: "库存充足",
  normal: "有货",
  low: "库存紧张",
};

const HOT_BRANDS = ["ChatGPT", "Codex", "Claude", "Gemini", "Cursor", "Grok", "DeepSeek", "中转"] as const;

const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const safeText = (value: unknown): string => hideTelegramContacts(String(value ?? ""));

function safeHttpUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function formatTypeLabel(attrType: string, attrSms: string): string {
  if (attrSms === "service") return TYPE_LABELS["sms-service"];
  return TYPE_LABELS[attrType] || "";
}

function formatPlanLabel(attrPlan: string): string {
  return PLAN_LABELS[attrPlan] || "";
}

function formatDurationLabel(attrDuration: string): string {
  return DURATION_LABELS[attrDuration] || "";
}

function buildProductSpecBadges(row: {
  brand_group?: string;
  attr_type?: string;
  attr_plan?: string;
  attr_duration?: string;
  attr_sms?: string;
}): string {
  const badges: string[] = [];
  if (row.brand_group) badges.push(`<span class="pill pill-brand">${esc(GROUP_DISPLAY_NAMES[row.brand_group] || row.brand_group)}</span>`);
  const typeLabel = formatTypeLabel(row.attr_type || "", row.attr_sms || "");
  if (typeLabel) badges.push(`<span class="pill">${esc(typeLabel)}</span>`);
  const planLabel = formatPlanLabel(row.attr_plan || "");
  if (planLabel) badges.push(`<span class="pill">${esc(planLabel)}</span>`);
  const durationLabel = formatDurationLabel(row.attr_duration || "");
  if (durationLabel) badges.push(`<span class="pill">${esc(durationLabel)}</span>`);
  return badges.join("");
}

function resolveShopSystemLabel(shopUrl: string, canonicalUrl: string, storedSystemType?: string): string {
  const inferred = inferShopSystem(shopUrl, canonicalUrl);
  const systemType = inferred !== "unknown" ? inferred : (normalizeShopSystem(storedSystemType) ?? "unknown");
  return SHOP_SYSTEMS[systemType];
}

interface PageOptions {
  title: string;
  description?: string;
  keywords?: string[];
  path: string;
  content: string;
  status?: number;
  ogType?: string;
  breadcrumbs?: Array<{ name: string; path: string }>;
  jsonLd?: Record<string, unknown>[];
}

function page(options: PageOptions): Response {
  const status = options.status ?? 200;
  const canonical = SITE_ORIGIN + options.path;
  const description =
    options.description ||
    `${options.title}：在棱镜比价浏览公开卡网店铺、店铺对接码与 AI 数字商品参考报价，实际价格和库存以源站店铺为准。`;
  const keywords = (
    options.keywords?.length
      ? options.keywords
      : ["棱镜比价", "卡网比价", "卡网收录", "店铺对接码", "ChatGPT", "Codex", "Claude", "Gemini", "联动小铺开店"]
  ).join(",");
  const robotsContent = status === 200 ? "index, follow, max-snippet:-1, max-image-preview:large" : "noindex, nofollow";

  const schemas: Record<string, unknown>[] = [...(options.jsonLd || [])];
  if (options.breadcrumbs && options.breadcrumbs.length > 0) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: options.breadcrumbs.map((item, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        name: item.name,
        item: SITE_ORIGIN + item.path,
      })),
    });
  }
  const ldScripts = schemas.map((schema) => `<script type="application/ld+json">${safeJsonLd(schema)}</script>`).join("");

  const breadcrumbHtml = options.breadcrumbs?.length
    ? `<nav class="crumbs" aria-label="面包屑导航">${options.breadcrumbs
        .map((item, idx) =>
          idx === options.breadcrumbs!.length - 1
            ? `<span>${esc(item.name)}</span>`
            : `<a href="${esc(item.path)}">${esc(item.name)}</a>`,
        )
        .join(" / ")}</nav>`
    : "";

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(options.title)} | ${SITE_NAME}</title>
<meta name="description" content="${esc(description)}">
<meta name="keywords" content="${esc(keywords)}">
<meta name="robots" content="${robotsContent}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" type="text/plain" href="/llms.txt" title="LLMs 站点索引">
<meta property="og:type" content="${esc(options.ogType || "website")}">
<meta property="og:locale" content="zh_CN">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(options.title)} | ${SITE_NAME}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary">
${ldScripts}
<style>
:root{color-scheme:light}
body{font:16px/1.75 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f7fd;color:#19233b;margin:0}
main{max-width:920px;margin:2rem auto 3.5rem;padding:0 1.25rem}
.topnav{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;margin-bottom:1rem;font-size:.94rem}
.topnav a{color:#4f46e5;text-decoration:none;font-weight:500}
.topnav a:hover{text-decoration:underline}
.crumbs{font-size:.88rem;color:#66758e;margin-bottom:1rem}
.crumbs a{color:#4f46e5;text-decoration:none}
article{background:#fff;border:1px solid #e1e8f4;border-radius:20px;padding:clamp(1.25rem,4vw,2.4rem);box-shadow:0 8px 28px rgba(25,35,59,.04)}
h1{font-size:clamp(1.45rem,3.6vw,2rem);line-height:1.35;margin:.2rem 0 .8rem}
h2{font-size:1.2rem;margin:1.75rem 0 .65rem;padding-bottom:.35rem;border-bottom:1px solid #edf1f8}
p{margin:.6rem 0}
a{color:#4f46e5}
.lead{color:#475569;font-size:1.02rem}
.note-box{background:#f8faff;border:1px solid #dbe6ff;border-radius:12px;padding:.85rem 1.1rem;margin:1rem 0;font-size:.94rem;color:#334155}
.pill-row{display:flex;flex-wrap:wrap;gap:.45rem;margin:.65rem 0}
.pill{display:inline-block;padding:.18rem .6rem;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:.82rem;font-weight:500;text-decoration:none}
.pill-brand{background:#ecfeff;color:#155e75}
.pill-code{background:#fef3c7;color:#92400e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.catalog-list{list-style:none;padding:0;margin:1rem 0;display:grid;gap:.75rem}
.catalog-card{border:1px solid #e4ebf6;border-radius:14px;padding:.95rem 1.1rem;background:#fcfdff}
.catalog-card-title{font-weight:600;font-size:1.03rem;text-decoration:none}
.catalog-card-meta{font-size:.9rem;color:#475569;margin-top:.3rem;display:flex;flex-wrap:wrap;gap:.4rem .8rem;align-items:center}
.catalog-card-desc{font-size:.88rem;color:#64748b;margin:.35rem 0 0}
.grid-links{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:.75rem;margin:1rem 0}
.grid-card{display:block;border:1px solid #e2e8f0;border-radius:12px;padding:.85rem 1rem;text-decoration:none;background:#fafcff;color:#19233b}
.grid-card strong{display:block;color:#4f46e5;margin-bottom:.2rem}
.grid-card span{font-size:.86rem;color:#64748b}
.kv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;margin:1rem 0}
.kv-item{border:1px solid #e4ebf6;border-radius:12px;padding:.75rem .95rem;background:#f9fbff}
.kv-item span{display:block;font-size:.82rem;color:#64748b}
.kv-item strong{font-size:1.05rem;color:#0f172a}
.table-wrap{overflow-x:auto;margin:1rem 0;border:1px solid #e4ebf6;border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:.92rem;min-width:520px}
th,td{padding:.65rem .85rem;text-align:left;border-bottom:1px solid #edf1f8}
th{background:#f8fafc;color:#475569;font-weight:600}
tr:last-child td{border-bottom:none}
.btn-link{display:inline-block;padding:.45rem .95rem;border-radius:10px;background:#4f46e5;color:#fff;text-decoration:none;font-size:.9rem;font-weight:500;margin-right:.5rem}
.btn-secondary{background:#eef2ff;color:#3730a3}
.pager{display:flex;gap:1rem;margin-top:1.5rem;align-items:center}
.faq-item{margin:.85rem 0;padding:.85rem 1rem;border:1px solid #e4ebf6;border-radius:12px;background:#fafcff}
.faq-item h3{font-size:1rem;margin:0 0 .35rem;color:#0f172a}
.faq-item p{margin:0;font-size:.93rem;color:#475569}
footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #edf1f8;color:#66758e;font-size:.9rem}
code{background:#f1f5f9;padding:.12rem .35rem;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
</style>
</head>
<body>
<main>
<nav class="topnav" aria-label="站点导航">
  <a href="/">棱镜比价首页</a>
  <a href="/catalog/">目录总览</a>
  <a href="/catalog/shops/">店铺目录</a>
  <a href="/catalog/products/">商品目录</a>
  <a href="/catalog/brands/">品牌比价</a>
  <a href="/catalog/integration-codes/">店铺对接码</a>
  <a href="/guide/">使用指南</a>
  <a href="/guide/open-store/">联动小铺开店</a>
</nav>
${breadcrumbHtml}
<article>
<h1>${esc(options.title)}</h1>
${options.content}
<footer>
  <p>本站仅做公开卡网店铺信息收录与多店参考报价展示，不参与交易；实际价格、库存和售后以源站店铺页面为准。</p>
  <p>快捷入口：<a href="/">返回比价搜索台</a> · <a href="/guide/ai-pricing/">ChatGPT/Codex/Claude/Gemini 对比指南</a> · <a href="/guide/integration-codes/">对接码说明</a> · <a href="/guide/open-store/">开店入驻指南</a></p>
</footer>
</article>
</main>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
      ...(status !== 200 ? { "X-Robots-Tag": "noindex" } : {}),
    },
  });
}

function renderCatalogOverview(): Response {
  const brandCards = PRODUCT_GROUPS.map((group) => {
    const label = GROUP_DISPLAY_NAMES[group] || group;
    return `<a class="grid-card" href="/catalog/brands/${encodeURIComponent(group)}/"><strong>${esc(label)}</strong><span>查看 ${esc(label)} 卡网比价目录</span></a>`;
  }).join("");

  const systemList = SHOP_SYSTEM_GUIDES.map(
    (sys) => `<li><strong>${esc(sys.label)}</strong>：${esc(sys.summary)}</li>`,
  ).join("");

  const content = `
    <p class="lead">${SITE_NAME}（${SITE_ALT_NAME}）公开索引 AI 订阅与数字商品卡网报价、已收录店铺档案及店铺对接码（分销码），支持搜索引擎与 AI 检索工具直接抓取结构化商品与店铺信息。</p>
    <div class="grid-links">
      <a class="grid-card" href="/catalog/shops/"><strong>公开店铺目录</strong><span>按游标浏览全部已收录卡网店铺及主营类别</span></a>
      <a class="grid-card" href="/catalog/products/"><strong>AI 与数字商品目录</strong><span>浏览按同款规格聚合的多店参考报价</span></a>
      <a class="grid-card" href="/catalog/integration-codes/"><strong>店铺对接码目录</strong><span>集中查询已识别的公开分销/对接码店铺</span></a>
      <a class="grid-card" href="/guide/open-store/"><strong>联动小铺开店与收录</strong><span>了解开店流程、对接码标注与提交收录方式</span></a>
    </div>
    <h2>按品牌与品类浏览比价目录</h2>
    <div class="grid-links">${brandCards}</div>
    <h2>支持收录的卡网系统</h2>
    <ul>${systemList}</ul>
  `;

  return page({
    title: "卡网比价与店铺收录目录总览",
    description: "浏览棱镜比价收录的卡网店铺目录、ChatGPT/Codex/Claude/Gemini 商品目录、店铺对接码目录与品牌聚合页。",
    keywords: ["卡网目录", "店铺收录", "卡网比价", "店铺对接码", "ChatGPT", "Codex", "Claude", "Gemini", "联动小铺"],
    path: "/catalog/",
    content,
    breadcrumbs: [
      { name: "棱镜比价首页", path: "/" },
      { name: "目录总览", path: "/catalog/" },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "卡网比价与店铺收录目录总览",
        url: `${SITE_ORIGIN}/catalog/`,
        inLanguage: "zh-CN",
      },
    ],
  });
}

function renderBrandsOverview(): Response {
  const brandCards = PRODUCT_GROUPS.map((group) => {
    const profile = getBrandProfile(group);
    const label = GROUP_DISPLAY_NAMES[group] || group;
    return `<a class="grid-card" href="/catalog/brands/${encodeURIComponent(group)}/">
      <strong>${esc(label)}</strong>
      <span>${esc(profile.summary.slice(0, 56))}${profile.summary.length > 56 ? "…" : ""}</span>
    </a>`;
  }).join("");

  return page({
    title: "AI 订阅与数字商品品牌比价目录",
    description: "按品牌浏览 ChatGPT、Codex、Claude、Gemini、Cursor、Grok、DeepSeek、API 中转与虚拟卡等多店卡网报价目录。",
    keywords: ["ChatGPT 比价", "Codex 比价", "Claude 比价", "Gemini 比价", "Cursor 比价", "卡网品牌导航"],
    path: "/catalog/brands/",
    content: `<p class="lead">按品牌进入垂直聚合目录，查看各 AI 工具官网参考定价对比、规格选型说明及当前收录的多店参考报价。</p><div class="grid-links">${brandCards}</div>`,
    breadcrumbs: [
      { name: "棱镜比价首页", path: "/" },
      { name: "目录总览", path: "/catalog/" },
      { name: "品牌比价目录", path: "/catalog/brands/" },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "AI 订阅与数字商品品牌比价目录",
        url: `${SITE_ORIGIN}/catalog/brands/`,
        inLanguage: "zh-CN",
      },
    ],
  });
}

function renderHotBrandLinksHtml(): string {
  return `<div class="pill-row" aria-label="热门品牌直达">${HOT_BRANDS.map(
    (b) => `<a class="pill pill-brand" href="/catalog/brands/${encodeURIComponent(b)}/">${esc(GROUP_DISPLAY_NAMES[b] || b)}</a>`,
  ).join("")}</div>`;
}

function validateCursorParams(url: URL, basePath: string): { ok: true; after: string } | { ok: false; response: Response } {
  const after = url.searchParams.get("after") || "";
  if (after.length > 2048 || (url.searchParams.has("page") && url.searchParams.get("page") !== "1")) {
    return {
      ok: false,
      response: page({
        title: "页面不存在",
        path: basePath,
        content: "<p>目录参数无效。</p>",
        status: 404,
      }),
    };
  }
  return { ok: true, after };
}

async function handleShopList(url: URL, env: Env): Promise<Response> {
  const check = validateCursorParams(url, "/catalog/shops/");
  if (!check.ok) return check.response;
  const after = check.after;

  const caps = await getShopColumnCapabilities(env.DB);
  const shopSource = shopReadSource(caps);
  const { results } = await env.DB.prepare(
    `SELECT id AS key, shop_name AS name, shop_url, canonical_url, effective_system_type AS system_type, description, submitted_integration_code, product_count
     FROM ${shopSource}
     WHERE id > ?
     ORDER BY id
     LIMIT ?`,
  )
    .bind(after, PAGE_SIZE + 1)
    .all<{
      key: string;
      name: string;
      shop_url: string;
      canonical_url: string;
      system_type: string;
      description: string;
      submitted_integration_code: string;
      product_count: number;
    }>();

  const rows = results || [];
  if (after && rows.length === 0) {
    return page({
      title: "页面不存在",
      path: "/catalog/shops/",
      content: "<p>没有更多内容。</p>",
      status: 404,
    });
  }

  const pageRows = rows.slice(0, PAGE_SIZE);
  const itemsHtml = pageRows
    .map((r) => {
      const cleanName = safeText(r.name);
      const systemLabel = resolveShopSystemLabel(r.shop_url, r.canonical_url, r.system_type);
      const { codes } = resolveIntegrationCodes({
        shop_name: r.name,
        description: r.description,
        shop_url: r.shop_url,
        canonical_url: r.canonical_url,
        submitted_integration_code: r.submitted_integration_code,
      });
      const cleanDesc = safeText(r.description).replace(/\s+/g, " ").trim();
      const descSnippet = cleanDesc ? `${cleanDesc.slice(0, 110)}${cleanDesc.length > 110 ? "…" : ""}` : "";
      const codeBadges = codes.length
        ? codes.slice(0, 2).map((code) => `<span class="pill pill-code">对接码：${esc(code)}</span>`).join("")
        : "";
      return `<li class="catalog-card">
        <a class="catalog-card-title" href="/catalog/shops/${encodeURIComponent(r.key)}/">${esc(cleanName)}</a>
        <div class="catalog-card-meta">
          <span class="pill">${esc(systemLabel)}</span>
          <span>收录商品：${Number(r.product_count) || 0} 件</span>
          ${codeBadges}
        </div>
        ${descSnippet ? `<p class="catalog-card-desc">${esc(descSnippet)}</p>` : ""}
      </li>`;
    })
    .join("");

  const base = "/catalog/shops/";
  const path = after ? `${base}?after=${encodeURIComponent(after)}` : base;
  const next = rows.length > PAGE_SIZE ? `<a class="btn-link" rel="next" href="${base}?after=${encodeURIComponent(rows[PAGE_SIZE - 1].key)}">下一页</a>` : "";

  return page({
    title: "公开卡网店铺目录",
    description: "浏览棱镜比价已收录的联动小铺、云猫寄售、独角数卡、16688 等卡网店铺，查看卡网系统类型、商品数、店铺对接码与源站地址。",
    keywords: ["卡网店铺收录", "卡网目录", "联动小铺店铺", "店铺对接码", "独角数卡", "云猫寄售"],
    path,
    content: `<p class="lead">浏览已收录的公开卡网店铺，可查看店铺所属系统、公开对接码与主营商品概览；报价和库存请以源站店铺页面为准。</p>
      <div class="note-box">正在寻找支持分销的源头店铺？前往 <a href="/catalog/integration-codes/">店铺对接码专题目录</a>；准备入驻开店？查看 <a href="/guide/open-store/">联动小铺开店与收录指南</a>。</div>
      <ul class="catalog-list">${itemsHtml || "<li>暂未收录店铺</li>"}</ul>
      <nav class="pager" aria-label="目录分页">${next}<a class="btn-link btn-secondary" href="/?mode=shop">在首页筛选全部店铺</a></nav>`,
    breadcrumbs: [
      { name: "棱镜比价首页", path: "/" },
      { name: "目录总览", path: "/catalog/" },
      { name: "公开店铺目录", path: "/catalog/shops/" },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "公开卡网店铺目录",
        url: `${SITE_ORIGIN}${path}`,
        inLanguage: "zh-CN",
      },
    ],
  });
}

async function handleShopDetail(id: string, env: Env): Promise<Response> {
  const path = `/catalog/shops/${encodeURIComponent(id)}/`;
  const caps = await getShopColumnCapabilities(env.DB);
  const shopSource = shopReadSource(caps);
  const row = await env.DB.prepare(
    `SELECT id, shop_name, shop_url, canonical_url, effective_system_type AS system_type, description,
            submitted_integration_code, product_count, product_summary_json, shop_sell_count, updated_at
     FROM ${shopSource}
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(id)
    .first<{
      id: string;
      shop_name: string;
      shop_url: string;
      canonical_url: string;
      system_type: string;
      description: string;
      submitted_integration_code: string;
      product_count: number;
      product_summary_json: string;
      shop_sell_count: number | null;
      updated_at: string;
    }>();

  if (!row) {
    return page({
      title: "店铺不存在",
      path,
      content: "<p>该店铺未收录或已移除。</p>",
      status: 404,
    });
  }

  const cleanName = safeText(row.shop_name);
  const systemLabel = resolveShopSystemLabel(row.shop_url, row.canonical_url, row.system_type);
  const { codes, source: codeSource } = resolveIntegrationCodes(row);
  const codeSourceLabel =
    codeSource === "submitted" ? "店主提交登记" : codeSource === "public" ? "店铺公开标注" : "维护配置";
  const categories = extractMainCategories(row.product_summary_json);
  const cleanDesc = safeText(row.description).trim();
  const safeCanonical = safeHttpUrl(row.canonical_url) || safeHttpUrl(row.shop_url);

  const codesHtml = codes.length
    ? `<div class="note-box">
        <strong>店铺对接码（分销码）：</strong>
        ${codes.map((code) => `<code>${esc(code)}</code>`).join(" · ")}
        <span style="color:#64748b;font-size:.86rem;">（来源：${esc(codeSourceLabel)} · <a href="/catalog/integration-codes/">更多对接码店铺</a>）</span>
      </div>`
    : `<p style="color:#64748b;font-size:.92rem;">暂未识别到公开店铺对接码；若您是店主，可在简介中按「对接码：您的代码」格式标注后等待同步更新（详见<a href="/guide/integration-codes/">对接码规范</a>）。</p>`;

  const categoriesHtml = categories.length
    ? `<div class="pill-row">${categories
        .map(
          (cat) =>
            `<a class="pill pill-brand" href="/catalog/brands/${encodeURIComponent(cat.group)}/">${esc(cat.label)} (${cat.count})</a>`,
        )
        .join("")}</div>`
    : `<p style="color:#64748b;">暂无主营品类分布统计。</p>`;

  const sellCountText =
    row.shop_sell_count !== null && row.shop_sell_count !== undefined && Number.isFinite(Number(row.shop_sell_count))
      ? `${Number(row.shop_sell_count)}`
      : "未公开";

  const linkHtml = safeCanonical
    ? `<a class="btn-link" rel="nofollow noopener noreferrer" target="_blank" href="${esc(safeCanonical)}">进入源站店铺核实 ↗</a>`
    : "";

  const searchInHomeUrl = `/?mode=shop&q=${encodeURIComponent(cleanName)}`;

  const storeSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Store",
    name: cleanName,
    url: `${SITE_ORIGIN}${path}`,
    additionalType: systemLabel,
    description: cleanDesc || `${cleanName}（${systemLabel}），已收录商品 ${Number(row.product_count) || 0} 件。`,
    ...(safeCanonical ? { sameAs: safeCanonical } : {}),
  };

  return page({
    title: cleanName,
    description: `${cleanName}（${systemLabel}）卡网店铺档案：已收录商品 ${Number(row.product_count) || 0} 件${codes.length ? `，店铺对接码 ${codes.join("/")}` : ""}。点击核实源站报价与库存。`,
    keywords: [cleanName, systemLabel, "卡网店铺", "店铺对接码", ...categories.map((c) => c.group)],
    path,
    ogType: "profile",
    content: `
      <div class="kv-grid">
        <div class="kv-item"><span>卡网系统类型</span><strong>${esc(systemLabel)}</strong></div>
        <div class="kv-item"><span>已收录商品数</span><strong>${Number(row.product_count) || 0} 件</strong></div>
        <div class="kv-item"><span>源站参考销量</span><strong>${esc(sellCountText)}</strong></div>
        <div class="kv-item"><span>最近档案更新</span><strong>${esc(String(row.updated_at || "").slice(0, 10) || "—")}</strong></div>
      </div>
      ${codesHtml}
      <h2>主营品牌与品类分布</h2>
      ${categoriesHtml}
      ${cleanDesc ? `<h2>公开店铺简介</h2><p>${esc(cleanDesc)}</p>` : ""}
      <h2>核实与访问</h2>
      <p>${linkHtml}<a class="btn-link btn-secondary" href="${esc(searchInHomeUrl)}">在首页店铺模式查看</a><a class="btn-link btn-secondary" href="/guide/open-store/">我也要在联动小铺开店</a></p>
      <p style="color:#64748b;font-size:.9rem;">信息可能存在时间差，实际价格、库存与售后规则请以源站店铺页面为准。</p>
    `,
    breadcrumbs: [
      { name: "棱镜比价首页", path: "/" },
      { name: "店铺目录", path: "/catalog/shops/" },
      { name: cleanName, path },
    ],
    jsonLd: [storeSchema],
  });
}

async function handleProductList(url: URL, env: Env): Promise<Response> {
  const check = validateCursorParams(url, "/catalog/products/");
  if (!check.ok) return check.response;
  const after = check.after;

  const { results } = await env.DB.prepare(
    `SELECT group_key AS key, display_name AS name, brand_group, attr_type, attr_plan, attr_duration, attr_sms, min_price, shop_count
     FROM product_groups
     WHERE group_key > ?
     ORDER BY group_key
     LIMIT ?`,
  )
    .bind(after, PAGE_SIZE + 1)
    .all<{
      key: string;
      name: string;
      brand_group: string;
      attr_type: string;
      attr_plan: string;
      attr_duration: string;
      attr_sms: string;
      min_price: number;
      shop_count: number;
    }>();

  const rows = results || [];
  if (after && rows.length === 0) {
    return page({
      title: "页面不存在",
      path: "/catalog/products/",
      content: "<p>没有更多内容。</p>",
      status: 404,
    });
  }

  const itemsHtml = rows
    .slice(0, PAGE_SIZE)
    .map((r) => {
      const price = Number(r.min_price);
      const priceText = Number.isFinite(price) ? `¥${price.toFixed(2)}` : "暂不可用";
      return `<li class="catalog-card">
        <a class="catalog-card-title" href="/catalog/products/${encodeURIComponent(r.key)}/">${esc(safeText(r.name))}</a>
        <div class="catalog-card-meta">
          ${buildProductSpecBadges(r)}
          <span>参考最低价：<strong>${priceText}</strong></span>
          <span>收录店铺：${Number(r.shop_count) || 0} 家</span>
        </div>
      </li>`;
    })
    .join("");

  const base = "/catalog/products/";
  const path = after ? `${base}?after=${encodeURIComponent(after)}` : base;
  const next = rows.length > PAGE_SIZE ? `<a class="btn-link" rel="next" href="${base}?after=${encodeURIComponent(rows[PAGE_SIZE - 1].key)}">下一页</a>` : "";

  return page({
    title: "AI 与数字商品目录",
    description: "浏览 ChatGPT、Codex、Claude、Gemini、Cursor、Grok、DeepSeek 与 API 中转等数字商品的多店聚合比价目录。",
    keywords: ["AI订阅比价", "ChatGPT", "Codex", "Claude", "Gemini", "卡网商品目录"],
    path,
    content: `<p class="lead">浏览已按同款规格聚合的 AI 与数字商品，点击任意商品可查看多家卡网店铺报价对比；报价和库存以源站为准。</p>
      ${renderHotBrandLinksHtml()}
      <ul class="catalog-list">${itemsHtml || "<li>暂未收录商品</li>"}</ul>
      <nav class="pager" aria-label="目录分页">${next}<a class="btn-link btn-secondary" href="/">返回首页实时筛选</a></nav>`,
    breadcrumbs: [
      { name: "棱镜比价首页", path: "/" },
      { name: "目录总览", path: "/catalog/" },
      { name: "商品目录", path: "/catalog/products/" },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "AI 与数字商品目录",
        url: `${SITE_ORIGIN}${path}`,
        inLanguage: "zh-CN",
      },
    ],
  });
}

interface PreviewOfferItem {
  shopId?: string;
  shopName?: string;
  price?: number;
  stockStatus?: string;
  itemUrl?: string;
}

async function handleProductDetail(id: string, env: Env): Promise<Response> {
  const path = `/catalog/products/${encodeURIComponent(id)}/`;
  const row = await env.DB.prepare(
    `SELECT group_key, display_name, brand_group, shop_category, attr_type, attr_plan, attr_duration, attr_sms,
            min_price, median_price, max_price, shop_count, offer_count, lead_shop_id, lead_shop_name, offers_preview_json, updated_at
     FROM product_groups
     WHERE group_key = ?
     LIMIT 1`,
  )
    .bind(id)
    .first<{
      group_key: string;
      display_name: string;
      brand_group: string;
      shop_category: string;
      attr_type: string;
      attr_plan: string;
      attr_duration: string;
      attr_sms: string;
      min_price: number;
      median_price: number;
      max_price: number;
      shop_count: number;
      offer_count: number;
      lead_shop_id: string;
      lead_shop_name: string;
      offers_preview_json: string;
      updated_at: string;
    }>();

  if (!row) {
    return page({
      title: "商品不存在",
      path,
      content: "<p>该商品未收录或已移除。</p>",
      status: 404,
    });
  }

  const cleanName = safeText(row.display_name);
  const brandProfile = getBrandProfile(row.brand_group);
  const minPrice = Number(row.min_price);
  const medianPrice = Number(row.median_price);
  const maxPrice = Number(row.max_price);
  const fmtPrice = (val: number) => (Number.isFinite(val) ? `¥${val.toFixed(2)}` : "暂不可用");

  let offers: PreviewOfferItem[] = [];
  try {
    const parsed = JSON.parse(row.offers_preview_json || "[]");
    if (Array.isArray(parsed)) offers = parsed;
  } catch {
    offers = [];
  }

  const offersTableRows = offers
    .slice(0, 12)
    .map((offer) => {
      const shopName = safeText(offer.shopName || "未知店铺");
      const shopId = typeof offer.shopId === "string" ? offer.shopId.trim() : "";
      const shopCell = shopId
        ? `<a href="/catalog/shops/${encodeURIComponent(shopId)}/">${esc(shopName)}</a>`
        : esc(shopName);
      const offerPrice = Number(offer.price);
      const stockText = STOCK_LABELS[String(offer.stockStatus || "")] || "库存以店铺为准";
      const safeItemHref = safeHttpUrl(offer.itemUrl);
      const actionCell = safeItemHref
        ? `<a rel="nofollow noopener noreferrer" target="_blank" href="${esc(safeItemHref)}">前往核实 ↗</a>`
        : "—";
      return `<tr>
        <td>${shopCell}</td>
        <td><strong>${fmtPrice(offerPrice)}</strong></td>
        <td>${esc(stockText)}</td>
        <td>${actionCell}</td>
      </tr>`;
    })
    .join("");

  const offersSection = offersTableRows
    ? `<h2>多店报价对比预览（前 ${Math.min(offers.length, 12)} 家）</h2>
       <div class="table-wrap"><table>
         <thead><tr><th>收录店铺</th><th>参考报价</th><th>库存状态</th><th>源站核实</th></tr></thead>
         <tbody>${offersTableRows}</tbody>
       </table></div>`
    : `<p style="color:#64748b;">当前暂无多店报价明细预览，可前往首页搜索对比实时收录结果。</p>`;

  const productSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: cleanName,
    url: `${SITE_ORIGIN}${path}`,
    category: row.brand_group || "数字商品",
    brand: {
      "@type": "Brand",
      name: row.brand_group || SITE_NAME,
    },
    description: `${cleanName} 多店卡网参考比价：收录 ${Number(row.shop_count) || 0} 家店铺，参考最低价 ${fmtPrice(minPrice)}。`,
    ...(Number.isFinite(minPrice)
      ? {
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "CNY",
            lowPrice: minPrice.toFixed(2),
            ...(Number.isFinite(maxPrice) ? { highPrice: maxPrice.toFixed(2) } : {}),
            offerCount: Math.max(1, Number(row.offer_count || row.shop_count || 1)),
          },
        }
      : {}),
  };

  return page({
    title: cleanName,
    description: `${cleanName}（${row.brand_group}）卡网多店比价：参考最低价 ${fmtPrice(minPrice)}，中位价 ${fmtPrice(medianPrice)}，共收录 ${Number(row.shop_count) || 0} 家店铺报价。`,
    keywords: [cleanName, row.brand_group, "多店比价", "卡网报价", ...brandProfile.keywords].filter(Boolean),
    path,
    ogType: "product",
    content: `
      <div class="pill-row">${buildProductSpecBadges(row)}</div>
      <div class="kv-grid">
        <div class="kv-item"><span>参考最低报价</span><strong>${fmtPrice(minPrice)}</strong></div>
        <div class="kv-item"><span>参考中位报价</span><strong>${fmtPrice(medianPrice)}</strong></div>
        <div class="kv-item"><span>参考最高报价</span><strong>${fmtPrice(maxPrice)}</strong></div>
        <div class="kv-item"><span>收录店铺 / 报价</span><strong>${Number(row.shop_count) || 0} 店 / ${Number(row.offer_count) || 0} 条</strong></div>
      </div>
      <div class="note-box">
        <strong>${esc(row.brand_group)} 对比提示：</strong>${esc(brandProfile.officialPriceNote)} ${esc(brandProfile.compareTips)}
        <a href="/catalog/brands/${encodeURIComponent(row.brand_group)}/">查看更多 ${esc(GROUP_DISPLAY_NAMES[row.brand_group] || row.brand_group)} 商品 →</a>
      </div>
      ${offersSection}
      <p>
        <a class="btn-link" href="/?group=${encodeURIComponent(row.brand_group)}&q=${encodeURIComponent(cleanName)}">在首页交互筛选此商品</a>
        <a class="btn-link btn-secondary" href="/guide/ai-pricing/">阅读 AI 订阅比价指南</a>
      </p>
    `,
    breadcrumbs: [
      { name: "棱镜比价首页", path: "/" },
      { name: "商品目录", path: "/catalog/products/" },
      { name: GROUP_DISPLAY_NAMES[row.brand_group] || row.brand_group || "其它", path: `/catalog/brands/${encodeURIComponent(row.brand_group || "其它")}/` },
      { name: cleanName, path },
    ],
    jsonLd: [productSchema],
  });
}

async function handleBrandDirectory(rawBrand: string, url: URL, env: Env): Promise<Response> {
  const canonicalBrand = normalizeProductGroup(rawBrand);
  if (canonicalBrand === "all") {
    return page({
      title: "品牌目录不存在",
      path: "/catalog/brands/",
      content: "<p>未找到对应的商品品牌或分类。</p>",
      status: 404,
    });
  }

  const base = `/catalog/brands/${encodeURIComponent(canonicalBrand)}/`;
  const check = validateCursorParams(url, base);
  if (!check.ok) return check.response;
  const after = check.after;

  const { results } = await env.DB.prepare(
    `SELECT group_key AS key, display_name AS name, attr_type, attr_plan, attr_duration, attr_sms, min_price, shop_count
     FROM product_groups
     WHERE brand_group = ? AND group_key > ?
     ORDER BY group_key
     LIMIT ?`,
  )
    .bind(canonicalBrand, after, PAGE_SIZE + 1)
    .all<{
      key: string;
      name: string;
      attr_type: string;
      attr_plan: string;
      attr_duration: string;
      attr_sms: string;
      min_price: number;
      shop_count: number;
    }>();

  const rows = results || [];
  if (after && rows.length === 0) {
    return page({
      title: "页面不存在",
      path: base,
      content: "<p>没有更多内容。</p>",
      status: 404,
    });
  }

  const profile = getBrandProfile(canonicalBrand);
  const path = after ? `${base}?after=${encodeURIComponent(after)}` : base;
  const next = rows.length > PAGE_SIZE ? `<a class="btn-link" rel="next" href="${base}?after=${encodeURIComponent(rows[PAGE_SIZE - 1].key)}">下一页</a>` : "";

  const itemsHtml = rows
    .slice(0, PAGE_SIZE)
    .map((r) => {
      const price = Number(r.min_price);
      const priceText = Number.isFinite(price) ? `¥${price.toFixed(2)}` : "暂不可用";
      return `<li class="catalog-card">
        <a class="catalog-card-title" href="/catalog/products/${encodeURIComponent(r.key)}/">${esc(safeText(r.name))}</a>
        <div class="catalog-card-meta">
          ${buildProductSpecBadges({ brand_group: canonicalBrand, ...r })}
          <span>参考最低价：<strong>${priceText}</strong></span>
          <span>收录店铺：${Number(r.shop_count) || 0} 家</span>
        </div>
      </li>`;
    })
    .join("");

  const faqItems = [...profile.faqs, ...CORE_SEO_FAQS.slice(0, 2)];
  const faqHtml = faqItems.length
    ? `<h2>${esc(GROUP_DISPLAY_NAMES[canonicalBrand] || canonicalBrand)} 常见问题</h2>
       ${faqItems.map((item) => `<div class="faq-item"><h3>${esc(item.q)}</h3><p>${esc(item.a)}</p></div>`).join("")}`
    : "";

  const schemas: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: profile.title,
      description: profile.summary,
      url: `${SITE_ORIGIN}${path}`,
      inLanguage: "zh-CN",
    },
  ];
  if (faqItems.length > 0) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });
  }

  return page({
    title: profile.title,
    description: `${profile.summary} ${profile.officialPriceNote}`,
    keywords: profile.keywords,
    path,
    content: `
      <p class="lead">${esc(profile.summary)}</p>
      <div class="note-box">
        <p style="margin:0 0 .35rem;"><strong>官网参照：</strong>${esc(profile.officialPriceNote)}</p>
        <p style="margin:0;"><strong>比价建议：</strong>${esc(profile.compareTips)}</p>
      </div>
      ${renderHotBrandLinksHtml()}
      <h2>已收录「${esc(GROUP_DISPLAY_NAMES[canonicalBrand] || canonicalBrand)}」商品列表</h2>
      <ul class="catalog-list">${itemsHtml || "<li>当前分类暂无已同步商品，请稍后再试或返回首页查看全部商品。</li>"}</ul>
      <nav class="pager" aria-label="目录分页">
        ${next}
        <a class="btn-link btn-secondary" href="/?group=${encodeURIComponent(canonicalBrand)}">在首页按 ${esc(GROUP_DISPLAY_NAMES[canonicalBrand] || canonicalBrand)} 实时筛选</a>
      </nav>
      ${faqHtml}
    `,
    breadcrumbs: [
      { name: "棱镜比价首页", path: "/" },
      { name: "品牌比价目录", path: "/catalog/brands/" },
      { name: GROUP_DISPLAY_NAMES[canonicalBrand] || canonicalBrand, path: base },
    ],
    jsonLd: schemas,
  });
}

async function handleIntegrationCodesDirectory(url: URL, env: Env): Promise<Response> {
  const base = "/catalog/integration-codes/";
  const check = validateCursorParams(url, base);
  if (!check.ok) return check.response;
  const after = check.after;

  const caps = await getShopColumnCapabilities(env.DB);
  const shopSource = shopReadSource(caps);
  const version = await catalogVersion(env.DB, url);

  const matchedIds = await cachedQuery(url, `seo-integration-ids:${version}`, async () => {
    const candidate = integrationCodeCandidateFilter();
    const { results } = await env.DB.prepare(
      `SELECT id, shop_name, description, shop_url, canonical_url, submitted_integration_code
       FROM ${shopSource}
       WHERE ${candidate.sql}
       ORDER BY id ASC`,
    )
      .bind(...candidate.params)
      .all<{
        id: string;
        shop_name: string;
        description: string;
        shop_url: string;
        canonical_url: string;
        submitted_integration_code: string;
      }>();

    return (results || [])
      .filter((row) => resolveIntegrationCodes(row).codes.length > 0)
      .map((row) => row.id)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  });

  const filteredIds = after ? matchedIds.filter((id) => id > after) : matchedIds;
  if (after && filteredIds.length === 0) {
    return page({
      title: "页面不存在",
      path: base,
      content: "<p>没有更多店铺对接码记录。</p>",
      status: 404,
    });
  }

  const pageIds = filteredIds.slice(0, PAGE_SIZE);
  let rows: Array<{
    id: string;
    shop_name: string;
    shop_url: string;
    canonical_url: string;
    system_type: string;
    description: string;
    submitted_integration_code: string;
    product_count: number;
  }> = [];

  if (pageIds.length > 0) {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.shop_name, p.shop_url, p.canonical_url, p.effective_system_type AS system_type, p.description, p.submitted_integration_code, p.product_count
       FROM json_each(?) AS matched
       CROSS JOIN (SELECT * FROM ${shopSource}) AS p
       WHERE p.id = matched.value`,
    )
      .bind(JSON.stringify(pageIds))
      .all<{
        id: string;
        shop_name: string;
        shop_url: string;
        canonical_url: string;
        system_type: string;
        description: string;
        submitted_integration_code: string;
        product_count: number;
      }>();
    const byId = new Map((results || []).map((r) => [r.id, r]));
    rows = pageIds.flatMap((id) => {
      const r = byId.get(id);
      return r ? [r] : [];
    });
  }

  const itemsHtml = rows
    .map((r) => {
      const cleanName = safeText(r.shop_name);
      const systemLabel = resolveShopSystemLabel(r.shop_url, r.canonical_url, r.system_type);
      const { codes } = resolveIntegrationCodes(r);
      const safeCanonical = safeHttpUrl(r.canonical_url) || safeHttpUrl(r.shop_url);
      return `<li class="catalog-card">
        <a class="catalog-card-title" href="/catalog/shops/${encodeURIComponent(r.id)}/">${esc(cleanName)}</a>
        <div class="catalog-card-meta">
          <span class="pill">${esc(systemLabel)}</span>
          <span>收录商品：${Number(r.product_count) || 0} 件</span>
          ${codes.map((c) => `<span class="pill pill-code">对接码：${esc(c)}</span>`).join("")}
          ${safeCanonical ? `<a rel="nofollow noopener noreferrer" target="_blank" href="${esc(safeCanonical)}">访问源站 ↗</a>` : ""}
        </div>
      </li>`;
    })
    .join("");

  const path = after ? `${base}?after=${encodeURIComponent(after)}` : base;
  const next =
    filteredIds.length > PAGE_SIZE
      ? `<a class="btn-link" rel="next" href="${base}?after=${encodeURIComponent(pageIds[pageIds.length - 1])}">下一页</a>`
      : "";

  const integrationFaqs = [
    CORE_SEO_FAQS[2],
    CORE_SEO_FAQS[3],
  ];

  return page({
    title: "卡网店铺对接码（分销码）收录目录",
    description: `汇总棱镜比价已识别的 ${matchedIds.length} 家含公开或维护对接码（分销码）的卡网店铺，涵盖联动小铺等平台货源对接参考。`,
    keywords: ["店铺对接码", "联动小铺对接码", "卡网对接码", "分销码", "卡网货源对接", "联动小铺开店"],
    path,
    content: `
      <p class="lead">本目录汇总棱镜比价已收录且包含店铺对接码（分销码）的卡网店铺（当前共索引 ${matchedIds.length} 家）。站内保留原始大小写、前导零与空格格式，方便快速查找与对接核实。</p>
      <div class="note-box">
        想自己开店并生成对接码供他人分销，或提交已有店铺？请阅读 <a href="/guide/open-store/">联动小铺开店指南</a> 与 <a href="/guide/integration-codes/">店铺对接码规范说明</a>；也可以前往 <a href="/?mode=shop&hasIntegrationCode=1">首页交互筛选「仅看有对接码」</a> 一键复制。
      </div>
      <ul class="catalog-list">${itemsHtml || "<li>当前暂未检索到含对接码的店铺。</li>"}</ul>
      <nav class="pager" aria-label="目录分页">
        ${next}
        <a class="btn-link btn-secondary" href="/?mode=shop&hasIntegrationCode=1">在首页一键复制对接码</a>
        <a class="btn-link btn-secondary" rel="nofollow noopener noreferrer" target="_blank" href="${esc(OPEN_STORE_URL)}">联动小铺开店入驻 ↗</a>
      </nav>
      <h2>对接码与开店常见问题</h2>
      ${integrationFaqs.map((item) => `<div class="faq-item"><h3>${esc(item.q)}</h3><p>${esc(item.a)}</p></div>`).join("")}
    `,
    breadcrumbs: [
      { name: "棱镜比价首页", path: "/" },
      { name: "目录总览", path: "/catalog/" },
      { name: "店铺对接码目录", path: base },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "卡网店铺对接码（分销码）收录目录",
        url: `${SITE_ORIGIN}${path}`,
        inLanguage: "zh-CN",
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: integrationFaqs.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  });
}

/**
 * 统一处理 /catalog/* 服务端渲染 SEO/GEO 页面，控制单页查询行预算并自动脱敏。
 */
export async function handleCatalogSeo(url: URL, env: Env): Promise<Response> {
  if (url.pathname === "/catalog" || url.pathname === "/catalog/") {
    return renderCatalogOverview();
  }
  if (url.pathname === "/catalog/brands" || url.pathname === "/catalog/brands/") {
    return renderBrandsOverview();
  }
  if (url.pathname === "/catalog/integration-codes" || url.pathname === "/catalog/integration-codes/") {
    return handleIntegrationCodesDirectory(url, env);
  }

  const brandMatch = url.pathname.match(/^\/catalog\/brands\/([^/]+)\/$/);
  if (brandMatch) {
    let brandParam: string;
    try {
      brandParam = decodeURIComponent(brandMatch[1]);
    } catch {
      return page({ title: "页面不存在", path: "/catalog/brands/", content: "<p>没有找到这个页面。</p>", status: 404 });
    }
    return handleBrandDirectory(brandParam, url, env);
  }

  const match = url.pathname.match(/^\/catalog\/(shops|products)\/(?:([^/]+)\/)?$/);
  if (!match) {
    return page({
      title: "页面不存在",
      path: "/catalog/",
      content: "<p>没有找到这个页面。</p>",
      status: 404,
    });
  }

  const kind = match[1];
  const isShop = kind === "shops";

  if (match[2]) {
    let id: string;
    try {
      id = decodeURIComponent(match[2]);
    } catch {
      return page({ title: "页面不存在", path: "/catalog/", content: "<p>没有找到这个页面。</p>", status: 404 });
    }
    if (!id || id.length > 2048) {
      return page({ title: "页面不存在", path: "/catalog/", content: "<p>没有找到这个页面。</p>", status: 404 });
    }
    return isShop ? handleShopDetail(id, env) : handleProductDetail(id, env);
  }

  return isShop ? handleShopList(url, env) : handleProductList(url, env);
}
