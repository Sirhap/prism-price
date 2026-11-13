import crypto from "node:crypto";
import brandRules from "../../src/config/brand-rules.json" with { type: "json" };

export const SNAPSHOT_NORMALIZATION_VERSION = 8;

/**
 * 与 Worker 使用相同的规则配置与快照字段计算增量摘要。
 * 注意：故意不包含 description，确保简介回填不触发商品与聚合组重写。
 */
export function computeSnapshotHash(snapshot) {
  const canonicalPayload = {
    normalizationVersion: SNAPSHOT_NORMALIZATION_VERSION,
    brandRules: brandRules.map(({ group, priority, includeAny = [], includeAll = [], excludeAny = [] }) => ({
      group, priority, includeAny, includeAll, excludeAny,
    })),
    shopName: snapshot.shopName,
    canonicalUrl: snapshot.canonicalUrl,
    salesVisible: snapshot.salesVisible,
    depositVisible: snapshot.depositVisible,
    telegram: snapshot.telegram,
    shopSellCount: snapshot.shopSellCount,
    depositMoney: snapshot.depositMoney,
    items: [...snapshot.items]
      .sort((a, b) => a.itemKey.localeCompare(b.itemKey))
      .map((item) => ({
        k: item.itemKey,
        n: item.rawName,
        c: item.shopCategory,
        p: item.price,
        sc: item.stockCount,
        ss: item.stockStatus,
        u: item.itemUrl,
      })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
}

