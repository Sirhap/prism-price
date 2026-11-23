import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../deploy/huoshan/memory-cache";

const request = (key: string) => new Request(`https://catalog.example/${key}`);
const payload = (text: string, ttl = 30) => new Response(text, {
  headers: { "Cache-Control": `public, max-age=${ttl}`, "X-Test": "stored" },
});

describe("火山自托管缓存", () => {
  it("每次命中可独立读取，过期后移除", async () => {
    let now = 1_000;
    const store = createMemoryCache(4_096, 4, () => now);
    await store.put(request("shops"), payload("shop data", 5));
    const first = await store.match(request("shops"));
    expect(first?.headers.get("X-Test")).toBe("stored");
    expect(await first?.text()).toBe("shop data");
    expect(await (await store.match(request("shops")))?.text()).toBe("shop data");
    now += 5_000;
    expect(await store.match(request("shops"))).toBeUndefined();
  });

  it("在条目数和字节数达到上限时淘汰最久未使用的记录", async () => {
    const store = createMemoryCache(2_000, 2);
    await store.put(request("a"), payload("a"));
    await store.put(request("b"), payload("b"));
    await store.match(request("a"));
    await store.put(request("c"), payload("c"));
    expect(await store.match(request("b"))).toBeUndefined();
    expect(await store.match(request("a"))).toBeDefined();
    await store.put(request("too-large"), payload("x".repeat(2_000)));
    expect(await store.match(request("too-large"))).toBeUndefined();
    expect(await store.match(request("c"))).toBeDefined();
    await store.put(request("large"), payload("x".repeat(1_000)));
    expect(await store.match(request("a"))).toBeUndefined();
    expect(await store.match(request("c"))).toBeUndefined();
    expect(await store.match(request("large"))).toBeDefined();
  });
});
