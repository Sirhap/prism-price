/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, expect, it, vi } from "vitest";
import { ingestPushedSnapshots } from "../src/collector/scheduler";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

const details = "本商品提供中转站余额。一张兑换码可调用所有模型。";
const detailResponse = (description: string) => Response.json({ code: 1, data: { description } });

function pushedOffer(shopId: string, host: string, items: Array<[key: string, title: string]>) {
  const shopUrl = `https://${host}/shop/${shopId}`;
  const path = host === "www.16688.com.cn" ? "goods" : "item";
  return {
    shopId,
    shopUrl,
    snapshot: {
      shopName: shopId, canonicalUrl: shopUrl, telegram: "", shopSellCount: null,
      salesVisible: false, depositVisible: false, depositMoney: null,
      items: items.map(([itemKey, rawName]) => ({
        itemKey, rawName, shopCategory: "其它", price: 10, stockCount: 2,
        stockStatus: "low" as const, itemUrl: `https://${host}/${path}/${itemKey}`,
      })),
    },
  };
}

async function labels(shopId: string) {
  const { results } = await env.DB.prepare(
    "SELECT raw_name, brand_group FROM offers WHERE shop_id = ? ORDER BY id",
  ).bind(shopId).all();
  return results.map(row => [row.raw_name, row.brand_group]);
}

it("按店限量补查，未变快照继续排查未核对的商品，成功后复用分类", async () => {
  const entry = pushedOffer("detail-budget", "pay.ldxp.cn", [
    ["a", "12刀"], ["b", "优惠月卡"], ["c", "独享"], ["d", "Claude Pro 月卡"],
    ["e", "Grok / Cursor 三合一订阅"], ["f", "苹果美区礼品卡"],
  ]);
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => detailResponse(details));
  try {
    const first = await ingestPushedSnapshots(env, [entry]);
    expect(first.updatedCount).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith("https://wzyp.cn/shopApi/Shop/goodsInfo",
      expect.objectContaining({ method: "POST", body: '{"goods_key":"a"}', redirect: "error" }));
    expect(await labels(entry.shopId)).toEqual([
      ["12刀", "中转"], ["优惠月卡", "中转"], ["独享", "其它"], ["Claude Pro 月卡", "Claude"],
      ["Grok / Cursor 三合一订阅", "其它"], ["苹果美区礼品卡", "其它"],
    ]);
    const second = await ingestPushedSnapshots(env, [entry]);
    expect(second.updatedCount).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await labels(entry.shopId))[2]).toEqual(["独享", "中转"]);
    expect((await ingestPushedSnapshots(env, [entry])).skippedUnchanged).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const cached = await env.DB.prepare("SELECT classification FROM offer_classification_details WHERE offer_id = ?")
      .bind(entry.shopId + ":a").first<string>("classification");
    expect(cached).toContain('"brandGroup":"中转"');
    expect(cached).not.toContain(details);
  } finally {
    fetcher.mockRestore();
  }
});

it("16688 部分快照只补查本次出现的商品，详情限流时保留历史分类", async () => {
  const entry = pushedOffer("detail-market", "www.16688.com.cn", [["a", "12刀"], ["b", "22刀"]]);
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => detailResponse(details));
  try {
    await ingestPushedSnapshots(env, [entry]);
    expect(fetcher).toHaveBeenCalledWith("https://www.16688.store/shopApi/goods/detail",
      expect.objectContaining({ body: '{"goods_no":"a"}' }));
    await env.DB.prepare("UPDATE offer_classification_details SET checked_at='2020-01-01' WHERE offer_id IN (?, ?)")
      .bind(entry.shopId + ":a", entry.shopId + ":b").run();
    fetcher.mockReset().mockResolvedValue(new Response(null, { status: 429 }));
    await ingestPushedSnapshots(env, [{ ...entry, partial: true, snapshot: {
      ...entry.snapshot, items: [{ ...entry.snapshot.items[1], stockCount: 0 }],
    } }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: '{"goods_no":"b"}' }));
    expect(await labels(entry.shopId)).toEqual([["12刀", "中转"], ["22刀", "中转"]]);
    expect(await env.DB.prepare("SELECT stock_count FROM offers WHERE id = ?")
      .bind(entry.shopId + ":b").first("stock_count")).toBe(0);
  } finally {
    fetcher.mockRestore();
  }
});

it("CatFK 单件详情超出大小限制时继续处理其他报价，报价删除时清理缓存", async () => {
  const entry = pushedOffer("detail-catfk", "catfk.com", [["a", "12刀"], ["b", "22刀"]]);
  const fetcher = vi.spyOn(globalThis, "fetch")
    .mockImplementationOnce(async () => detailResponse("a".repeat(70_000)))
    .mockImplementationOnce(async () => detailResponse(details));
  try {
    await ingestPushedSnapshots(env, [entry]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith("https://catfk.com/shopApi/Shop/goodsInfo",
      expect.objectContaining({ body: '{"goods_key":"b"}' }));
    expect(await labels(entry.shopId)).toEqual([["12刀", "其它"], ["22刀", "中转"]]);
    await ingestPushedSnapshots(env, [{ ...entry, snapshot: { ...entry.snapshot, items: [] } }]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM offer_classification_details WHERE offer_id IN (?, ?)")
      .bind(entry.shopId + ":a", entry.shopId + ":b").first("count")).toBe(0);
  } finally {
    fetcher.mockRestore();
  }
});
