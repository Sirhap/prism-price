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

it('16688 店铺可以收录，但不会误标记成联动采集器', async () => {
  const res=await submit('https://www.16688.com.cn/shop/S447917');
  expect(res.status).toBe(201);
  const data=await res.json() as {shopId:string};
  expect(await env.DB.prepare('SELECT adapter_type,sync_supported FROM shops WHERE id=?').bind(data.shopId).first()).toMatchObject({adapter_type:'manual',sync_supported:0});
});
