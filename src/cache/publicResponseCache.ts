import { normalizeProductQuery, normalizeShopSort, positiveInteger } from "../routes/search";
import { normalizeShopSystem } from "../collector/shopSystems";

export const PUBLIC_FRESH_SECONDS = 600;
export const PUBLIC_RETAIN_SECONDS = 86400;
const PREFIX = "/__prism_public_cache__/v2";
export interface ResponseStore {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export function isPublicCacheRequest(request: Request): boolean {
  const url = new URL(request.url);
  return request.method === "GET" && !request.headers.has("Authorization") &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    url.searchParams.get("fields")?.trim() !== "sync" &&
    (url.pathname.startsWith("/catalog/") || url.pathname === "/api/products" || url.pathname === "/api/shops" || /^\/api\/shops\/[^/]+(?:\/products)?$/.test(url.pathname));
}

/** 只纳入会改变公开结果的参数；忽略随机追踪参数，并统一旧别名、默认值与分页边界。 */
export function publicCacheKey(request: Request): Request {
  const url = new URL(request.url);
  const key = new URL(PREFIX + url.pathname, url.origin);
  const source = url.searchParams;
  if (url.pathname === "/catalog/shops/" || url.pathname === "/catalog/products/") {
    key.searchParams.set("after", source.get("after") || "");
    if (source.has("page")) key.searchParams.set("page", source.get("page") || "");
  } else if (url.pathname === "/api/products") {
    const offerKey = (source.get("offerKey") || "").trim();
    if (offerKey) key.searchParams.set("offerKey", offerKey);
    else {
      const normalized = normalizeProductQuery(source);
      for (const [name, value] of Object.entries(normalized.appliedFilters)) key.searchParams.set(name, String(value));
      for (const [name, value] of Object.entries(normalized.appliedPriceRange)) if (value !== null) key.searchParams.set(name, String(value));
      key.searchParams.set("page", String(positiveInteger(source.get("page"), 1, 1_000_000)));
      key.searchParams.set("pageSize", String(positiveInteger(source.get("pageSize"), 30, 50)));
      key.searchParams.set("facets", source.get("facets") === "0" ? "0" : "1");
    }
  } else if (url.pathname === "/api/shops") {
    const flag = (name: string) => ["1", "true", "yes"].includes((source.get(name) || "").trim().toLowerCase());
    key.searchParams.set("q", (source.get("q") || "").trim());
    key.searchParams.set("systemType", normalizeShopSystem(source.get("systemType")) || "all");
    key.searchParams.set("sort", normalizeShopSort(source.get("sort")));
    key.searchParams.set("onlyInStock", flag("onlyInStock") || flag("hasProducts") ? "1" : "0");
    for (const name of ["hasIntegrationCode", "hasDescription"]) key.searchParams.set(name, flag(name) ? "1" : "0");
    if (source.has("page")) {
      key.searchParams.set("page", String(positiveInteger(source.get("page"), 1, 1_000_000)));
      key.searchParams.set("pageSize", String(positiveInteger(source.get("pageSize"), 36, 100)));
    }
  }
  key.searchParams.sort();
  return new Request(key, { method: "GET" });
}

export function isDailyD1Limit(error: unknown): boolean {
  return /D1.*(?:exceeded.*daily.*(?:read|write).*limit|daily.*(?:read|write).*limit.*exceeded)/i.test(String(error));
}

function nextReset(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export function quotaUnavailable(now = Date.now(), noDatabaseAttempt = false): Response {
  return Response.json({ error: "今日数据访问额度已用完，请稍后再试。", code: "D1_DAILY_LIMIT" }, {
    status: 503,
    headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, Math.ceil((nextReset(now) - now) / 1000))), "X-D1-Rows-Read": noDatabaseAttempt ? "0" : "unknown" },
  });
}

