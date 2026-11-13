import type { RawOfferItem, RawShopSnapshot, ShopRecord, StockStatus } from "../../types";
import {
  extractTelegramFromSources,
  fetchUpstreamResponse,
  normalizeDescription,
  type ShopAdapter,
} from "./fetcher";

/** Demo 汇率常量：实际生产环境可定期从汇率接口更新并缓存在 D1/KV */
const USDT_TO_CNY_RATE = 7.15;

interface UpstreamJsonProduct {
  id?: string | number;
  title?: string;
  name?: string;
  categoryName?: string;
  category?: string;
  price?: number | string;
  currency?: string;
  stock?: number | null;
  stockCount?: number | null;
  stockLevel?: string;
  stockStatus?: string;
  url?: string;
  itemUrl?: string;
}

interface UpstreamJsonPayload {
  shop?: {
    name?: string;
    shopName?: string;
    canonicalUrl?: string;
    description?: string;
    notice?: string;
    telegram?: string;
    salesVisible?: boolean;
    sellCount?: number | null;
    depositVisible?: boolean;
    depositMoney?: number | null;
  };
  products?: UpstreamJsonProduct[];
}

function normalizeStockStatus(raw: string | undefined, stockCount: number | null): StockStatus {
  if (raw === "low" || raw === "normal" || raw === "sufficient") {
    return raw;
  }
  if (stockCount !== null) {
    if (stockCount <= 5) return "low";
    if (stockCount <= 20) return "normal";
  }
  return "sufficient";
}

/**
 * 公开只读 JSON 发卡接口直连适配器（适用于 SPA 发卡站）
 */
export const jsonApiAdapter: ShopAdapter = {
  type: "json_api",

  async fetchSnapshot(shop: ShopRecord, env: Env): Promise<RawShopSnapshot> {
    const { response, finalUrl } = await fetchUpstreamResponse(shop, env);
    const payload = (await response.json()) as UpstreamJsonPayload;

    const shopMeta = payload.shop || {};
    const rawProducts = Array.isArray(payload.products) ? payload.products : [];
    const items: RawOfferItem[] = [];

    for (let idx = 0; idx < rawProducts.length; idx += 1) {
      const p = rawProducts[idx];
      const rawName = String(p.title ?? p.name ?? "").trim();
      const basePrice = Number(p.price);
      if (!rawName || !Number.isFinite(basePrice) || basePrice <= 0) {
        continue;
      }

      const rawStock = p.stock ?? p.stockCount ?? null;
      const stockCount = rawStock === null || rawStock === undefined ? null : Number(rawStock);
      if (stockCount !== null && (!Number.isFinite(stockCount) || stockCount <= 0)) {
        continue;
      }

      const currency = String(p.currency || "CNY").toUpperCase();
      const priceCny = currency === "USDT" || currency === "USD"
        ? Number((basePrice * USDT_TO_CNY_RATE).toFixed(2))
        : Number(basePrice.toFixed(2));

      items.push({
        itemKey: String(p.id ?? idx + 1),
        rawName,
        shopCategory: String(p.categoryName ?? p.category ?? "").trim(),
        price: priceCny,
        stockCount,
        stockStatus: normalizeStockStatus(p.stockLevel ?? p.stockStatus, stockCount),
        itemUrl: String(p.url ?? p.itemUrl ?? finalUrl),
      });
    }

    const description =
      normalizeDescription(shopMeta.description) || normalizeDescription(shopMeta.notice);
    const rawTelegramField = typeof shopMeta.telegram === "string" ? shopMeta.telegram.trim() : "";
    const safeRawTelegram =
      rawTelegramField && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawTelegramField) ? rawTelegramField : "";
    const telegram =
      extractTelegramFromSources(shopMeta.telegram, shopMeta.notice, shopMeta.description) ||
      safeRawTelegram ||
      shop.telegram;

    return {
      shopName:
        String(shopMeta.name || "").trim() ||
        String(shopMeta.shopName || "").trim() ||
        String(shop.shop_name || "").trim(),
      canonicalUrl: String(shopMeta.canonicalUrl || "").trim() || finalUrl,
      telegram,
      description,
      shopSellCount: shopMeta.sellCount ?? null,
      salesVisible: Boolean(shopMeta.salesVisible),
      depositVisible: Boolean(shopMeta.depositVisible),
      depositMoney: shopMeta.depositMoney ?? null,
      items,
    };
  },
};
