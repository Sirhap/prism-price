import type { AdapterType } from "../types";

export interface SeedShopEntry {
  id: string;
  shopName: string;
  shopUrl: string;
  canonicalUrl: string;
  adapterType: AdapterType;
  syncSupported: boolean;
}

/**
 * 正式版默认收录店铺清单（可通过 POST /api/admin/shops 或推送脚本动态扩展）
 */
export const INITIAL_SHOPS: SeedShopEntry[] = [
  {
    id: "real-wzyp-ms-ai",
    shopName: "麦枢AI (招代理)",
    shopUrl: "https://pay.ldxp.cn/shop/ms_ai",
    canonicalUrl: "https://wzyp.cn/shop/ms_ai",
    adapterType: "push_ingest",
    syncSupported: true,
  },
  {
    id: "real-wzyp-qy699",
    shopName: "699🔥对接码qy699",
    shopUrl: "https://pay.ldxp.cn/shop/qy699",
    canonicalUrl: "https://wzyp.cn/shop/qy699",
    adapterType: "push_ingest",
    syncSupported: true,
  },
  {
    id: "real-wzyp-ocbp9cjz",
    shopName: "sms688🔥对接码qy688",
    shopUrl: "https://pay.ldxp.cn/shop/OCBP9CJZ",
    canonicalUrl: "https://wzyp.cn/shop/OCBP9CJZ",
    adapterType: "push_ingest",
    syncSupported: true,
  },
  {
    id: "real-catfk-adeng",
    shopName: "阿灯GPT",
    shopUrl: "https://catfk.com/shop/adeng",
    canonicalUrl: "https://catfk.com/shop/adeng",
    adapterType: "push_ingest",
    syncSupported: true,
  },
  {
    id: "real-ka123-plus",
    shopName: "KA123 · 数字卡密平台",
    shopUrl: "https://ka123.plus/",
    canonicalUrl: "https://ka123.plus/",
    adapterType: "ka123_api",
    syncSupported: true,
  },
];
