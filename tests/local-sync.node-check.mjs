import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSync, parseArgs, loadConfig, shardForShop, createRequestGate } from '../local-sync/sync.mjs';
import { computeSnapshotHash } from '../scripts/lib/snapshotHash.mjs';

const snapshot = { shopName: 'Shop', canonicalUrl: 'https://example.test/shop/a', description: '', items: [{itemKey:'one',rawName:'test',shopCategory:'',price:1,stockCount:1,stockStatus:'normal',itemUrl:'https://example.test/item/one'}] };
const shops = ['a', 'b', 'c'].map((id) => ({ id, shopUrl: `https://example.test/shop/${id}`, syncSupported: true, adapterType: 'push_ingest', syncState: 'ready' }));
const load = async () => ({ shops, descriptionPersistence: true });
const options = (checkpoint, extra = {}) => ({ apiBase: 'https://example.test', apply: false, resume: false, concurrency: 1, limit: 0, shops: [], checkpoint, ...extra });
const result = (id) => ({ failedCount: 0, outcomes: [{ shopId: id, status: 'updated' }] });

test('预览不写入；无变化跳过；失败不会上报', async () => {
  const checkpoint = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'local-sync-')), 'state.json');
  const same = { ...shops[0], contentHashFull: computeSnapshotHash(snapshot), description: '' };
  let pushes = 0;
  const stats = await runSync(options(checkpoint), { load: async () => ({ shops: [same, ...shops.slice(1)] }), collect: async (s) => { if (s.id === 'c') throw new Error('源站不可用'); return snapshot; }, push: async () => { pushes++; } });
  assert.equal(stats.unchanged, 1); assert.equal(stats.changed, 1); assert.equal(stats.failed, 1); assert.equal(pushes, 0); assert.equal(fs.existsSync(checkpoint), false);
});

test('推送只记录已确认完成的店铺，续跑失败店铺且拒绝不同目标', async () => {
  const checkpoint = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'local-sync-')), 'state.json');
  const sent = [];
  const push = async (entry) => { sent.push(entry.shopId); if (entry.shopId === 'b') throw new Error('network'); return result(entry.shopId); };
  const first = await runSync(options(checkpoint, { apply: true }), { load, collect: async () => snapshot, push });
  assert.equal(first.failed, 1); assert.deepEqual(sent, ['a', 'b', 'c']);
  const resumed = [];
  const second = await runSync(options(checkpoint, { apply: true, resume: true }), { load, collect: async (s) => { resumed.push(s.id); return snapshot; }, push: async (e) => result(e.shopId) });
  assert.deepEqual(resumed, ['b']); assert.equal(second.resumed, 2); assert.equal(second.failed, 0);
  await assert.rejects(runSync(options(checkpoint, { apiBase: 'https://other.test', apply: true, resume: true }), { load, push }), /目标地址不匹配/);
});

test('严格限制参数、店铺范围和远程明文地址', async () => {
  assert.throws(() => parseArgs(['--concurrency=0']), /并发数/);
  assert.throws(() => parseArgs(['--resume']), /apply/);
  assert.throws(() => parseArgs(['--unexpected']), /未知参数/);
  await assert.rejects(runSync(options('/tmp/unused', { apiBase: 'http://example.test' }), { load }), /HTTPS/);
  await assert.rejects(runSync(options('/tmp/unused', { shops: ['absent'] }), { load }), /没有找到/);
});

test('本地 HTTP 接口实际收发同步清单与鉴权快照', async () => {
  const http = await import('node:http');
  const received = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ shops: [shops[0]], descriptionPersistence: true }));
    let body = ''; for await (const chunk of req) body += chunk;
    received.push({ auth: req.headers.authorization, body: JSON.parse(body) });
    res.end(JSON.stringify(result('a')));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const checkpoint = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'local-sync-http-')), 'state.json');
    const stats = await runSync(options(checkpoint, { apiBase: `http://127.0.0.1:${server.address().port}`, apply: true, secret: 'test-secret' }), { collect: async () => snapshot });
    assert.equal(stats.pushed, 1); assert.equal(received[0].auth, 'Bearer test-secret'); assert.equal(received[0].body.shops[0].shopId, 'a');
    assert.equal(fs.readFileSync(checkpoint, 'utf8').includes('test-secret'), false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});


