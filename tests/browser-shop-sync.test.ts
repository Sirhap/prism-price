/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
const send = (shopId:string, items:unknown[], origin='http://localhost') => SELF.fetch('http://localhost/api/shops/browser-sync',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({shopId,items})});
const item = {itemKey:'new',rawName:'ChatGPT Plus 月卡',shopCategory:'',price:12,stockCount:0,itemUrl:'https://wzyp.cn/item/new'};
it('浏览器回传能更新报价，保留本次未返回的旧报价，并限制频率', async () => {
  const now='2026-01-01';
  await env.DB.prepare('INSERT INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,next_sync_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind('browser1','测试店','https://wzyp.cn/shop/browser1','https://wzyp.cn/shop/browser1','push_ingest',now,now).run();
  const initial=await SELF.fetch('http://localhost/api/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-ingest-secret'},body:JSON.stringify({shops:[{shopId:'browser1',shopUrl:'https://wzyp.cn/shop/browser1',snapshot:{shopName:'测试店',canonicalUrl:'https://wzyp.cn/shop/browser1',items:[{...item,itemKey:'old',itemUrl:'https://wzyp.cn/item/old'}]}}]})});
  expect(initial.status).toBe(200);
  await env.DB.prepare("UPDATE shops SET last_synced_at='2026-01-01' WHERE id='browser1'").run();
  const res=await send('browser1',[item]);expect(res.status).toBe(200);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM offers WHERE shop_id='browser1'").first('n')).toBe(2);
  expect(await env.DB.prepare("SELECT stock_count FROM offers WHERE id='browser1:new'").first('stock_count')).toBe(0);
  expect((await send('browser1',[item])).status).toBe(429);
});
it('拒绝跨站、空快照、外部商品链接和不支持的店铺', async () => {
  expect((await send('browser1',[item],'https://evil.example')).status).toBe(403);
  expect((await send('browser1',[])).status).toBe(400);
  await env.DB.prepare("UPDATE shops SET last_synced_at='2026-01-01' WHERE id='browser1'").run();
  expect((await send('browser1',[{...item,itemUrl:'https://evil.example/item/a'}])).status).toBe(400);
  await env.DB.prepare("INSERT INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,next_sync_at,updated_at) VALUES ('browser2','测试','https://example.test/shop/x','https://example.test/shop/x','manual','2026','2026')").run();
  expect((await send('browser2',[item])).status).toBe(400);
});
