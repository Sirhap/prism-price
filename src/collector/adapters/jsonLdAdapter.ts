import type { RawOfferItem, RawShopSnapshot, ShopRecord, StockStatus } from "../../types";
import { isNonSalePlaceholderItem } from "../etl/cleaner";
import {
  extractTelegramFromSources,
  fetchUpstreamResponse,
  normalizeDescription,
  type ShopAdapter,
} from "./fetcher";

/** 汇率参考常量（与 jsonApiAdapter 保持一致，将 USD/USDT 标价统一折合为人民币） */
const USD_TO_CNY_RATE = 7.15;
const MAX_JSONLD_TOTAL_BYTES = 256 * 1024;
const MAX_EXTRACT_ITEMS = 500;

interface ParsedJsonLdResult {
  storeNames: string[];
  descriptions: string[];
  offers: RawOfferItem[];
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

function hasSchemaType(node: Record<string, unknown>, targetTypes: ReadonlySet<string>): boolean {
  const rawType = node["@type"];
  for (const t of asArray(rawType as string | string[] | undefined)) {
    const clean = String(t || "").trim().replace(/^https?:\/\/schema\.org\//i, "");
    if (targetTypes.has(clean)) {
      return true;
    }
  }
  return false;
}

function parseOfferPrice(rawValue: unknown): number {
  if (typeof rawValue === "number") {
    return rawValue;
  }
  if (typeof rawValue !== "string") {
    return Number.NaN;
  }
  const cleaned = rawValue.replace(/[,，\s¥$￥€]/g, "").match(/-?\d+(?:\.\d+)?/);
  return cleaned ? Number(cleaned[0]) : Number.NaN;
}

function normalizeAvailability(rawAvailability: unknown): {
  inStock: boolean;
  stockStatus: StockStatus;
} {
  const text = String(rawAvailability || "").toLowerCase();
  if (text.includes("outofstock") || text.includes("soldout") || text.includes("discontinued")) {
    return { inStock: false, stockStatus: "low" };
  }
  if (text.includes("limitedavailability") || text.includes("low")) {
    return { inStock: true, stockStatus: "low" };
  }
  return { inStock: true, stockStatus: "sufficient" };
}

function resolveOfferItemUrl(rawUrl: unknown, fallbackUrl: string): string {
  const candidate = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!candidate) {
    return fallbackUrl;
  }
  try {
    return new URL(candidate, fallbackUrl).toString();
  } catch {
    return fallbackUrl;
  }
}

/**
 * 递归遍历 JSON-LD 对象图，提取商店元信息与 Schema.org Product/Offer 商品目录
 */
function collectJsonLdNodes(
  node: unknown,
  fallbackUrl: string,
  result: ParsedJsonLdResult,
  seenKeys: Set<string>,
  depth = 0,
): void {
  if (!node || depth > 12 || result.offers.length >= MAX_EXTRACT_ITEMS) {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectJsonLdNodes(item, fallbackUrl, result, seenKeys, depth + 1);
    }
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  const record = node as Record<string, unknown>;

  if (hasSchemaType(record, new Set(["Store", "Organization", "LocalBusiness", "WebSite"]))) {
    const orgName = typeof record.name === "string" ? record.name.trim() : "";
    if (orgName) {
      result.storeNames.push(orgName);
    }
    const orgDesc = typeof record.description === "string" ? normalizeDescription(record.description) : "";
    if (orgDesc) {
      result.descriptions.push(orgDesc);
    }
  }

  const isProduct = hasSchemaType(record, new Set(["Product", "ProductGroup", "SoftwareApplication"]));
  const rawName = typeof record.name === "string" ? record.name.trim() : "";

  if (isProduct && rawName && record.offers !== undefined) {
    const productCategory =
      typeof record.category === "string"
        ? record.category.trim()
        : typeof (record.category as Record<string, unknown> | undefined)?.name === "string"
          ? String((record.category as Record<string, unknown>).name).trim()
          : "";
    const productUrl = resolveOfferItemUrl(record.url, fallbackUrl);
    const skuPrefix = String(record.sku || record.productID || record["@id"] || "").trim();
    const offerList = asArray(record.offers as Record<string, unknown> | Array<Record<string, unknown>>);

    for (let idx = 0; idx < offerList.length; idx += 1) {
      const offer = offerList[idx];
      if (!offer || typeof offer !== "object") {
        continue;
      }

      const { inStock, stockStatus } = normalizeAvailability(offer.availability);
      if (!inStock) {
        continue;
      }

      const rawPrice = parseOfferPrice(offer.price ?? offer.lowPrice);
      if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
        continue;
      }

      const currency = String(offer.priceCurrency || "CNY").trim().toUpperCase();
      const priceCny =
        currency === "USD" || currency === "USDT"
          ? Number((rawPrice * USD_TO_CNY_RATE).toFixed(2))
          : Number(rawPrice.toFixed(2));

      const variantName = typeof offer.name === "string" ? offer.name.trim() : "";
      const displayName =
        variantName && variantName !== rawName && !rawName.includes(variantName)
          ? `${rawName} · ${variantName}`
          : rawName;

      if (isNonSalePlaceholderItem(displayName, productCategory, priceCny)) {
        continue;
      }

      const rawInventory = (offer.inventoryLevel as Record<string, unknown> | undefined)?.value ?? offer.inventoryLevel;
      const stockCount =
        typeof rawInventory === "number" && Number.isFinite(rawInventory)
          ? Math.max(0, Math.floor(rawInventory))
          : null;
      if (stockCount !== null && stockCount <= 0) {
        continue;
      }

      const itemUrl = resolveOfferItemUrl(offer.url, productUrl);
      const itemKey = String(
        offer.sku ||
          offer["@id"] ||
          (skuPrefix ? (offerList.length > 1 ? `${skuPrefix}:${idx + 1}` : skuPrefix) : `${displayName}:${itemUrl}:${idx + 1}`),
      ).slice(0, 180);

      if (seenKeys.has(itemKey)) {
        continue;
      }
      seenKeys.add(itemKey);

      result.offers.push({
        itemKey,
        rawName: displayName,
        shopCategory: productCategory,
        price: priceCny,
        stockCount,
        stockStatus,
        itemUrl,
      });
    }
  }

