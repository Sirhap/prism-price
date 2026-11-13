/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  NON_DURATION_GROUPS,
  NON_PLAN_GROUPS,
  PRODUCT_DURATION_OPTIONS,
  PRODUCT_PLAN_OPTIONS,
  PRODUCT_PRICE_OPTIONS,
  PRODUCT_SORT_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
} from "../src/routes/search";
import { PRODUCT_GROUPS } from "../src/types";

function extractJsBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(start, `未找到标识 ${marker}`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const end = tail.indexOf(";\n");
  expect(end, `未找到结尾 ; (${marker})`).toBeGreaterThan(0);
  return tail.slice(0, end + 1);
}

describe("前端静态资源与前后端契约对齐验证", () => {
  it("index.html 应提供精简后的排序、店铺在售过滤开关及风险提示弹窗容器", async () => {
    const res = await SELF.fetch("http://localhost/");
    expect(res.status).toBe(200);
    const html = await res.text();

    // 排序选项仅包含 3 个规范选项，且彻底移除旧版 shop-desc
    const sortMatch = html.match(/<select id="sortSelect"[\s\S]*?<\/select>/);
    expect(sortMatch).not.toBeNull();
    const sortOptionValues = [...sortMatch![0].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(sortOptionValues).toEqual([...PRODUCT_SORT_OPTIONS]);
    expect(sortOptionValues).not.toContain("shop-desc");

    // 店铺筛选控件：仅看有在售商品开关、清空筛选按钮与提示栏
    expect(html).toContain('id="shopOnlyInStockInput"');
    expect(html).toContain("仅看有在售商品");
    expect(html).toContain('id="shopResetFiltersBtn"');
    expect(html).toContain('id="filterNoticeBar"');
    expect(html).not.toContain('id="refreshBtn"');
    expect(html).not.toContain("刷新行情");
    expect(html).not.toContain("链动");
    expect(html).toContain("店铺开店入驻");
    expect(html).toContain("免责声明：");
    expect(html).toContain("使用前请自行甄别。");
    expect(html).toContain('id="profileModal"');
    expect(html).toContain('href="https://wzyp.cn/merchant/register?invite_token=sirhao"');
    expect(html).toContain('rel="noopener noreferrer"');
    const registrationLinks = [...html.matchAll(/<a\b[^>]*href="([^"]*\/merchant\/register[^"]*)"[^>]*>/g)].map((match) => match[1]);
    expect(registrationLinks).toHaveLength(3);
    for (const href of registrationLinks) {
      expect(href).toBe("https://wzyp.cn/merchant/register?invite_token=sirhao");
    }
  });

  it("public/app.js 筛选维度、价格、分类禁用矩阵与后端 search.ts 严格一致且无遗留死项", async () => {
    const res = await SELF.fetch("http://localhost/app.js");
    expect(res.status).toBe(200);
    const js = await res.text();

    // 主分类、不可用套餐/时长分组集合对齐
    const brandBlock = extractJsBlock(js, "const BRAND_GROUP_ORDER = [");
    const brands = [...brandBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(brands).toEqual([...PRODUCT_GROUPS]);

    const nonPlanBlock = extractJsBlock(js, "const NON_PLAN_GROUPS = new Set([");
    const nonPlanGroups = [...nonPlanBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(nonPlanGroups)).toEqual(NON_PLAN_GROUPS);

    const nonDurationBlock = extractJsBlock(js, "const NON_DURATION_GROUPS = new Set([");
    const nonDurationGroups = [...nonDurationBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(nonDurationGroups)).toEqual(NON_DURATION_GROUPS);

    // FILTER_DIMENSIONS 仅包含 type / plan / duration，并精确对齐值与文案
    const dimsBlock = extractJsBlock(js, "const FILTER_DIMENSIONS = [");
    const dimKeys = [...dimsBlock.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(dimKeys).toEqual(["type", "plan", "duration"]);

    const typeSection = dimsBlock.slice(dimsBlock.indexOf('key: "type"'), dimsBlock.indexOf('key: "plan"'));
    const planSection = dimsBlock.slice(dimsBlock.indexOf('key: "plan"'), dimsBlock.indexOf('key: "duration"'));
    const durationSection = dimsBlock.slice(dimsBlock.indexOf('key: "duration"'));

    expect([...typeSection.matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1])).toEqual([...PRODUCT_TYPE_OPTIONS]);
    expect([...planSection.matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1])).toEqual([...PRODUCT_PLAN_OPTIONS]);
    expect([...durationSection.matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1])).toEqual([
      ...PRODUCT_DURATION_OPTIONS,
    ]);

    const priceBlock = extractJsBlock(js, "const PRICE_OPTIONS = [");
    expect([...priceBlock.matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1])).toEqual([...PRODUCT_PRICE_OPTIONS]);

    // 确认已删除旧版无意义/失真筛选项及旧版店铺商品清单逻辑
    expect(dimsBlock).not.toContain('"warranty"');
    expect(dimsBlock).not.toContain('"region"');
    expect(dimsBlock).not.toContain('"sms"');
    expect(dimsBlock).not.toContain('"cdk"');
    expect(dimsBlock).not.toContain('"advanced"');
    expect(dimsBlock).not.toContain('"business"');
    expect(js).not.toContain("extractPreviewItems");
    expect(js).not.toContain("全店在售商品清单");
    expect(js).not.toContain("最低价 / 店内中位价");
    expect(js).not.toContain("查看店铺档案与全店商品");
    expect(js).not.toContain("/products`");

    // 确认保留独立卡片徽章展示标签与店铺介绍核心文案
    expect(js).toContain("CARD_BADGE_LABELS");
    expect(js).toContain("已接码");
    expect(js).toContain("未接码");
    expect(js).toContain("查看店铺信息");
    expect(js).toContain("前往店铺");
    expect(js).toContain(
      "本站仅做公开店铺信息收录，不参与交易，也不对店铺商品、售后和风险负责。使用前请自行甄别。",
    );
    expect(js).not.toContain("源站未提供简介");
    expect(js).not.toContain('aria-label="店铺简介"');
    expect(js).toContain("进入店铺 ↗");
    expect(js).toContain("库存以店铺为准");
    expect(js).not.toContain("formatShortTime");
    expect(js).not.toContain("最近同步时间");
    expect(js).not.toContain("同步：");
    expect(js).toContain("暂无在售商品，暂无法统计主营类别");
    expect(js).toContain("暂无主营类别统计");
    expect(js).toContain("未记录（早期收录）");
    expect(js).toContain("OFFICIAL_REFERENCE_PRICES");
    expect(js).toContain("renderOfficialPriceAnchor");
    expect(js).not.toContain("区间未同步");
    expect(js).toContain("GROUP_ICONS");
    expect(js).toContain("GROUP_VISUAL_META");
  });

  it("public/styles.css 应正确分发并包含新版店铺介绍与风险提示样式", async () => {
    const res = await SELF.fetch("http://localhost/styles.css");
    expect(res.status).toBe(200);
    const css = await res.text();

    expect(css).toContain(".profile-action-box");
    expect(css).toContain(".profile-risk-notice");
    expect(css).toContain(".profile-visit-btn");
    expect(css).toContain(".shop-stock-filter");
    expect(css).toContain(".filter-notice-bar");
    expect(css).toContain(".chip.is-filtered-zero");
    expect(css).toContain(".ref-price-banner");
    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain(".compare-dock");
    expect(css).toContain(".shop-avatar");
    expect(css).toContain(".brand-rail");
    expect(css).toContain(".price-ticket");
    expect(css).toContain(".spotlight-hero");
  });

  it("public/index.html 与静态图标清单应包含棱镜品牌视觉、双栏导航、视图切换及新筛选控件", async () => {
    const res = await SELF.fetch("http://localhost/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="officialPriceAnchor"');
    expect(html).toContain('id="themeToggleBtn"');
    expect(html).toContain('id="workbenchBtn"');
    expect(html).toContain('id="workbenchModal"');
    expect(html).toContain('id="compareBar"');
    expect(html).toContain('id="customMinPrice"');
    expect(html).toContain('id="customMaxPrice"');
    expect(html).toContain('id="shopSortSelect"');
    expect(html).toContain('id="shopHasIntegrationCodeInput"');
    expect(html).toContain('id="shopOpenStoreLink"');
    expect(html).toContain("我想开店");
    expect(html).not.toContain('id="shopHasDescriptionInput"');
    expect(html).toContain('id="backToTopBtn"');
    expect(html).toContain('id="brandRail"');
    expect(html).toContain('id="viewLayoutSwitch"');
    expect(html).toContain('id="viewListBtn"');
    expect(html).toContain('id="viewGridBtn"');

    const favRes = await SELF.fetch("http://localhost/favicon.svg");
    expect(favRes.status).toBe(200);
    const favSvg = await favRes.text();
    expect(favSvg).toContain("prismBg");

    const manifestRes = await SELF.fetch("http://localhost/site.webmanifest");
    expect(manifestRes.status).toBe(200);
    const manifestText = await manifestRes.text();
    expect(manifestText).toContain("棱镜比价");
  });
});
