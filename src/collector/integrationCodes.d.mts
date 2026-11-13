export interface IntegrationShopInput {
  shop_name?: string;
  description?: string;
  shop_url?: string;
  canonical_url?: string;
}
export function extractIntegrationCodes(...texts: Array<string | undefined>): string[];
export function normalizeIntegrationShopUrl(value: unknown): string;
export function resolveIntegrationCodes(shop: IntegrationShopInput): { codes: string[]; source: "public" | "manual" | "none" };
export function integrationCodeCandidateFilter(): { sql: string; params: string[] };
