const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 3_600_000;
const WARNING_DAYS = 7;

function beijingDay(time: number): string {
  return new Date(time + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** A streak stays current overnight, but expires when an entire Beijing day is missed. */
export function isCurrentStockWarning(lastZeroDay: unknown, now = Date.now()): boolean {
  return typeof lastZeroDay === "string" &&
    (lastZeroDay === beijingDay(now) || lastZeroDay === beijingDay(now - DAY_MS));
}

export async function hasStockObservations(db: D1Database): Promise<boolean> {
  return !!await db.prepare("SELECT 1 FROM pragma_table_info('offers') WHERE name = 'stock_zero_days'").first();
}

/** Count only newly observed zero-stock days, and return groups whose warning previews need a refresh. */
export async function observeZeroStock(db: D1Database, offerIds: string[], nowIso: string) {
  if (!offerIds.length || !await hasStockObservations(db)) return { groups: [], writes: 0 };
  const now = Date.parse(nowIso);
  const today = beijingDay(now);
  const yesterday = beijingDay(now - DAY_MS);
  const result = await db.prepare(`UPDATE offers SET
      stock_zero_days = CASE WHEN stock_zero_day = ? THEN MIN(stock_zero_days + 1, ?) ELSE 1 END,
      stock_zero_day = ?
    WHERE id IN (SELECT value FROM json_each(?)) AND stock_count = 0
      AND (stock_zero_day IS NULL OR stock_zero_day < ?)
    RETURNING group_key, stock_zero_days`)
    .bind(yesterday, WARNING_DAYS, today, JSON.stringify(offerIds), today)
    .all<{ group_key: string; stock_zero_days: number }>();
  return {
    groups: result.results.filter((row) => row.stock_zero_days === WARNING_DAYS)
      .map((row) => row.group_key),
    writes: result.meta.rows_written,
  };
}

/** Only mature streaks are included in the materialized preview. */
export function stockWarningDay(row: { stock_zero_day?: unknown; stock_zero_days?: unknown }): string | undefined {
  return Number(row.stock_zero_days) >= WARNING_DAYS && typeof row.stock_zero_day === "string"
    ? row.stock_zero_day : undefined;
}

/** Expose an advisory flag, not internal observation metadata, on a public quote. */
export function stockWarning(offer: { stockWarningDay?: unknown }): { longTermOutOfStock?: true } {
  return isCurrentStockWarning(offer.stockWarningDay) ? { longTermOutOfStock: true } : {};
}
