export interface LdxpOfferVersion {
  itemKey: string;
  updatedAt: string;
  lastSyncedAt: string | null;
}

export function ldxpShopKey(value: string): string;
export function confirmMissingLdxpOffers(
  previous: LdxpOfferVersion[],
  observedKeys: ReadonlySet<string>,
  options?: { beforeRequest?: () => Promise<void> },
): Promise<{ confirmed: LdxpOfferVersion[]; interrupted: boolean }>;
