import { describe, expect, it } from "vitest";
import { inferShopSystem, normalizeShopSystem } from "../src/collector/shopSystems";

describe("卡网系统类型", () => {
  it.each([
    ["二次元发卡", "acg-faka"], ["lizhi", "acg-faka"], ["acg-faka", "acg-faka"],
    ["独角数卡", "dujiaoka"], ["dujiao", "dujiaoka"], [" 链动小铺 ", "ldxp"],
    ["其它", "other"], ["其他", "other"], ["jsonld", "other"], ["待识别", "unknown"],
    ["manual", undefined], ["push_ingest", undefined], [null, undefined],
  ])("规范化 %s", (value, expected) => {
    expect(normalizeShopSystem(value)).toBe(expected);
  });

  it("只从已确认平台域名识别，不猜测自建站系统", () => {
    expect(inferShopSystem("https://pay.ldxp.cn/shop/abc")).toBe("ldxp");
    expect(inferShopSystem("https://wzyp.cn/shop/abc")).toBe("ldxp");
    expect(inferShopSystem("https://wzyp.cn.evil.example/shop/abc")).toBe("unknown");
    expect(inferShopSystem("https://custom.example/", "invalid")).toBe("unknown");
    expect(inferShopSystem("https://catfk.com/shop/a")).toBe("catfk");
    expect(inferShopSystem("https://www.catfk.com/shop/a")).toBe("catfk");
    expect(inferShopSystem("https://catfk.com.evil.example/shop/a")).toBe("unknown");
    expect(inferShopSystem("https://16688.com.cn/shop/a")).toBe("16688");
    expect(inferShopSystem("https://www.16688.com.cn/shop/a")).toBe("16688");
    expect(inferShopSystem("https://16688.com.cn.evil.example/shop/a")).toBe("unknown");
  });
});
