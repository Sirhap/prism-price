export interface IntegrationShopInput {
  shop_name?: string;
  description?: string;
  shop_url?: string;
  canonical_url?: string;
  submitted_integration_code?: string;
}
export function extractIntegrationCodes(...texts: Array<string | undefined>): string[];
export function normalizeIntegrationShopUrl(value: unknown): string;
export function resolveIntegrationCodes(shop: IntegrationShopInput): { codes: string[]; source: "public" | "submitted" | "manual" | "none" };
export function integrationCodeCandidateFilter(): { sql: string; params: string[] };