function cachedResponse(response: Response, stale: boolean, ageMs: number, originAttempted = false): Response {
  const headers = new Headers(response.headers);
  headers.delete("X-Prism-Stored-At");
  headers.set("X-Prism-Cache", stale ? "STALE" : "HIT");
  headers.set("X-D1-Rows-Read", originAttempted ? "unknown" : "0");
  headers.set("X-D1-Queries", originAttempted ? "unknown" : "0");
  headers.set("Cache-Control", stale ? "no-store" : `public, max-age=${Math.max(0, Math.min(60, PUBLIC_FRESH_SECONDS - Math.floor(ageMs / 1000)))}`);
  if (stale) headers.set("X-Data-Stale", "1");
  return new Response(response.body, { status: response.status, headers });
}

/**
 * 公开结果新鲜10分钟、成功副本保留24小时。限额触发后在当前节点熔断至UTC零点；
 * 有匹配副本则回退，没有副本返回明确503，不把其它搜索结果冒充当前结果。
 * Cache API按节点缓存且可能被淘汰，不是持久备份。
 */
export async function withPublicResponseCache(
  request: Request,
  load: () => Promise<Response>,
  store: ResponseStore = caches.default,
  now: () => number = Date.now,
): Promise<Response> {
  if (!isPublicCacheRequest(request)) return load();
  const key = publicCacheKey(request);
  const time = now();
  const blockUrl = new URL(PREFIX + "/quota/" + new Date(time).toISOString().slice(0, 10), request.url);
  const blockKey = new Request(blockUrl);
  const match = async (target: Request) => {
    try { return await store.match(target); }
    catch { return undefined; }
  };
  const put = async (target: Request, value: Response) => {
    try { await store.put(target, value); }
    catch (error) { console.warn(JSON.stringify({ event: "public_cache_write_failed", error: String(error) })); }
  };
  let saved = await match(key);
  const storedAt = saved ? Number(saved.headers.get("X-Prism-Stored-At")) : NaN;
  const age = time - storedAt;
  if (!Number.isFinite(age) || age < 0 || age > PUBLIC_RETAIN_SECONDS * 1000) saved = undefined;
  if (saved && age <= PUBLIC_FRESH_SECONDS * 1000) return cachedResponse(saved, false, age);
  if (await match(blockKey)) return saved ? cachedResponse(saved, true, age) : quotaUnavailable(time, true);

  try {
    const response = await load();
    if (response.status >= 500 && saved) return cachedResponse(saved, true, age, true);
    const publicResponse = response.ok && response.headers.get("Cache-Control")?.startsWith("public,") && !response.headers.has("Set-Cookie");
    if (publicResponse) {
      const stored = response.clone();
      const headers = new Headers(stored.headers);
      headers.set("Cache-Control", `public, max-age=${PUBLIC_RETAIN_SECONDS}`);
      headers.set("X-Prism-Stored-At", String(time));
      headers.delete("X-Prism-Cache");
      headers.delete("X-Data-Stale");
      await put(key, new Response(stored.body, { status: stored.status, headers }));
    }
    const headers = new Headers(response.headers);
    headers.set("X-Prism-Cache", publicResponse ? "MISS" : "BYPASS");
    if (publicResponse) headers.set("Cache-Control", "public, max-age=60");
    else if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (isDailyD1Limit(error)) {
      await put(blockKey, new Response("quota", { headers: { "Cache-Control": `public, max-age=${Math.max(1, Math.ceil((nextReset(time) - time) / 1000))}` } }));
      console.warn(JSON.stringify({ event: "d1_daily_limit_circuit_open", path: new URL(request.url).pathname }));
      return saved ? cachedResponse(saved, true, age, true) : quotaUnavailable(time);
    }
    if (saved) {
      console.warn(JSON.stringify({ event: "public_stale_on_origin_error", path: new URL(request.url).pathname }));
      return cachedResponse(saved, true, age, true);
    }
    throw error;
  }
}
