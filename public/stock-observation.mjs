function bandForCount(count) {
  if (count <= 0) return "out";
  if (count <= 5) return "low";
  if (count <= 20) return "normal";
  return "sufficient";
}

/** The legacy sufficient fallback is ambiguous when no count was stored. */
export function observedStockBand(count, status) {
  if (typeof count === "number" && Number.isFinite(count)) return bandForCount(count);
  if (status === "reported_sufficient") return "sufficient";
  if (status === "low" || status === "normal") return status;
  return "unknown";
}

export function normalizeStoredStockStatus(status) {
  return status === "low" || status === "normal" || status === "reported_sufficient" ? status : "sufficient";
}

/** Keep the observed band even when the storefront hides the exact quantity. */
export function readShopApiStock(extend) {
  const count = extend?.stock_count;
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return { stockCount: null, stockStatus: "sufficient" };
  }
  const band = bandForCount(count);
  if (band === "out") return { stockCount: 0, stockStatus: "low" };
  if (extend?.show_stock_type === 0) {
    return { stockCount: null, stockStatus: band === "sufficient" ? "reported_sufficient" : band };
  }
  return { stockCount: count, stockStatus: band };
}
