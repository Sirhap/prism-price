/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
const submit = (shopUrl: string) => SELF.fetch('http://localhost/api/shops/submit', { method:'POST', headers:{'Content-Type':'application/json',Origin:'http://localhost'}, body:JSON.stringify({shopUrl}) });
it('公开提交店铺、规范化去重并禁止跨站和内网', async () => {
  const first=await submit('https://pay.ldxp.cn/shop/SubmitTest?x=1');
  expect(first.status).toBe(201);
  const data=await first.json() as {shopId:string};
  const row=await env.DB.prepare('SELECT * FROM shops WHERE id=?').bind(data.shopId).first<{canonical_url:string; sync_state:string; adapter_type:string}>();
  expect(row).toMatchObject({canonical_url:'https://wzyp.cn/shop/SubmitTest',sync_state:'pending',adapter_type:'push_ingest'});
  const duplicate=await submit('https://wzyp.cn/shop/SUBMITTEST');
  expect(duplicate.status).toBe(200);
  expect(await duplicate.json()).toMatchObject({existing:true});
  expect((await submit('http://127.0.0.1/shop/a')).status).toBe(400);
  const cross=await SELF.fetch('http://localhost/api/shops/submit',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({shopUrl:'https://example.com'})});
  expect(cross.status).toBe(403);
});
it('独立公网店铺可收录为待适配，不自动采集', async () => {
  const res=await submit('https://independent-shop.example/shop');
  expect(res.status).toBe(201);
  const data=await res.json() as {shopId:string};
  expect(await env.DB.prepare('SELECT adapter_type,sync_supported FROM shops WHERE id=?').bind(data.shopId).first()).toMatchObject({adapter_type:'manual',sync_supported:0});
});

it('历史联动域名地址与当前规范地址属于同一店铺', async () => {
  await env.DB.prepare("INSERT INTO shops(id,shop_name,shop_url,canonical_url,next_sync_at,updated_at) VALUES(?,?,?,?,?,?)")
    .bind('legacy-alias-shop','历史店铺','https://pay.ldxp.cn/shop/LegacyAlias','https://pay.ldxp.cn/shop/LegacyAlias','2026-01-01','2026-01-01').run();
  const res=await submit('https://wzyp.cn/shop/legacyalias');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({existing:true,shopId:'legacy-alias-shop'});
});

it('可选对接码保留大小写和空格，显示及筛选均可使用，公开码优先', async () => {
  const response=await SELF.fetch('http://localhost/api/shops/submit',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({shopUrl:'https://example-test-shop.example/shop',integrationCode:'Lucky plus'})});
  expect(response.status).toBe(201);
  const {shopId}=await response.json() as {shopId:string};
  const detail=await (await SELF.fetch(`http://localhost/api/shops/${shopId}`)).json() as {shop:{integrationCodes:string[]}};
  expect(detail.shop.integrationCodes).toEqual(['Lucky plus']);
  const filtered=await (await SELF.fetch('http://localhost/api/shops?q=example-test-shop&hasIntegrationCode=1&page=1')).json() as {shops:Array<{id:string}>};
  expect(filtered.shops.some(s=>s.id===shopId)).toBe(true);
  await env.DB.prepare('UPDATE shops SET shop_name=? WHERE id=?').bind('公开分销码：000001',shopId).run();
  const updated=await (await SELF.fetch(`http://localhost/api/shops/${shopId}`)).json() as {shop:{integrationCodes:string[]}};
  expect(updated.shop.integrationCodes).toEqual(['000001']);
});

it('16688 店铺可以收录，但不会误标记成联动采集器', async () => {
  const res=await submit('https://www.16688.com.cn/shop/S447917');
  expect(res.status).toBe(201);
  const data=await res.json() as {shopId:string};
  expect(await env.DB.prepare('SELECT adapter_type,sync_supported FROM shops WHERE id=?').bind(data.shopId).first()).toMatchObject({adapter_type:'manual',sync_supported:0});
});
