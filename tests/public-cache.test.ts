/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, expect, it, vi } from "vitest";
import { PUBLIC_FRESH_SECONDS, PUBLIC_RETAIN_SECONDS, publicCacheKey, withPublicResponseCache } from "../src/cache/publicResponseCache";
import type { ResponseStore } from "../src/cache/responseStore";

class MemoryStore implements ResponseStore {
  readonly values = new Map<string, Response>();
  async match(request: Request) { return this.values.get(request.url)?.clone(); }
  async put(request: Request, response: Response) { this.values.set(request.url, response.clone()); }
}
const fresh = (value: string) => Response.json({ value }, { headers: { "Cache-Control": "public, max-age=30", "X-D1-Rows-Read": "123" } });
const request = (query = "", headers?: HeadersInit) => new Request(`https://cache-fixture.example/api/products${query}`, { headers });
const quota = () => { throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit."); };

describe("公开结果缓存与配额降级", () => {
  it("Cookie不绕过公开缓存，无关参数不制造新键，命中时明确0行读取", async () => {
    const store = new MemoryStore();
    const load = vi.fn(async () => fresh("same"));
    const first = await withPublicResponseCache(request("?type=cdk&sort=shop-desc"), load, store);
    expect(first.headers.get("X-Prism-Cache")).toBe("MISS");
    const hit = await withPublicResponseCache(request("?sort=relevance&type=recharge&nonce=456", { Cookie: "theme=dark" }), load, store);
    expect(await hit.json()).toEqual({ value: "same" });
    expect(hit.headers.get("X-Prism-Cache")).toBe("HIT");
    expect(hit.headers.get("X-D1-Rows-Read")).toBe("0");
    const same = await withPublicResponseCache(request("?type=recharge&fields=sync", { Authorization: "Bearer ignored" }), load, store);
    expect(same.headers.get("X-Prism-Cache")).toBe("HIT");
    expect(same.headers.get("X-D1-Queries")).toBe("0");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("成功副本过新鲜期后遇到额度错误仍可读，新请求熔断且不串搜索结果", async () => {
    const store = new MemoryStore();
    let time = Date.parse("2026-11-12T08:00:00Z");
    const now = () => time;
    await withPublicResponseCache(request("?q=Codex"), async () => fresh("codex"), store, now);
    time += (PUBLIC_FRESH_SECONDS + 1) * 1000;
    const failing = vi.fn(async () => quota());
    const stale = await withPublicResponseCache(request("?q=Codex"), failing, store, now);
    expect(stale.status).toBe(200);
    expect(stale.headers.get("X-Data-Stale")).toBe("1");
    expect(stale.headers.get("X-D1-Rows-Read")).toBe("unknown");
    expect(await stale.json()).toEqual({ value: "codex" });
    const cold = await withPublicResponseCache(request("?q=Gemini"), failing, store, now);
    expect(cold.status).toBe(503);
    expect(await cold.json()).toMatchObject({ code: "D1_DAILY_LIMIT" });
    expect(Number(cold.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(failing).toHaveBeenCalledTimes(1);
    const again = await withPublicResponseCache(request("?q=Codex"), failing, store, now);
    expect(again.headers.get("X-Prism-Cache")).toBe("STALE");
    expect(again.headers.get("X-D1-Rows-Read")).toBe("0");
    expect(failing).toHaveBeenCalledTimes(1);
    time = Date.parse("2026-11-13T00:00:01Z");
    const recovered = await withPublicResponseCache(request("?q=Codex"), async () => fresh("recovered"), store, now);
    expect(await recovered.json()).toEqual({ value: "recovered" });
    expect(recovered.headers.get("X-Prism-Cache")).toBe("MISS");
  });
  it("超过24小时的副本不继续冒充可用数据", async () => {
    const store = new MemoryStore();
    let time = Date.parse("2026-11-12T08:00:00Z");
    await withPublicResponseCache(request(), async () => fresh("old"), store, () => time);
    time += (PUBLIC_RETAIN_SECONDS + 1) * 1000;
    const response = await withPublicResponseCache(request(), async () => quota(), store, () => time);
    expect(response.status).toBe(503);
    expect(response.headers.has("X-Data-Stale")).toBe(false);
  });
  it("普通源站错误可使用副本，但不把整个节点熔断一天", async () => {
    const store = new MemoryStore();
    let time = Date.parse("2026-11-12T08:00:00Z");
    await withPublicResponseCache(request(), async () => fresh("old"), store, () => time);
    time += (PUBLIC_FRESH_SECONDS + 1) * 1000;
    const stale = await withPublicResponseCache(request(), async () => { throw new Error("temporary"); }, store, () => time);
    expect(stale.headers.get("X-Prism-Cache")).toBe("STALE");
    const other = await withPublicResponseCache(request("?q=other"), async () => fresh("new"), store, () => time);
    expect(await other.json()).toEqual({ value: "new" });
  });
  it("完整商品目录、鉴权店铺读取和私有响应都绕过共享缓存", async () => {
    const store = new MemoryStore();
    const load = vi.fn(async () => Response.json({ private: true }, { headers: { "Cache-Control": "private, no-store", "Set-Cookie": "test=private" } }));
    await withPublicResponseCache(new Request("https://cache-fixture.example/api/shops?page=1", {
      headers: { Authorization: "Bearer test-only" },
    }), load, store);
    expect((await withPublicResponseCache(request("?full=1"), load, store)).headers.has("X-Prism-Cache")).toBe(false);
    await withPublicResponseCache(new Request("https://cache-fixture.example/api/shops?fields=%20sync%20"), load, store);
    const response = await withPublicResponseCache(request(), load, store);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Prism-Cache")).toBe("BYPASS");
    expect(store.values.size).toBe(0);
  });
  it("未缓存错误响应；合法分页、定制价格和无分页目录不混用", async () => {
    const store = new MemoryStore();
    const load = vi.fn(async () => Response.json({ error: "temporary" }, { status: 500 }));
    await withPublicResponseCache(request(), load, store);
    await withPublicResponseCache(request(), load, store);
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.values.size).toBe(0);
    expect(publicCacheKey(request("?minPrice=20&maxPrice=10")).url).toBe(publicCacheKey(request("?maxPrice=20&minPrice=10")).url);
    expect(publicCacheKey(new Request("https://cache-fixture.example/api/shops")).url)
      .not.toBe(publicCacheKey(new Request("https://cache-fixture.example/api/shops?page=1")).url);
  });
  it("分页店铺结果复用30秒，仍按筛选隔离并绕过内部同步清单", async () => {
    const store = new MemoryStore();
    let time = 0;
    const now = () => time;
    const shops = (query: string) => new Request(`https://cache-fixture.example/api/shops?${query}`);
    const load = vi.fn(async () => fresh("shops"));
    const first = await withPublicResponseCache(shops("page=1"), load, store, now);
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=30");
    time = 20_000;
    const hit = await withPublicResponseCache(shops("page=1"), load, store, now);
    expect(hit.headers.get("X-D1-Queries")).toBe("0");
    expect(hit.headers.get("Cache-Control")).toBe("public, max-age=10");
    expect((await withPublicResponseCache(shops("page=1&systemType=ldxp"), load, store, now)).headers.get("X-Prism-Cache")).toBe("MISS");
    expect((await withPublicResponseCache(shops("page=1&fields=sync"), load, store, now)).headers.has("X-Prism-Cache")).toBe(false);
    time = 31_000;
    expect((await withPublicResponseCache(shops("page=1"), load, store, now)).headers.get("X-Prism-Cache")).toBe("MISS");
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("库存筛选的列表响应与查询结果同窗过期", async () => {
    const store = new MemoryStore();
    const load = vi.fn(async () => fresh("stocks"));
    const query = request("?hideRecentOutOfStock=1");
    const late = await withPublicResponseCache(query, load, store, () => 28_000);
    expect(late.headers.get("Cache-Control")).toBe("public, max-age=2");
    const hit = await withPublicResponseCache(query, load, store, () => 29_000);
    expect(hit.headers.get("X-Prism-Cache")).toBe("HIT");
    const nextWindow = await withPublicResponseCache(query, load, store, () => 30_000);
    expect(nextWindow.headers.get("X-Prism-Cache")).toBe("MISS");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

it("Cache API故障不吞掉正常查询结果", async () => {
  const broken: ResponseStore = { match: async () => { throw new Error('cache unavailable'); }, put: async () => { throw new Error('cache unavailable'); } };
  const response = await withPublicResponseCache(request(), async () => fresh('live'), broken);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({value:'live'});
});

it('可抓取目录分页缓存区分页码并忽略跟踪参数', async () => {
  const cache = await import('../src/cache/publicResponseCache');
  const first = new Request('https://example.test/catalog/shops/?after=a&utm_source=x');
  const same = new Request('https://example.test/catalog/shops/?after=a&utm_source=y');
  const second = new Request('https://example.test/catalog/shops/?after=b');
  expect(cache.isPublicCacheRequest(first)).toBe(true);
  expect(cache.publicCacheKey(first).url).toBe(cache.publicCacheKey(same).url);
  expect(cache.publicCacheKey(first).url).not.toBe(cache.publicCacheKey(second).url);
});
