export interface Market16688OfferVersion {
  itemKey: string;
  updatedAt: string;
}

export const MARKET16688_MISSING_LIMIT: number;
export const MARKET16688_HOST: string;
export const MARKET16688_HOSTS: readonly string[];
export const MARKET16688_ORIGIN: string;
export function normalizeMarket16688Url(value: string): string;
export function market16688ShopKey(value: string): string;
export function isMarket16688OfferKey(value: unknown): value is string;
export function confirmMissingMarket16688Offers(
  previous: Market16688OfferVersion[],
  observedKeys: ReadonlySet<string>,
  options?: { beforeRequest?: () => Promise<void> },
): Promise<{ confirmed: Market16688OfferVersion[]; interrupted: boolean }>;
