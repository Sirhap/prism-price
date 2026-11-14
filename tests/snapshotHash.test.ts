import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_NORMALIZATION_VERSION as WORKER_VERSION,
  computeSnapshotHash as workerHash,
} from "../src/collector/etl/hashAndDiff";
import {
  SNAPSHOT_NORMALIZATION_VERSION as LOCAL_VERSION,
  computeSnapshotHash as localHash,
} from "../scripts/lib/snapshotHash.mjs";
import brandRules from "../src/config/brand-rules.json";
import type { RawShopSnapshot } from "../src/types";

const snapshot: RawShopSnapshot = {
  shopName: "跨端摘要测试", canonicalUrl: "https://example.com/", telegram: "@test_hash",
  shopSellCount: 42, salesVisible: true, depositVisible: false, depositMoney: null,
  items: [
    { itemKey: "b", rawName: "Codex 成品号", shopCategory: "AI", price: 10.5, stockCount: null, stockStatus: "normal", itemUrl: "https://example.com/b" },
    { itemKey: "a", rawName: "AI创作 即梦 10亿token 成品号", shopCategory: "AI", price: 5, stockCount: 3, stockStatus: "low", itemUrl: "https://example.com/a" },
  ],
};

describe("Worker 与本地推送摘要一致性", () => {
  it("两个运行环境均同步使用 normalizationVersion: 11，且对同一快照、排序变化及空店计算相同摘要", async () => {
    expect(WORKER_VERSION).toBe(11);
    expect(LOCAL_VERSION).toBe(11);

    expect(await workerHash(snapshot)).toBe(localHash(snapshot));
    expect(await workerHash({ ...snapshot, items: [...snapshot.items].reverse() })).toBe(localHash(snapshot));
    const empty = { ...snapshot, items: [] };
    expect(await workerHash(empty)).toBe(localHash(empty));
  });

  it("源商品不变时，分类配置改变也应使旧摘要失效", async () => {
    const previous = await workerHash(snapshot);
    const original = brandRules[0].priority;
    try {
      brandRules[0].priority = original + 1;
      expect(await workerHash(snapshot)).not.toBe(previous);
      expect(await workerHash(snapshot)).toBe(localHash(snapshot));
    } finally {
      brandRules[0].priority = original;
    }
  });
  it("只修改规则维护说明时，不应触发整店重写", async () => {
    const previous = await workerHash(snapshot);
    const original = brandRules[0].description;
    try {
      brandRules[0].description = "仅更新维护说明";
      expect(await workerHash(snapshot)).toBe(previous);
      expect(localHash(snapshot)).toBe(previous);
    } finally {
      brandRules[0].description = original;
    }
  });

  it("修改或清空店铺简介 description 时，不应影响商品快照哈希", async () => {
    const baseHash = await workerHash(snapshot);
    expect(localHash(snapshot)).toBe(baseHash);

    for (const description of ["", "新店简介\r\n支持自助售后", "另一段完全不同的长简介\n客服 24 小时在线"]) {
      const modified: RawShopSnapshot = { ...snapshot, description };
      expect(await workerHash(modified)).toBe(baseHash);
      expect(localHash(modified)).toBe(baseHash);
    }
  });
});

it("商品链接及展示开关变化应使摘要失效，跨端保持一致", async () => {
  const previous = await workerHash(snapshot);
  const changes = [
    { ...snapshot, canonicalUrl: "https://new.example/" },
    { ...snapshot, salesVisible: false },
    { ...snapshot, depositVisible: true },
    { ...snapshot, items: snapshot.items.map((item, index) => index === 0 ? { ...item, itemUrl: "https://new.example/item" } : item) },
  ];
  for (const changed of changes) {
    expect(await workerHash(changed)).not.toBe(previous);
    expect(await workerHash(changed)).toBe(localHash(changed));
  }
});