test('配置文件集中设置地址和密钥，环境变量优先且兼容旧密钥', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-sync-config-'));
  const files = { config: path.join(dir, 'config.env'), legacy: path.join(dir, 'legacy') };
  fs.writeFileSync(files.config, 'API_BASE=https://target.test\nINGEST_SECRET="configured"\n');
  fs.writeFileSync(files.legacy, 'INGEST_SECRET=legacy\n');
  assert.deepEqual(loadConfig({}, files), { apiBase: 'https://target.test', secret: 'configured', intervalMinMs: 1000, intervalMaxMs: 2000 });
  assert.deepEqual(loadConfig({ API_BASE: 'https://override.test', INGEST_SECRET: 'override' }, files), { apiBase: 'https://override.test', secret: 'override', intervalMinMs: 1000, intervalMaxMs: 2000 });
  fs.writeFileSync(files.config, 'API_BASE=https://target.test\nINGEST_SECRET=\n');
  assert.equal(loadConfig({}, files).secret, 'legacy');
});


test('稳定分片覆盖每家店且不会重叠，参数防止过快请求', () => {
  const ids = Array.from({ length: 1000 }, (_, i) => `shop-${i}`);
  const shards = [1, 2, 3, 4].map(n => ids.filter(id => shardForShop(id, 4) === n));
  assert.equal(new Set(shards.flat()).size, ids.length);
  assert.ok(shards.every(group => group.length > 0));
  assert.deepEqual(ids.map(id => shardForShop(id, 4)), [...ids].map(id => shardForShop(id, 4)));
  assert.throws(() => parseArgs(['--interval-ms=100']), /500/);
  assert.throws(() => parseArgs(['--shard=3/2']), /分片范围/);
  assert.notEqual(parseArgs(['--shard=1/2']).checkpoint, parseArgs(['--shard=2/2']).checkpoint);
});

test('请求间隔全局串行且风控时停止后续店铺', async () => {
  let clock = 0;
  const gate = createRequestGate(3000, { maxIntervalMs: 5000, now: () => clock, random: () => 0, sleep: async (ms) => { clock += ms; } });
  await Promise.all([gate.before(), gate.before(), gate.before()]);
  assert.equal(clock, 6000);
  const checkpoint = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'local-sync-stop-')), 'state.json');
  let collected = 0;
  const stats = await runSync(options(checkpoint, { apply: true }), { load, gate, collect: async () => { collected++; const e = new Error('风控'); e.isRateLimited = true; throw e; }, push: async () => { throw new Error('不应推送'); } });
  assert.equal(collected, 1); assert.equal(stats.failed, 1); assert.equal(stats.unprocessed, 2); assert.equal(gate.isBlocked(), true);
  await assert.rejects(gate.before(), /停止本轮/);
});

test('源站忽略请求 limit 时仍读取全部分页', async () => {
  const { fetchShopApiSnapshot } = await import('../scripts/push-sync.mjs');
  const original = globalThis.fetch;
  const pageCalls = [];
  const items = Array.from({ length: 24 }, (_, i) => ({ goods_key: `item-${i}`, name: `product ${i}`, price: 10, extend: { stock_count: 1 } }));
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/info')) return Response.json({ code: 1, data: { nickname: 'Test', goods_count: 24 } });
    pageCalls.push(body.current);
    return Response.json({ code: 1, data: { total: 24, list: items.slice((body.current - 1) * 20, body.current * 20) } });
  };
  try {
    const snapshot = await fetchShopApiSnapshot({ shopUrl: 'https://example.test/shop/test' });
    assert.equal(snapshot.items.length, 24);
    assert.deepEqual(pageCalls, [1, 2]);
  } finally { globalThis.fetch = original; }
});

