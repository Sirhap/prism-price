/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, expect, it, vi } from "vitest";
import { handleApiRequest } from "../src/routes/api";
import references from "./fixtures/read-budget-reference.json";
import { observeD1 } from "../src/observability/d1Metrics";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000)
    INSERT INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,system_type,next_sync_at,updated_at,product_count)
    SELECT 's-'||x, '基准店铺 '||x, 'https://bench.example/shop/'||x, 'https://bench.example/shop/'||x,
      'manual','other','2026-11-12','2026-11-12',20 FROM n`).run();
  await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<6000)
    INSERT INTO product_groups (group_key,display_name,brand_group,shop_category,attr_type,attr_plan,attr_duration,attr_sms,
      min_price,median_price,max_price,shop_count,offer_count,lead_shop_id,lead_shop_name,lead_shop_url,lead_item_url,stock_status,offers_preview_json,updated_at)
    SELECT 'g-'||x,
      (CASE x%3 WHEN 0 THEN 'Codex' WHEN 1 THEN 'Claude' ELSE 'Gemini' END)||' 基准规格 '||x,
      CASE x%3 WHEN 0 THEN 'Codex' WHEN 1 THEN 'Claude' ELSE 'Gemini' END, 'AI',
      CASE x%4 WHEN 0 THEN 'ready' WHEN 1 THEN 'recharge' WHEN 2 THEN 'api' ELSE 'cdk' END,
      CASE x%5 WHEN 0 THEN 'plus' WHEN 1 THEN 'pro' WHEN 2 THEN 'business' WHEN 3 THEN 'free' ELSE 'advanced' END,
      CASE x%4 WHEN 0 THEN 'month' WHEN 1 THEN 'quarter' WHEN 2 THEN 'year' ELSE '' END,
      CASE WHEN x%11=0 THEN 'service' ELSE '' END,
      1+x%500,6+x%500,11+x%500,1+x%10,1+x%10,'s-'||(1+x%1000),'基准店铺 '||(1+x%1000),
      'https://bench.example/shop/'||(1+x%1000),'https://bench.example/item/'||x,'normal','[]','2026-11-12' FROM n`).run();
  await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<18000)
    INSERT INTO offers (id,shop_id,group_key,raw_name,clean_name,brand_group,price,item_url,updated_at)
    SELECT 'o-'||x,'s-'||(1+x%1000),'g-'||(1+x%6000),'基准商品','基准商品','Codex',10,'https://bench.example/item/'||x,'2026-11-12' FROM n`).run();
});

it("6000商品组冷查询扫描预算与原实现对照", async () => {
  const reports: Array<{ query: string; before: number; after: number; ratio: number }> = [];
  for (const reference of references) {
    const query = reference.query;
    const request = new Request(`http://localhost/api/products?${query}`);
    const actual = observeD1(env.DB, true);
    const response = await handleApiRequest(request, { ...env, DB: actual.db });
    expect(response.status).toBe(200);
    const oldBody: Record<string, unknown> = structuredClone(reference.body);
    // 旧基准没有新增分类；该固定数据集不包含这些分类，计数应为 0。
    const oldFacets = oldBody.facets as { groups: Record<string, number> };
    for (const group of ["Muse", "智谱", "Augment", "Perplexity", "千问", "AI视频", "AI绘图", "AI音乐", "手机卡", "游戏商品", "影音会员", "网盘服务", "生活优惠"]) oldFacets.groups[group] = 0;
    const newBody = await response.json() as Record<string, unknown>;
    for (const key of ["items","total","offerTotal","shopCount","page","pageSize","totalPages","appliedFilters","appliedPriceRange","facets"]) {
      expect(newBody[key], key).toEqual(oldBody[key]);
    }
    reports.push({ query, before:reference.beforeRows, after:actual.cost.rowsRead, ratio:actual.cost.rowsRead/reference.beforeRows });
    console.log(JSON.stringify({kind:"read-budget",query,beforeRows:reference.beforeRows,after:actual.cost}));
  }
  console.log(JSON.stringify({kind:"read-budget-summary",reports}));
  expect(reports[0].after).toBeLessThan(9000);
  expect(reports.every((report) => report.after < report.before * 0.4)).toBe(true);
});

