import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetch16688Snapshot } from '../scripts/push-sync.mjs';
test('16688 采集使用店铺编号，保留缺货且不将空结果当成删除', async () => {
 const old=globalThis.fetch, oldTimeout=AbortSignal.timeout, calls=[], timeouts=[];
 AbortSignal.timeout=(ms)=>{timeouts.push(ms); return oldTimeout(ms);};
 globalThis.fetch=async (url,opts)=>{ calls.push([url,JSON.parse(opts.body)]); return Response.json(url.endsWith('/detail') ? {code:1,data:{shop_no:'S447917',name:'测试'}} : url.includes('goodsCategory/list') ? {code:1,data:[{goods_category_no:'cat1',name:'Muse AI'}]} : {code:1,data:{list:[{goods_no:'a',name:'商品',price:3,goods_category_no:'cat1',stock_available_status:'out'}]}}); };
 try { const snapshot=await fetch16688Snapshot({shopUrl:'https://www.16688.com.cn/shop/S447917',shopName:'测试'},{});assert.equal(snapshot.items[0].stockCount,0);assert.equal(snapshot.items[0].shopCategory,'Muse AI');assert.equal(calls.length,3);assert.deepEqual(calls[2][1],{shop_no:'S447917',goods_category_no:'',keywords:'',sort:'default'});assert.deepEqual(timeouts,[30000,30000,30000]);
 globalThis.fetch=async url=>Response.json(url.endsWith('/detail')?{code:1,data:{shop_no:'S447917'}}:url.includes('goodsCategory/list')?{code:1,data:[]}:{code:1,data:{list:[]}});
 await assert.rejects(fetch16688Snapshot({shopUrl:'https://www.16688.com.cn/shop/S447917'},{}),/保留原数据/);
 } finally {globalThis.fetch=old;AbortSignal.timeout=oldTimeout;}
});

test('KA123 目录映射汇率、类别及缺货，空目录不认为可删除', async () => {
 const {fetchKa123Snapshot}=await import('../scripts/push-sync.mjs'); const old=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({ok:true,data:{exchange_rate:{rate:7},sections:[{id:'s',title:'类别'}],products:[{id:'x',name:'商品',section_id:'s',price_micro:2000000,stock_available:0}]}});
 try {const s=await fetchKa123Snapshot({shopUrl:'https://example.test',shopName:'测试'});assert.equal(s.items[0].price,14);assert.equal(s.items[0].stockCount,0);assert.equal(s.items[0].shopCategory,'类别');globalThis.fetch=async()=>Response.json({ok:true,data:{products:[]}});await assert.rejects(fetchKa123Snapshot({shopUrl:'https://example.test'}),/保留原数据/);} finally {globalThis.fetch=old;}
});
