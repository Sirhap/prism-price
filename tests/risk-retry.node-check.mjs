import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchShopApiSnapshot, parseRetryAfter } from '../scripts/push-sync.mjs';

const shop = { shopUrl: 'https://example.test/shop/test' };
function gate() { return { delays: [], blocked: false, before: async () => {}, cooldown(ms) { this.delays.push(ms); }, block() { this.blocked = true; } }; }
test('风控按 Retry-After 退避重试，成功后继续', async () => {
  const orig=globalThis.fetch; let calls=0; const g=gate();
  globalThis.fetch=async url => { calls++; if (calls===1) return new Response('limited',{status:429,headers:{'retry-after':'80'}}); if(url.endsWith('/info')) return Response.json({code:1,data:{nickname:'test'}}); return Response.json({code:1,data:{total:0,list:[]}}); };
  try { const result=await fetchShopApiSnapshot(shop,{requestGate:g,allowChallengeSolve:false}); assert.equal(result.items.length,0); assert.equal(calls,3); assert.deepEqual(g.delays,[80000]); assert.equal(g.blocked,false); } finally { globalThis.fetch=orig; }
});
test('多次风控后停止且不无限重试', async () => {
  const orig=globalThis.fetch;let calls=0;const g=gate();globalThis.fetch=async()=>{calls++;return new Response('busy',{status:429});};
  try { await assert.rejects(fetchShopApiSnapshot(shop,{requestGate:g,allowChallengeSolve:false}), e=>e.isRateLimited);assert.equal(calls,3);assert.deepEqual(g.delays,[60000,120000]);assert.equal(g.blocked,true); } finally {globalThis.fetch=orig;}
});
test('等待超出上限时停止，支持 HTTP 日期', async () => {
  const orig=globalThis.fetch;const g=gate();let calls=0;globalThis.fetch=async()=>{calls++;return new Response('busy',{status:429,headers:{'retry-after':'1800'}});};
  try { await assert.rejects(fetchShopApiSnapshot(shop,{requestGate:g,allowChallengeSolve:false}),e=>e.isRateLimited);assert.equal(calls,1);assert.equal(g.blocked,true);assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:01:00 GMT',0),60000); } finally {globalThis.fetch=orig;}
});