it("缓存命中零读取，商品与店铺翻页只取当前页，Cookie和随机参数不能绕缓存", async () => {
  const { default: worker } = await import('../src/index');
  const { createExecutionContext, waitOnExecutionContext } = await import('cloudflare:test');
  const measurements: Array<{ name:string; rows:number; queries:number }> = [];
  const load = async (name: string, path: string, cookie = false) => {
    const observed = observeD1(env.DB);
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(`https://budget-warm.example${path}`, { headers: cookie ? { Cookie:'theme=dark' } : {} }), {...env,DB:observed.db}, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status,name).toBe(200);
    measurements.push({name,rows:observed.cost.rowsRead,queries:observed.cost.queries});
    expect(observed.cost.rowsWritten,name).toBe(0);
    return {response,cost:observed.cost};
  };
  await load('cold-default','/api/products?page=1&pageSize=12');
  const hit = await load('public-hit-cookie','/api/products?pageSize=12&page=1&random=abc',true);
  expect(hit.cost.rowsRead).toBe(0);
  expect(hit.response.headers.get('X-D1-Rows-Read')).toBe('0');
  const next = await load('page-two','/api/products?page=2&pageSize=12&facets=0');
  expect(next.cost.rowsRead).toBeLessThan(200);
  const narrow = await load('narrow-filter','/api/products?page=1&pageSize=12&group=Codex&type=ready&plan=plus');
  expect(narrow.cost.rowsRead).toBeLessThan(500);
  await load('cold-search','/api/products?page=1&pageSize=12&q=规格%205');
  const searchNext = await load('search-page-two','/api/products?page=2&pageSize=12&q=规格%205&facets=0');
  expect(searchNext.cost.rowsRead).toBeLessThan(200);
  await load('cold-shops','/api/shops?page=1&pageSize=12');
  const shopsNext = await load('shops-page-two','/api/shops?page=2&pageSize=12');
  expect(shopsNext.cost.rowsRead).toBeLessThan(200);
  const empty = await load('out-of-range','/api/products?page=1000000&pageSize=12');
  expect(empty.cost.rowsRead).toBeLessThan(20);
  console.log(JSON.stringify({kind:'warm-read-budget',measurements}));
});

it("数据版本改变后统计重新加载，不继续复用旧计数", async () => {
  const { default: worker } = await import('../src/index');
  const { createExecutionContext, waitOnExecutionContext } = await import('cloudflare:test');
  const load = async (size: number) => {
    const ctx=createExecutionContext();
    const response=await worker.fetch(new Request(`https://budget-version.example/api/products?page=1&pageSize=${size}&price=under-10`),env,ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    return response.json() as Promise<{total:number;items:Array<{minPrice:number}>}>;
  };
  const before=await load(12);
  await env.DB.prepare("UPDATE product_groups SET min_price=9999, updated_at='2099-01-01' WHERE group_key='g-500'").run();
  const after=await load(13); // 新分页键不复用10分钟完整响应，验证统计版本探测。
  expect(after.total).toBe(before.total-1);
  expect(after.items.every(item=>item.minPrice<10)).toBe(true);
});

it("缺少排序及时间索引的服务器快照仍能低读取翻页", async () => {
  for (const name of ["idx_pg_updated","idx_pg_shop_count","idx_pg_price","idx_pg_brand_price","idx_shops_updated","idx_shops_next_sync"]) {
    await env.DB.prepare(`DROP INDEX IF EXISTS ${name}`).run();
  }
  const clock=vi.spyOn(Date,"now").mockReturnValue(Date.parse("2026-11-13T00:21:00Z"));
  try {
    const { default: worker }=await import("../src/index");
    const { createExecutionContext,waitOnExecutionContext }=await import("cloudflare:test");
    const measurements=[];
    for (const page of [1,2]) {
      const observed=observeD1(env.DB,true);const ctx=createExecutionContext();
      const response=await worker.fetch(new Request(`https://budget-no-index.example/api/products?page=${page}&pageSize=6&facets=0`),{...env,DB:observed.db},ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(200);
      const data=await response.json() as {items:unknown[]};expect(data.items).toHaveLength(6);
      measurements.push({page,rows:observed.cost.rowsRead,queries:observed.cost.queries});
      if(page===2)expect(observed.cost.rowsRead).toBeLessThan(100);
      expect(observed.cost.statements.every(row=>!row.sql.includes("MAX("))).toBe(true);
    }
    console.log(JSON.stringify({kind:"no-index-budget",measurements}));
  } finally { clock.mockRestore(); }
});
