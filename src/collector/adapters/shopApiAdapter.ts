import { isNonSalePlaceholderItem } from "../etl/cleaner";
import type { RawOfferItem, RawShopSnapshot, ShopRecord, StockStatus } from "../../types";
import {
  assertSafePublicUrl,
  extractTelegramFromSources,
  normalizeDescription,
  readBoundedSnippet,
  type ShopAdapter,
} from "./fetcher";

const SUPPORTED_GOODS_TYPES = ["card", "article", "resource", "equity"] as const;
type SupportedGoodsType = (typeof SUPPORTED_GOODS_TYPES)[number];
const MAX_GOODS_PAGES = 200;
const MAX_CATEGORY_FALLBACK = 15;

interface ShopApiInfoResponse {
  code: number;
  msg?: string;
  data?: {
    link?: string;
    nickname?: string;
    description?: string;
    contact_qq?: string;
    contact_wechat?: string;
    link_buttons?: Array<{ name?: string; url?: string; link?: string }>;
    sell_count?: number | null;
    deposit_money?: number | null;
    custom_status?: number;
    custom_status_msg?: string;
    goods_type_sort?: string[];
    goods_count?: number | string | null;
    card_count?: number | string | null;
    article_count?: number | string | null;
    resource_count?: number | string | null;
    equity_count?: number | string | null;
  } | null;
}

interface ShopApiGoodsItem {
  link?: string;
  goods_key?: string;
  name?: string;
  price?: number | string;
  category?: { id?: number; name?: string } | null;
  extend?: {
    stock_count?: number | null;
    show_stock_type?: number;
  } | null;
}

interface ShopApiGoodsListResponse {
  code: number;
  msg?: string;
  data?: {
    total?: number;
    list?: ShopApiGoodsItem[];
  } | null;
}

interface ShopApiCategoryListResponse {
  code: number;
  msg?: string;
  data?: Array<{ id?: number | string; name?: string }> | null;
}

/**
 * 解析源站 Shop/info 返回的启用商品大类与已知计数，兼容仅含默认卡密字段的精简接口
 */
export function resolveShopGoodsTypes(
  infoData: NonNullable<ShopApiInfoResponse["data"]>,
): Array<{ goodsType: SupportedGoodsType; expectedCount: number | null }> {
  const ordered: SupportedGoodsType[] = [];
  for (const rawType of infoData.goods_type_sort || []) {
    if ((SUPPORTED_GOODS_TYPES as readonly string[]).includes(rawType)) {
      const typed = rawType as SupportedGoodsType;
      if (!ordered.includes(typed)) ordered.push(typed);
    }
  }
  for (const t of SUPPORTED_GOODS_TYPES) {
    if (!ordered.includes(t)) ordered.push(t);
  }

  const record = infoData as Record<string, unknown>;
  const resolved: Array<{ goodsType: SupportedGoodsType; expectedCount: number | null }> = [];
  for (const goodsType of ordered) {
    const rawCount = record[`${goodsType}_count`];
    if (rawCount !== undefined && rawCount !== null && rawCount !== "") {
      const parsed = Number(rawCount);
      if (Number.isFinite(parsed) && parsed > 0) {
        resolved.push({ goodsType, expectedCount: parsed });
      }
      continue;
    }
    if (goodsType === "card") {
      const compatRaw = infoData.goods_count;
      const compatCount =
        compatRaw !== undefined && compatRaw !== null && compatRaw !== "" ? Number(compatRaw) : null;
      if (compatCount !== null && Number.isFinite(compatCount) && compatCount > 0) {
        resolved.push({ goodsType, expectedCount: compatCount });
      }
    }
  }

  return resolved.length > 0 ? resolved : [{ goodsType: "card", expectedCount: null }];
}

/**
 * 解析发卡店铺 URL，提取 API Origin 与店铺 Token
 * 说明：pay.ldxp.cn 对外跳转至 wzyp.cn，直接映射规避冗余 301 重定向消耗
 */
function parseShopApiTarget(shopUrl: string): { apiOrigin: string; token: string } {
  const parsed = assertSafePublicUrl(shopUrl);
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const shopIdx = pathParts.indexOf("shop");
  const token = shopIdx >= 0 && pathParts[shopIdx + 1] ? pathParts[shopIdx + 1] : pathParts[0] || "";
  if (!token) {
    throw new Error(`无法从店铺 URL 解析 token: ${shopUrl}`);
  }

  const apiOrigin = parsed.hostname === "pay.ldxp.cn" ? "https://wzyp.cn" : parsed.origin;
  return { apiOrigin, token };
}

