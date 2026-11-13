import type { RawOfferItem, RawShopSnapshot, ShopRecord, StockStatus } from "../../types";
import { assertSafePublicUrl, type ShopAdapter } from "./fetcher";

interface Ka123CatalogResponse {
  ok: boolean;
  data?: {
    sections?: Array<{ id: string; title: string }>;
    products?: Array<{
      id: string;
      section_id?: string;
      name: string;
      price_micro?: number;
      stock_available?: number | null;
      listed?: boolean;
      can_issue?: boolean;
      issue_enabled?: boolean;
    }>;
    exchange_rate?: {
      rate?: number;
    };
  };
}

/**
 * KA123 数字卡密平台公开目录 API 适配器（支持 USDT 实时汇率折算）
 */
export const ka123Adapter: ShopAdapter = {
  type: "ka123_api",

  async fetchSnapshot(shop: ShopRecord, _env: Env): Promise<RawShopSnapshot> {
    const baseOrigin = assertSafePublicUrl(shop.shop_url).origin;
    const catalogUrl = `${baseOrigin}/api/catalog`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("KA123 catalog timeout"), 9000);
    let payload: Ka123CatalogResponse;
    try {
      const response = await fetch(catalogUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; LdxpDirectoryBot/1.0)",
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} from ${catalogUrl}`);
      }
      payload = (await response.json()) as Ka123CatalogResponse;
    } finally {
      clearTimeout(timer);
    }

    if (!payload.ok || !payload.data) {
      throw new Error("KA123 目录接口返回异常");
    }

    const rate = Number(payload.data.exchange_rate?.rate || 6.64);
    const sectionMap = new Map((payload.data.sections || []).map((s) => [s.id, s.title]));
    const items: RawOfferItem[] = [];

    for (const prod of payload.data.products || []) {
      if (prod.listed === false || prod.can_issue === false || prod.issue_enabled === false) {
        continue;
      }

      const rawStock = prod.stock_available;
      if (typeof rawStock === "number" && rawStock <= 0) {
        continue;
      }

      const usdtPrice = Number(prod.price_micro || 0) / 1_000_000;
      if (!Number.isFinite(usdtPrice) || usdtPrice <= 0) {
        continue;
      }

      const priceCny = Number((usdtPrice * rate).toFixed(2));
      const stockCount = typeof rawStock === "number" ? rawStock : null;
      const stockStatus: StockStatus =
        stockCount !== null && stockCount <= 5
          ? "low"
          : stockCount !== null && stockCount <= 20
            ? "normal"
            : "sufficient";

      items.push({
        itemKey: prod.id,
        rawName: `${prod.name}（${usdtPrice.toFixed(2)} USDT 折合）`,
        shopCategory: sectionMap.get(prod.section_id || "") || "",
        price: priceCny,
        stockCount,
        stockStatus,
        itemUrl: `${baseOrigin}/#shop`,
      });
    }

    return {
      shopName: "KA123 · 数字卡密平台",
      canonicalUrl: `${baseOrigin}/`,
      telegram: "@Ka123plusKF",
      description: "",
      shopSellCount: null,
      salesVisible: false,
      depositVisible: false,
      depositMoney: null,
      items,
    };
  },
};
