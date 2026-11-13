import type { AdapterType } from "../../types";
import type { ShopAdapter } from "./fetcher";
import { jsonApiAdapter } from "./jsonApiAdapter";
import { jsonLdAdapter } from "./jsonLdAdapter";
import { ka123Adapter } from "./ka123Adapter";
import { shopApiAdapter } from "./shopApiAdapter";
import { ssrHtmlAdapter } from "./ssrHtmlAdapter";

const ADAPTER_REGISTRY: Partial<Record<AdapterType, ShopAdapter>> = {
  shop_api: shopApiAdapter,
  ka123_api: ka123Adapter,
  json_api: jsonApiAdapter,
  ssr_html: ssrHtmlAdapter,
  json_ld: jsonLdAdapter,
};

/**
 * 根据适配器类型选择对应的源站采集实现（manual 与 push_ingest 不走云端主动拉取）
 */
export function resolveAdapter(adapterType: AdapterType): ShopAdapter | null {
  if (adapterType === "manual" || adapterType === "push_ingest") {
    return null;
  }
  return ADAPTER_REGISTRY[adapterType] ?? null;
}
