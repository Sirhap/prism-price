import type { RawOfferItem } from "../../types";
import { MARKET16688_HOSTS, MARKET16688_ORIGIN } from "../../../scripts/lib/market16688.mjs";
import { classifyProduct, isNonSalePlaceholderItem, needsProductDetail, type ProductClassification } from "./cleaner";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_SHOP_REQUESTS = 2;
const REQUEST_TIMEOUT_MS = 2500;
const BATCH_TIMEOUT_MS = 6500;

const LDXP_DETAIL = "https://wzyp.cn/shopApi/Shop/goodsInfo";
const CATFK_DETAIL = "https://catfk.com/shopApi/Shop/goodsInfo";
const MARKET_DETAIL = `${MARKET16688_ORIGIN}/shopApi/goods/detail`;
const DETAIL_SOURCES = new Map([
  ["wzyp.cn", LDXP_DETAIL],
  ["pay.ldxp.cn", LDXP_DETAIL],
  ["catfk.com", CATFK_DETAIL],
  ["www.catfk.com", CATFK_DETAIL],
  ...MARKET16688_HOSTS.map(host => [host, MARKET_DETAIL] as const),
]);

function sourceFor(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && !parsed.port && !parsed.username && !parsed.password) {
      return DETAIL_SOURCES.get(parsed.hostname);
    }
  } catch {
    return undefined;
  }
}

function matchesOfferUrl(item: RawOfferItem, source: string): boolean {
  if (!/^[\w-]{1,180}$/.test(item.itemKey) || sourceFor(item.itemUrl) !== source) return false;
  const kind = source === MARKET_DETAIL ? "goods" : "item";
  return new URL(item.itemUrl).pathname.replace(/\/$/, "") === `/${kind}/${item.itemKey}`;
}

/** Share the detail budget across shops in a single ingestion or sync run. */
export function createProductDetailBudget(requests = 6) {
  return { remaining: requests, deadline: 0, stoppedSources: new Set<string>(), hasCache: undefined as Promise<boolean> | undefined };
}

export type ProductDetailBudget = ReturnType<typeof createProductDetailBudget>;

interface DetailPayload {
  code?: number;
  msg?: string;
  data?: { description?: string };
}

