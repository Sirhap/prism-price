/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, expect, it, vi } from 'vitest';
import { market16688Adapter } from '../src/collector/adapters/market16688Adapter';
import type { ShopRecord } from '../src/types';

beforeAll(async()=>{await applyD1Migrations(env.DB,env.TEST_MIGRATIONS);});
it('识别 16688 详情和商品，保留缺货并拒绝空数据',async()=>{
 const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{
  const u=String(input); if(u.endsWith('/shop/detail'))return Response.json({code:1,data:{shop_no:'S447917',name:'测试店'}});
  return Response.json({code:1,data:{list:[{goods_no:'G001',name:'商品一',price:12,stock_available_quantity:0,stock_available_status:'out'}]}});
 });
 try {
  const shop={shop_url:'https://www.16688.com.cn/shop/S447917',canonical_url:'https://www.16688.com.cn/shop/S447917',shop_name:'测试',telegram:'',shop_sell_count:null} as ShopRecord;
  const snapshot=await market16688Adapter.fetchSnapshot(shop,env);expect(snapshot.items).toHaveLength(1);expect(snapshot.items[0]).toMatchObject({itemKey:'G001',stockCount:0,itemUrl:'https://www.16688.com.cn/goods/G001'});
  fetchMock.mockImplementation(async input=>String(input).endsWith('/shop/detail')?Response.json({code:1,data:{shop_no:'S447917'}}):Response.json({code:1,data:{list:[]}}));
  await expect(market16688Adapter.fetchSnapshot(shop,env)).rejects.toThrow('未覆盖');
 } finally {fetchMock.mockRestore();}
});
it('指定店铺采集以部分快照合并，不删除源站未返回的旧商品',async()=>{
 const id='market-16688-test',url='https://www.16688.com.cn/shop/S447917';
 await env.DB.prepare('INSERT INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,sync_supported,next_sync_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,'测试',url,url,'manual',0,'2026','2026').run();
 const auth={'Content-Type':'application/json',Authorization:'Bearer test-ingest-secret'};
 const old={itemKey:'old',rawName:'ChatGPT Plus old',shopCategory:'',price:10,stockCount:1,stockStatus:'low',itemUrl:'https://www.16688.com.cn/goods/old'};
 expect((await SELF.fetch('http://localhost/api/ingest',{method:'POST',headers:auth,body:JSON.stringify({shops:[{shopId:id,shopUrl:url,snapshot:{shopName:'测试',canonicalUrl:url,items:[old]}}]})})).status).toBe(200);
 const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>String(input).endsWith('/shop/detail')?Response.json({code:1,data:{shop_no:'S447917',name:'测试'}}):Response.json({code:1,data:{list:[{goods_no:'new',name:'ChatGPT Plus new',price:11,stock_available_quantity:0}]}}));
 try { const res=await SELF.fetch('http://localhost/api/sync',{method:'POST',headers:auth,body:JSON.stringify({shopId:id})});const data=await res.json() as {failedCount:number};expect(data.failedCount).toBe(0);expect(await env.DB.prepare('SELECT count(*) AS n FROM offers WHERE shop_id=?').bind(id).first('n')).toBe(2); } finally {spy.mockRestore();}
});
