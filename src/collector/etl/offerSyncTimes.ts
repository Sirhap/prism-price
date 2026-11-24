import { stockWarningDay } from "./stockObservations";

/** A complete snapshot covers all offers; a partial snapshot covers only observed rows. */
export function offerLastSyncedAt(observedAt: unknown, fullSyncAt: unknown): string | null {
  if (typeof observedAt !== "string") return typeof fullSyncAt === "string" ? fullSyncAt : null;
  if (typeof fullSyncAt !== "string") return observedAt;
  return Date.parse(observedAt) >= Date.parse(fullSyncAt) ? observedAt : fullSyncAt;
}

export async function hasOfferSyncTimes(db: D1Database): Promise<boolean> {
  return !!await db.prepare(
    "SELECT 1 FROM pragma_table_info('shops') WHERE name = 'last_full_sync_at'",
  ).first();
}

interface OfferObservation {
  lastSyncedAt: string | null;
  stockWarningDay?: string;
}

/** Read observations from the offer rows so previously built previews use the current warning threshold. */
export async function readOfferObservations(db: D1Database, ids: string[]): Promise<Map<string, OfferObservation>> {
  if (!ids.length) return new Map();
  const capabilities = await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM pragma_table_info('shops') WHERE name = 'last_full_sync_at') AS sync_times,
    EXISTS(SELECT 1 FROM pragma_table_info('offers') WHERE name = 'stock_zero_days') AS stock_days`)
    .first<{ sync_times: number; stock_days: number }>();
  if (!capabilities?.sync_times && !capabilities?.stock_days) return new Map();

  const timestamps = capabilities.sync_times ? ", o.last_observed_at, s.last_full_sync_at" : "";
  const stockDays = capabilities.stock_days ? ", o.stock_zero_day, o.stock_zero_days" : "";
  const shopsJoin = capabilities.sync_times ? "JOIN shops s ON s.id = o.shop_id" : "";
  const { results } = await db.prepare(
    `SELECT o.id${timestamps}${stockDays} FROM offers o ${shopsJoin}
     WHERE o.id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify([...new Set(ids)])).all<{
    id: string; last_observed_at?: string | null; last_full_sync_at?: string | null;
    stock_zero_day?: string | null; stock_zero_days?: number;
  }>();
  return new Map(results.map(row => [row.id, {
    lastSyncedAt: offerLastSyncedAt(row.last_observed_at, row.last_full_sync_at),
    stockWarningDay: stockWarningDay(row),
  }]));
}
