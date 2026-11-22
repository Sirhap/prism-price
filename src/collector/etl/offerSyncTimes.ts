/** A complete snapshot covers all offers; a partial snapshot covers only observed rows. */
export function offerLastSyncedAt(observedAt: unknown, fullSyncAt: unknown): string | null {
  if (typeof observedAt !== "string") return typeof fullSyncAt === "string" ? fullSyncAt : null;
  if (typeof fullSyncAt !== "string") return observedAt;
  return Date.parse(observedAt) >= Date.parse(fullSyncAt) ? observedAt : fullSyncAt;
}

/** Read timestamps independently of the materialized prices so an unchanged sync need not rebuild groups. */
export async function readOfferSyncTimes(db: D1Database, ids: string[]): Promise<Map<string, string | null>> {
  if (!ids.length || !await db.prepare(
    "SELECT 1 FROM pragma_table_info('shops') WHERE name = 'last_full_sync_at'",
  ).first()) return new Map();

  const { results } = await db.prepare(
    `SELECT o.id, o.last_observed_at, s.last_full_sync_at
       FROM offers o JOIN shops s ON s.id = o.shop_id
       WHERE o.id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify([...new Set(ids)])).all<{ id: string; last_observed_at: string | null; last_full_sync_at: string | null }>();
  return new Map(results.map(row => [row.id, offerLastSyncedAt(row.last_observed_at, row.last_full_sync_at)]));
}