async function readDetailJson(response: Response): Promise<DetailPayload | null> {
  if (!response.body) throw new SyntaxError("Missing detail response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(text + decoder.decode());
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/** A null result means this offer has no readable description. Source failures stop further requests in this run. */
async function fetchDescription(source: string, itemKey: string, timeoutMs: number): Promise<string | null> {
  const response = await fetch(source, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(source === MARKET_DETAIL ? { goods_no: itemKey } : { goods_key: itemKey }),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    await response.body?.cancel();
    if (response.status === 404) return null;
    throw new Error(`Detail source HTTP ${response.status}`);
  }
  const result = await readDetailJson(response);
  if (!result) return null;
  if (result.code === 1 && result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
    return typeof result.data.description === "string" ? result.data.description.slice(0, 4000) : null;
  }
  if (result.code === 0 && typeof result.msg === "string" && /商品不存在|已下架/.test(result.msg)) {
    return null;
  }
  throw new Error("Detail source returned an unexpected response");
}

interface CachedDetail {
  offer_id: string;
  brand_group: string;
  attr_type: string;
  source_key: string | null;
  checked_at: string | null;
  classification: string | null;
}

interface DetailOptions {
  budget: ProductDetailBudget;
  shopId: string;
  shopUrl: string;
  nowIso: string;
  normalizationVersion: number;
  unchanged: boolean;
  observedKeys?: ReadonlySet<string>;
}

/**
 * Reuse observations for the same listing and rules. Only derived classifications are persisted.
 * For unchanged snapshots, start from prior unresolved or cached offers instead of classifying the whole shop.
 */
export async function prepareProductDetails(db: D1Database, items: RawOfferItem[], options: DetailOptions) {
  const { budget, shopId, shopUrl, nowIso, normalizationVersion, unchanged, observedKeys } = options;
  const classifications = new Map<string, ProductClassification>();
  const writes: D1PreparedStatement[] = [];
  const result = { classifications, writes, changed: false };
  const source = sourceFor(shopUrl);
  if (!source || !items.length) return result;
  const mayFetch = budget.remaining > 0 && (!budget.deadline || Date.now() < budget.deadline) && !budget.stoppedSources.has(source);

  budget.hasCache ??= db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'offer_classification_details'")
    .first().then(Boolean);
  if (!await budget.hasCache) return result;

  const { results } = await db.prepare(`
    SELECT offers.id AS offer_id, offers.brand_group, offers.attr_type, detail.source_key, detail.checked_at, detail.classification
    FROM offers LEFT JOIN offer_classification_details AS detail ON detail.offer_id = offers.id
    WHERE offers.shop_id = ? AND (offers.brand_group = '其它' OR detail.offer_id IS NOT NULL)
  `).bind(shopId).all<CachedDetail>();
  const cache = new Map(results.map(row => [row.offer_id, row]));
  const due: Array<{ item: RawOfferItem; offerId: string; sourceKey: string; previous?: CachedDetail }> = [];
  const cutoff = new Date(Date.parse(nowIso) - CACHE_TTL_MS).toISOString();
  for (const item of items) {
    const { itemKey, rawName, shopCategory, itemUrl } = item;
    const offerId = `${shopId}:${itemKey}`;
    const cached = cache.get(offerId);
    if (unchanged && !cached) continue;
    const sourceKey = JSON.stringify([normalizationVersion, source, rawName, shopCategory, itemUrl]);
    const previous = cached?.source_key === sourceKey ? cached : undefined;
    if (previous?.classification) {
      const classification: ProductClassification = JSON.parse(previous.classification);
      classifications.set(itemKey, classification);
      result.changed ||= previous.brand_group !== classification.brandGroup || previous.attr_type !== classification.attributes.attrType;
    }
    if (!mayFetch || previous?.checked_at && previous.checked_at > cutoff ||
        observedKeys && !observedKeys.has(itemKey) || !matchesOfferUrl(item, source) ||
        isNonSalePlaceholderItem(rawName, shopCategory, item.price) ||
        !needsProductDetail(rawName, shopCategory)) continue;
    due.push({ item, offerId, sourceKey, previous });
  }
  due.sort((a, b) => (a.previous?.checked_at ?? "").localeCompare(b.previous?.checked_at ?? ""));

  for (const { item, offerId, sourceKey, previous } of due.slice(0, Math.min(MAX_SHOP_REQUESTS, budget.remaining))) {
    budget.deadline ||= Date.now() + BATCH_TIMEOUT_MS;
    const timeout = Math.min(REQUEST_TIMEOUT_MS, budget.deadline - Date.now());
    if (timeout <= 0) break;
    budget.remaining--;
    let description: string | null;
    try {
      description = await fetchDescription(source, item.itemKey, timeout);
    } catch {
      budget.stoppedSources.add(source);
      break;
    }
    const classified = description ? classifyProduct(item.rawName, item.shopCategory, description) : undefined;
    let classification = previous?.classification ?? null;
    if (classified?.evidence === "detail") {
      if (classified.brandGroup === "其它") {
        classification = null;
        classifications.delete(item.itemKey);
      } else {
        classification = JSON.stringify(classified);
        classifications.set(item.itemKey, classified);
      }
    }
    result.changed ||= classification !== (previous?.classification ?? null);
    writes.push(db.prepare(`
      INSERT INTO offer_classification_details (offer_id, source_key, checked_at, classification)
      SELECT id, ?, ?, ? FROM offers WHERE id = ? AND raw_name = ? AND shop_category = ? AND item_url = ?
      ON CONFLICT (offer_id) DO UPDATE SET source_key = excluded.source_key, checked_at = excluded.checked_at,
        classification = excluded.classification
      WHERE excluded.checked_at >= offer_classification_details.checked_at
    `).bind(sourceKey, nowIso, classification, offerId, item.rawName, item.shopCategory, item.itemUrl));
  }
  return result;
}
