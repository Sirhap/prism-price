/** 公开统计按数据版本与搜索作用域复用；缓存不落 D1，也不跨请求保存数据库对象。 */
export async function cachedQuery<T>(url: URL, key: string, load: () => Promise<T>, seconds = 300): Promise<T> {
  // 本地开发及语义测试保持实时；缓存集成测试使用独立测试域名。
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return load();
  const cacheUrl = new URL("/__prism_query_cache__/v1", url.origin);
  cacheUrl.searchParams.set("key", key);
  const request = new Request(cacheUrl);
  try {
    const hit = await caches.default.match(request);
    if (hit) return await hit.json<T>();
  } catch (error) {
    console.warn(JSON.stringify({ event: "query_cache_read_failed", error: String(error) }));
  }
  const value = await load();
  try {
    await caches.default.put(request, Response.json(value, { headers: { "Cache-Control": `public, max-age=${seconds}` } }));
  } catch (error) {
    console.warn(JSON.stringify({ event: "query_cache_write_failed", error: String(error) }));
  }
  return value;
}

export interface CatalogIndexes { version: boolean; popular: boolean }

/** 迁移快照可能不含初始索引，缓存探测结果而不自动修改生产数据库。 */
export async function catalogIndexes(db: D1Database, url: URL): Promise<CatalogIndexes> {
  return cachedQuery(url, "catalog-indexes:v2", async () => {
    const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_pg_updated','idx_shops_updated','idx_pg_shop_count')")
      .all<{ name: string }>();
    const names = new Set(results.map((row) => row.name));
    return { version: names.has("idx_pg_updated") && names.has("idx_shops_updated"), popular: names.has("idx_pg_shop_count") };
  }, 3600);
}

/** 缺少更新时间索引时以5分钟窗口探测，避免为了缓存版本先扫描全表。 */
export async function catalogVersion(db: D1Database, url: URL, knownIndexes?: CatalogIndexes): Promise<string> {
  const indexes = knownIndexes ?? await catalogIndexes(db, url);
  if (!indexes.version) return `window:${Math.floor(Date.now() / 300_000)}`;
  const row = await db.prepare(`SELECT
    (SELECT MAX(updated_at) FROM product_groups) AS products,
    (SELECT MAX(updated_at) FROM shops) AS shops`).first<{ products: string | null; shops: string | null }>();
  return JSON.stringify([row?.products || "", row?.shops || ""]);
}

export async function cachedShopCount(url: URL, db: D1Database, version: string): Promise<number> {
  return cachedQuery(url, `shop-count:${version}`, async () => {
    const row = await db.prepare("SELECT COUNT(*) AS total FROM shops").first<{ total: number }>();
    return Number(row?.total || 0);
  });
}