test('限制响应记录具体提示并隐藏敏感内容，重试耗尽后停止', async () => {
  const { fetchShopApiSnapshot, safeSourceMessage } = await import('../scripts/push-sync.mjs');
  const original = globalThis.fetch; let calls = 0; let blocked = false; const delays = [];
  globalThis.fetch = async () => { calls++; return Response.json({ code: 0, msg: '访问频繁，请稍后再试 token=secret123' }); };
  try {
    await assert.rejects(fetchShopApiSnapshot({ shopUrl: 'https://example.test/shop/a' }, { requestGate: { before: async () => {}, cooldown: ms => delays.push(ms), block: () => { blocked = true; } }, allowChallengeSolve: false }), (err) => {
      assert.match(err.message, /HTTP 200/); assert.match(err.message, /访问频繁/); assert.doesNotMatch(err.message, /secret123/); return true;
    });
    assert.equal(calls, 3); assert.deepEqual(delays,[60000,120000]); assert.equal(blocked, true);
    assert.doesNotMatch(safeSourceMessage('联系 a@example.com https://x.test/?token=123'), /example.com|token=123/);
  } finally { globalThis.fetch = original; }
});

test('商家封禁不是访问风控，已关闭或不存在店铺仅明确启用时删除', async () => {
  const { fetchShopApiSnapshot } = await import('../scripts/push-sync.mjs');
  const original = globalThis.fetch; let blocked = false;
  try {
    globalThis.fetch = async () => Response.json({code: 0, msg:'该商家已被封禁，有疑问请联系平台客服'});
    await assert.rejects(fetchShopApiSnapshot({shopUrl:'https://example.test/shop/a'}, {requestGate:{before:async()=>{},block:()=>{blocked=true;}}}), e => !e.isRateLimited && !e.shopUnavailable && /商家已被封禁/.test(e.message));
    assert.equal(blocked,false);
    globalThis.fetch = async () => Response.json({code:0,msg:'商家已被关闭交易，有疑问请联系平台客服'});
    await assert.rejects(fetchShopApiSnapshot({shopUrl:'https://example.test/shop/a'}, {requestGate:{before:async()=>{},block:()=>{blocked=true;}}}), e => e.shopUnavailable === "closed");
    const checkpoint = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sync-delete-')),'state.json');
    let deleted = 0;
    const collect = async () => { const e = new Error('店铺链接不存在'); e.shopUnavailable = 'not_found'; throw e; };
    const remove = async (shop) => { deleted++; return {deleted:true,shopId:shop.id}; };
    const preview = await runSync(options(checkpoint), {load:async()=>({shops:[shops[0]]}),collect,remove});
    assert.equal(deleted,0); assert.equal(preview.failed,1);
    const applied = await runSync(options(checkpoint,{apply:true}), {load:async()=>({shops:[shops[0]]}),collect,remove,push:async()=>{throw Error('不应推送');}});
    assert.equal(deleted,1); assert.equal(applied.deleted,1);
  } finally { globalThis.fetch = original; }
});


test('间隔配置和环境覆盖生效，范围校验且随机取值在边界内', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-interval-'));
  const files = {config:path.join(dir,'config'),legacy:path.join(dir,'legacy')};
  fs.writeFileSync(files.config,'SYNC_INTERVAL_MIN_MS=4000\nSYNC_INTERVAL_MAX_MS=6000\n');
  const config = loadConfig({SYNC_INTERVAL_MAX_MS:'7000'},files);
  assert.equal(config.intervalMinMs,4000); assert.equal(config.intervalMaxMs,7000);
  assert.throws(() => createRequestGate(3000,{maxIntervalMs:2000}), /范围无效/);
  let clock=0;
  const gate=createRequestGate(3000,{maxIntervalMs:5000,random:()=>0.999999,now:()=>clock,sleep:async ms=>{clock+=ms;}});
  await gate.before();await gate.before();assert.equal(clock,5000);
});

test('关闭交易默认不删除，明确启用后才删除', async () => {
  const checkpoint = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sync-closed-')), 'state.json');
  let deletes = 0;
  const collect = async () => { const error = new Error('商家已被关闭交易'); error.shopUnavailable = 'closed'; throw error; };
  const deps = { load: async () => ({ shops: [shops[0]] }), collect, push: async () => {}, remove: async (shop) => { deletes++; return { deleted: true, shopId: shop.id }; } };
  const first = await runSync(options(checkpoint, { apply: true }), deps);
  assert.equal(first.failed, 1); assert.equal(deletes, 0);
  const second = await runSync(options(checkpoint, { apply: true, deleteUnavailable: true }), deps);
  assert.equal(second.deleted, 1); assert.equal(deletes, 1);
});

