export interface Market16688OfferVersion {
  itemKey: string;
  updatedAt: string;
}

export const MARKET16688_MISSING_LIMIT: number;
export function market16688ShopKey(value: string): string;
export function isMarket16688OfferKey(value: unknown): value is string;
export function confirmMissingMarket16688Offers(
  previous: Market16688OfferVersion[],
  observedKeys: ReadonlySet<string>,
  options?: { beforeRequest?: () => Promise<void> },
): Promise<{ confirmed: Market16688OfferVersion[]; interrupted: boolean }>;
