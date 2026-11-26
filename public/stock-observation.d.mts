import type { StockStatus } from "../src/types";

export function observedStockBand(
  count: unknown, status: unknown,
): "out" | "low" | "normal" | "sufficient" | "unknown";
export function normalizeStoredStockStatus(status: unknown): StockStatus;
export function readShopApiStock(extend?: { stock_count?: number | null; show_stock_type?: number } | null): {
  stockCount: number | null;
  stockStatus: StockStatus;
};
