/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import { catalogVersion } from '../src/cache/queryCache';
import { observeD1 } from '../src/observability/d1Metrics';
afterEach(()=>vi.restoreAllMocks());
it('导入库缺少更新时间索引时，不为探测版本扫描商品和店铺',async()=>{
  await env.DB.exec('CREATE TABLE shops (updated_at TEXT); CREATE TABLE product_groups (updated_at TEXT);');
  await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<6000) INSERT INTO product_groups SELECT '2026-11-12' FROM n`).run();
  const now=Date.parse('2026-11-13T00:01:00Z');
  vi.spyOn(Date,'now').mockReturnValue(now);
  const observed=observeD1(env.DB,true);
  const version=await catalogVersion(observed.db,new URL('http://localhost/api/products'));
  expect(version).toBe(`window:${Math.floor(now/300000)}`);
  expect(observed.cost.rowsRead).toBeLessThan(100);
  expect(observed.cost.statements.every(row=>!row.sql.includes('MAX('))).toBe(true);
});