  for (const key of ["@graph", "itemListElement", "mainEntity", "item", "hasPart"]) {
    if (record[key] !== undefined) {
      collectJsonLdNodes(record[key], fallbackUrl, result, seenKeys, depth + 1);
    }
  }
}

/**
 * 基于 Schema.org Product/Offer JSON-LD 的自建发卡站通用适配器。
 * 采用 Cloudflare Workers 原生 HTMLRewriter 流式提取 `<script type="application/ld+json">`，零重依赖且兼容标准独立站。
 */
export const jsonLdAdapter: ShopAdapter = {
  type: "json_ld",

  async fetchSnapshot(shop: ShopRecord, env: Env): Promise<RawShopSnapshot> {
    const { response, finalUrl } = await fetchUpstreamResponse(shop, env);

    const jsonBlocks: string[] = [];
    let currentJsonIndex = -1;
    let totalJsonBytes = 0;

    let siteNameMeta = "";
    let pageTitle = "";
    let metaDescription = "";
    const telegramCandidates: string[] = [];

    const rewriter = new HTMLRewriter()
      .on("script", {
        element(el) {
          const typeAttr = (el.getAttribute("type") || "").toLowerCase();
          if (typeAttr.includes("ld+json")) {
            currentJsonIndex = jsonBlocks.length;
            jsonBlocks.push("");
            el.onEndTag(() => {
              currentJsonIndex = -1;
            });
          } else {
            currentJsonIndex = -1;
          }
        },
        text(chunk) {
          if (currentJsonIndex < 0 || totalJsonBytes >= MAX_JSONLD_TOTAL_BYTES) {
            return;
          }
          totalJsonBytes += chunk.text.length;
          jsonBlocks[currentJsonIndex] += chunk.text;
        },
      })
      .on("title", {
        text(chunk) {
          if (pageTitle.length < 300) {
            pageTitle += chunk.text;
          }
        },
      })
      .on("meta", {
        element(el) {
          const name = (el.getAttribute("name") || "").toLowerCase();
          const prop = (el.getAttribute("property") || "").toLowerCase();
          const content = el.getAttribute("content") || "";
          if (!content) return;
          if (!siteNameMeta && prop === "og:site_name") {
            siteNameMeta = content.trim();
          }
          if (!metaDescription && (name === "description" || prop === "og:description")) {
            metaDescription = content;
          }
        },
      })
      .on("a[href]", {
        element(el) {
          const href = (el.getAttribute("href") || "").trim();
          if (href && (href.includes("t.me") || href.includes("telegram.") || href.startsWith("tg://"))) {
            telegramCandidates.push(href);
          }
        },
      });

    const transformed = rewriter.transform(response);
    await transformed.body?.pipeTo(new WritableStream());

    const parsedResult: ParsedJsonLdResult = {
      storeNames: [],
      descriptions: [],
      offers: [],
    };
    const seenKeys = new Set<string>();

    for (const block of jsonBlocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      try {
        const parsedJson = JSON.parse(trimmed) as unknown;
        collectJsonLdNodes(parsedJson, finalUrl, parsedResult, seenKeys);
      } catch {
        // 个别损坏的 JSON-LD 块跳过，继续解析其余结构化块
      }
    }

    if (jsonBlocks.length === 0) {
      throw new Error("目标页面未检测到 Schema.org JSON-LD 结构化数据");
    }

    const description =
      parsedResult.descriptions[0] || normalizeDescription(metaDescription);
    const telegram =
      extractTelegramFromSources(description, ...parsedResult.descriptions, ...telegramCandidates) ||
      shop.telegram;
    const resolvedShopName =
      parsedResult.storeNames[0] ||
      siteNameMeta ||
      pageTitle.trim().slice(0, 120) ||
      shop.shop_name;

    return {
      shopName: resolvedShopName,
      canonicalUrl: finalUrl,
      telegram,
      description,
      shopSellCount: null,
      salesVisible: false,
      depositVisible: false,
      depositMoney: null,
      items: parsedResult.offers,
    };
  },
};
