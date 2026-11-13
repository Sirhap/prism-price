/// <reference types="@cloudflare/vitest-pool-workers/types" />
import {applyD1Migrations, env, SELF} from 'cloudflare:test';
import {beforeAll, expect, it} from 'vitest';
beforeAll(async()=>{await applyD1Migrations(env.DB,env.TEST_MIGRATIONS);});
it('部分同步更新所传商品但保留缺席商品；完整同步仍可删除',async()=>{
 const shop={shopId:'partial-demo',shopUrl:'https://wzyp.cn/shop/partial-demo'};
 const item=(key:string,price:number)=>({itemKey:key,rawName:`ChatGPT ${key}`,shopCategory:'',price,stockCount:1,stockStatus:'low',itemUrl:`https://wzyp.cn/item/${key}`});
 const send=(items:unknown[],partial=false)=>SELF.fetch('http://localhost/api/ingest',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test-ingest-secret'},body:JSON.stringify({shops:[{...shop,partial,snapshot:{shopName:'partial',canonicalUrl:shop.shopUrl,items}}]})});
 expect((await send([item('a',10),item('b',20)])).status).toBe(200);
 expect((await send([item('a',15)],true)).status).toBe(200);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM offers WHERE shop_id=?').bind(shop.shopId).first('n')).toBe(2);
 expect(await env.DB.prepare('SELECT price FROM offers WHERE id=?').bind('partial-demo:a').first('price')).toBe(15);
 expect((await send([item('a',15)])).status).toBe(200);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM offers WHERE shop_id=?').bind(shop.shopId).first('n')).toBe(1);
 const sync=await(await SELF.fetch('http://localhost/api/shops?fields=sync')).json() as {partialSnapshotSupport:boolean};expect(sync.partialSnapshotSupport).toBe(true);
});