async function postShopApi<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("Shop API request timeout"), 9000);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; LdxpDirectoryBot/1.0)",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errSnippet = (await readBoundedSnippet(response, 1024)).slice(0, 200).replace(/\s+/g, " ");
      throw new Error(`HTTP ${response.status} (${response.headers.get("server") || "unknown"}): ${errSnippet}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      const text = await readBoundedSnippet(response, 4096);
      const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "";
      const snippet = text.replace(/\s+/g, " ").slice(0, 220);
      throw new Error(
        `非JSON响应 HTTP ${response.status} [${response.headers.get("server") || "-"}] title="${title}" body="${snippet}"`,
      );
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function resolveStock(extend: ShopApiGoodsItem["extend"]): {
  inStock: boolean;
  stockCount: number | null;
  stockStatus: StockStatus;
} {
  const rawCount = extend?.stock_count;
  const showType = extend?.show_stock_type;

  if (typeof rawCount === "number" && Number.isFinite(rawCount)) {
    if (rawCount <= 0) {
      return { inStock: true, stockCount: 0, stockStatus: "low" };
    }
    // show_stock_type === 0 时源站向前台隐藏精确数值
    const stockCount = showType === 0 ? null : rawCount;
    const stockStatus: StockStatus = rawCount <= 5 ? "low" : rawCount <= 20 ? "normal" : "sufficient";
    return { inStock: true, stockCount, stockStatus };
  }

  return { inStock: true, stockCount: null, stockStatus: "sufficient" };
}

function extractUniqueGoodsKey(item: ShopApiGoodsItem, fallbackIndex: number): string {
  return String(item.goods_key || item.link || `idx-${fallbackIndex}`).trim();
}

/**
 * 分页抓取单个商品大类（可选指定 category_id），并基于接口声明的 total 进行完整性护栏检查
 */
async function fetchPagedGoodsBatch(
  apiOrigin: string,
  token: string,
  goodsType: SupportedGoodsType,
  categoryId = "",
  firstPageCache?: ShopApiGoodsListResponse,
): Promise<{
  items: Array<ShopApiGoodsItem & { _fallbackCategoryName?: string }>;
  expectedTotal: number;
  rawUniqueCollected: number;
}> {
  const page1 =
    firstPageCache ||
    (await postShopApi<ShopApiGoodsListResponse>(`${apiOrigin}/shopApi/Shop/goodsList`, {
      token,
      goods_type: goodsType,
      ...(categoryId ? { category_id: categoryId } : {}),
      page: 1, current: 1,
      limit: 100, pageSize: 100,
    }));

  if (page1.code !== 1 || !page1.data) {
    throw new Error(page1.msg || `商品列表接口返回失败 (type=${goodsType}, code=${page1.code})`);
  }

  const list1 = page1.data.list || [];
  const expectedTotal = Math.max(0, Number(page1.data.total ?? list1.length) || 0);
  const collected: ShopApiGoodsItem[] = [];
  const seenKeys = new Set<string>();

  const collectBatch = (batch: ShopApiGoodsItem[]) => {
    for (const g of batch) {
      const k = extractUniqueGoodsKey(g, collected.length + 1);
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      collected.push(g);
    }
  };

  collectBatch(list1);

  let page = 2;
  let lastPageLen = list1.length;
  while (collected.length < expectedTotal && lastPageLen > 0 && page <= MAX_GOODS_PAGES) {
    const goodsNext = await postShopApi<ShopApiGoodsListResponse>(`${apiOrigin}/shopApi/Shop/goodsList`, {
      token,
      goods_type: goodsType,
      ...(categoryId ? { category_id: categoryId } : {}),
      page, current: page,
      limit: 100, pageSize: 100,
    });
    if (goodsNext.code !== 1 || !goodsNext.data) {
      throw new Error(goodsNext.msg || `商品分页接口返回失败 (type=${goodsType}, page=${page})`);
    }
    const nextList = goodsNext.data.list || [];
    if (nextList.length === 0) {
      break;
    }
    const before = collected.length;
    collectBatch(nextList);
    if (collected.length === before) break;
    lastPageLen = nextList.length;
    page += 1;
  }

  // 不论上游总量是否超出分页上限，只要不完整就禁止覆盖。
  if (collected.length < expectedTotal) {
    throw new Error(
      `店铺快照不完整 (type=${goodsType}${categoryId ? `/cat=${categoryId}` : ""}, expected=${expectedTotal}, collected=${collected.length})`,
    );
  }

  return {
    items: collected,
    expectedTotal,
    rawUniqueCollected: collected.length,
  };
}

/**
 * 真实发卡平台通用 /shopApi 适配器（支持 LDXP/wzyp.cn 与 catfk.com 等同构平台）
 */
export const shopApiAdapter: ShopAdapter = {
  type: "shop_api",

  async fetchSnapshot(shop: ShopRecord, _env: Env): Promise<RawShopSnapshot> {
    const { apiOrigin, token } = parseShopApiTarget(shop.shop_url);

    // 并发获取店铺详情与默认首页商品以压缩 Workers 请求耗时
    const [infoRes, defaultCardPage1] = await Promise.all([
      postShopApi<ShopApiInfoResponse>(`${apiOrigin}/shopApi/Shop/info`, { token }),
      postShopApi<ShopApiGoodsListResponse>(`${apiOrigin}/shopApi/Shop/goodsList`, {
        token,
        goods_type: "card",
        page: 1, current: 1,
        limit: 100, pageSize: 100,
      }),
    ]);

    if (infoRes.code !== 1 || !infoRes.data) {
      throw new Error(infoRes.msg || `店铺信息接口返回失败 (code=${infoRes.code})`);
    }

    const info = infoRes.data;
    const typeEntries = resolveShopGoodsTypes(info);
    const allGoods: Array<ShopApiGoodsItem & { _fallbackCategoryName?: string }> = [];

    for (const { goodsType, expectedCount } of typeEntries) {
      const cachedPage1 = goodsType === "card" ? defaultCardPage1 : undefined;
      const paged = await fetchPagedGoodsBatch(apiOrigin, token, goodsType, "", cachedPage1);

      if (paged.items.length > 0) {
        allGoods.push(...paged.items);
        continue;
      }

      // 极少数店铺在 Shop/info 显示某类有商品但无分类筛选返回空时，回退逐分类读取
      if (expectedCount !== null && expectedCount > 0) {
        const catRes = await postShopApi<ShopApiCategoryListResponse>(`${apiOrigin}/shopApi/Shop/categoryList`, {
          token,
          goods_type: goodsType,
          category_key: "",
        });
        const categories = catRes.code === 1 && Array.isArray(catRes.data) ? catRes.data : [];
        for (const cat of categories.slice(0, MAX_CATEGORY_FALLBACK)) {
          const cid = cat.id !== undefined && cat.id !== null ? String(cat.id).trim() : "";
          if (!cid) continue;
          const catPaged = await fetchPagedGoodsBatch(apiOrigin, token, goodsType, cid);
          for (const g of catPaged.items) {
            allGoods.push({
              ...g,
              _fallbackCategoryName: String(cat.name || "").trim(),
            });
          }
        }
      }
    }

    const seenItemKeys = new Set<string>();
    const items: RawOfferItem[] = [];
    for (const g of allGoods) {
      const rawName = String(g.name || "").trim();
      const price = Number(g.price);
      const shopCategory = String(g.category?.name || g._fallbackCategoryName || "").trim();
      if (!rawName || isNonSalePlaceholderItem(rawName, shopCategory, price)) {
        continue;
      }

      const stock = resolveStock(g.extend);

      const itemKey = String(g.goods_key || g.link || items.length + 1);
      if (seenItemKeys.has(itemKey)) {
        continue;
      }
      seenItemKeys.add(itemKey);
      items.push({
        itemKey,
        rawName,
        shopCategory,
        price: Number(price.toFixed(2)),
        stockCount: stock.stockCount,
        stockStatus: stock.stockStatus,
        itemUrl: String(g.link || `${apiOrigin}/item/${itemKey}`),
      });
    }

    const description = normalizeDescription(info.description);
    const linkButtons = Array.isArray(info.link_buttons) ? info.link_buttons : [];
    const buttonSources = linkButtons.flatMap((b) =>
      typeof b === "string" ? [b] : [b?.link, b?.url, b?.name],
    );
    const telegram =
      extractTelegramFromSources(
        info.description,
        ...buttonSources,
        info.contact_qq,
        info.contact_wechat,
      ) || shop.telegram;

    const sellCount = typeof info.sell_count === "number" && Number.isFinite(info.sell_count) ? info.sell_count : null;
    const depositMoney = typeof info.deposit_money === "number" && Number.isFinite(info.deposit_money) ? info.deposit_money : null;

    return {
      shopName: String(info.nickname || "").trim() || String(shop.shop_name || "").trim(),
      canonicalUrl: String(info.link || "").trim() || `${apiOrigin}/shop/${token}`,
      telegram,
      description,
      shopSellCount: sellCount,
      salesVisible: sellCount !== null,
      depositVisible: depositMoney !== null && depositMoney > 0,
      depositMoney,
      items,
    };
  },
};
