import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewShopFromBrowser } from '../public/browser-shop-preview.mjs';

test('浏览器读取联动的完整分页并保留缺货商品', async () => {
  const calls=[]; const fetcher=async (url,opts)=>{calls.push({url,opts});const data=JSON.parse(opts.body);if(url.endsWith('/info'))return Response.json({code:1,data:{nickname:'Test',goods_count:2}});return Response.json({code:1,data:{total:2,list:[{goods_key:`key${data.current}`,extend:{stock_count:0}}]}});};
  const result=await previewShopFromBrowser('https://pay.ldxp.cn/shop/AbC',{fetcher,wait:async()=>{}});
  assert.equal(result.count,2);assert.equal(calls.length,3);assert.equal(calls[0].opts.credentials,'omit');assert.equal(JSON.parse(calls[2].opts.body).current,2);
});
test('16688 不支持浏览器直读时不发请求，分页重复拒绝伪完整结果', async () => {
  let calls=0;const fetcher=async(url)=>{calls++;return Response.json(url.endsWith('/info')?{code:1,data:{goods_count:2}}:{code:1,data:{total:2,list:[{goods_key:'same'}]}});};
  await assert.rejects(previewShopFromBrowser('https://www.16688.com.cn/shop/S447917',{fetcher,wait:async()=>{}}),/暂不支持/);assert.equal(calls,0);
  await assert.rejects(previewShopFromBrowser('https://catfk.com/shop/x',{fetcher,wait:async()=>{}}),/分页不完整/);
});

test('回传格式保留缺货，不携带源站联系方式', async () => {
  const {buildBrowserShopPayload}=await import('../public/browser-shop-preview.mjs');
  const output=buildBrowserShopPayload('shop1',{items:[{goods_key:'a',name:'item',price:8,link:'https://wzyp.cn/item/a',extend:{stock_count:0},telegram:'hidden'}]});
  assert.equal(output.items[0].stockCount,0); assert.equal(output.items[0].stockStatus,'low');
  assert.equal(JSON.stringify(output).includes('telegram'),false);
  assert.throws(()=>buildBrowserShopPayload('a',{items:Array(2001).fill({})}),/上限/);
});

test('用户网络采集后向本站写入，不携带管理密钥', async () => {
  const {syncShopFromBrowser}=await import('../public/browser-shop-preview.mjs');let sent;
  const fetcher=async url=>Response.json(url.endsWith('/info')?{code:1,data:{nickname:'测试店',goods_count:1}}:{code:1,data:{total:1,list:[{goods_key:'one',name:'商品',price:9,link:'/item/one'}]}});
  const send=async(url,opts)=>{sent={url,headers:opts.headers,body:JSON.parse(opts.body)};return Response.json({ok:true,itemCount:1});};
  const {result}=await syncShopFromBrowser('s1','https://wzyp.cn/shop/a',{fetcher,send,wait:async()=>{}});
  assert.equal(result.itemCount,1);assert.equal(sent.url,'/api/shops/browser-sync');assert.equal(sent.body.shopName,'测试店');assert.equal(sent.body.items[0].itemUrl,'https://wzyp.cn/item/one');assert.equal(sent.headers.Authorization,undefined);
});
