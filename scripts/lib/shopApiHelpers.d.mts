export function solveAcwScV2Cookie(htmlText: string): string;
export function mergeCookieHeaders(...cookieStrings: string[]): string;
export function resolveShopGoodsTypes(
  infoData: Record<string, unknown> | null | undefined,
): Array<{ goodsType: "card" | "article" | "resource" | "equity"; expectedCount: number | null }>;
export function isIncompleteGoodsBatch(params: {
  expectedTotal: number;
  collectedCount: number;
  maxPages?: number;
  pageSize?: number;
}): boolean;
export function isNonSalePlaceholderItem(
  rawName: string,
  shopCategory?: string,
  price?: number,
): boolean;