test('支持 500ms 配置并维持随机范围，低于下限拒绝', async () => {
  assert.equal(parseArgs(['--interval-ms=500']).intervalMs,500);
  assert.throws(()=>parseArgs(['--interval-ms=499']), /500/);
  let clock=0; const gate=createRequestGate(500,{maxIntervalMs:750,now:()=>clock,random:()=>0,sleep:async ms=>{clock+=ms;}});
  await gate.before();gate.cooldown(2000);await gate.before();assert.equal(clock,2000);
  await gate.before();assert.equal(clock,2500);
});

test('不可信商品总数不能覆盖，重复页不被误认为完整', async () => {
  const {fetchShopApiSnapshot}=await import('../scripts/push-sync.mjs'); const orig=globalThis.fetch;
  const item={goods_key:'a',name:'test',price:10,extend:{stock_count:1}};
  try {
    for (const total of [undefined,null,'bad',-1,0.5,0]) {
      globalThis.fetch=async url=>Response.json(url.endsWith('/info')?{code:1,data:{nickname:'test'}}:{code:1,data:{total,list:[item]}});
      await assert.rejects(fetchShopApiSnapshot(shops[0]),/总数缺失或无效/);
    }
    let calls=0;
    globalThis.fetch=async url=>{if(url.endsWith('/info'))return Response.json({code:1,data:{nickname:'test'}});calls++;return Response.json({code:1,data:{total:2,list:[item]}});};
    await assert.rejects(fetchShopApiSnapshot(shops[0]),/快照不完整/);assert.equal(calls,2);
  } finally {globalThis.fetch=orig;}
});

test('已不存在的目标删除为幂等成功，普通 404 仍失败', async () => {
  const orig=globalThis.fetch;
  const collect=async()=>{const e=new Error('店铺不存在');e.shopUnavailable='not_found';throw e;};
  try {
    for (const [message,absent] of [['店铺不存在',true],['路由不存在',false]]) {
      const checkpoint=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sync-404-')),'state.json');
      globalThis.fetch=async()=>Response.json({error:message},{status:404});
      const stats=await runSync(options(checkpoint,{apply:true,secret:'test'}),{load:async()=>({shops:[shops[0]]}),collect});
      assert.equal(stats.alreadyAbsent,absent?1:0);assert.equal(stats.failed,absent?0:1);
      assert.equal(Boolean(JSON.parse(fs.readFileSync(checkpoint)).completed.a),absent);
    }
  } finally {globalThis.fetch=orig;}
});


test('完整采集无在售商品时预览提示，正式同步删除；采集错误不删除', async () => {
  const checkpoint = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sync-empty-')), 'state.json');
  const empty = {...snapshot, items: []}; let removed = 0, pushed = 0;
  const deps = { load: async()=>({shops:[shops[0]]}), collect: async()=>empty, remove: async s=>{removed++;return {deleted:true,shopId:s.id};}, push: async()=>{pushed++;return result('a');} };
  const preview = await runSync(options(checkpoint),deps);
  assert.equal(preview.emptyCandidates,1);assert.equal(removed,0);
  const applied = await runSync(options(checkpoint,{apply:true}),deps);
  assert.equal(applied.deleted,1);assert.equal(removed,1);assert.equal(pushed,0);
  const failed = await runSync(options(checkpoint,{apply:true}),{...deps,collect:async()=>{throw Error('fetch failed');}});
  assert.equal(failed.failed,1);assert.equal(removed,1);
});

test('暂时缺货的商品保留且全店缺货不触发删除', async () => {
  const {buildShopApiSnapshot}=await import('../scripts/push-sync.mjs');
  const snap=buildShopApiSnapshot(shops[0],{nickname:'test'},[{goods_key:'sold',name:'Codex 月卡',price:10,extend:{stock_count:0,show_stock_type:0}}],'https://example.test','a');
  assert.equal(snap.items.length,1);assert.equal(snap.items[0].stockCount,0);
  const checkpoint=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sync-stock-')),'state.json');let removed=0;
  const stats=await runSync(options(checkpoint,{apply:true}),{load:async()=>({shops:[shops[0]]}),collect:async()=>snap,remove:async()=>{removed++;},push:async()=>result('a')});
  assert.equal(stats.pushed,1);assert.equal(removed,0);
});
