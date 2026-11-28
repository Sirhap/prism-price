/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, expect, it, vi } from 'vitest';
import { market16688Adapter } from '../src/collector/adapters/market16688Adapter';
import type { ShopRecord, SyncRunSummary } from '../src/types';

beforeAll(async()=>{await applyD1Migrations(env.DB,env.TEST_MIGRATIONS);});

it("迁移保留店铺和报价标识，并重写预览里的真实链接", async () => {
  const oldShop = "http://16688.com.cn/shop/S-domain?ref=a";
  const oldItem = "https://www.16688.com.cn/goods/G-domain#info";
  const unrelated = "https://www.16688.com.cn.example/goods/not-market";
  const shopSummary = JSON.stringify([{ items: [{ itemUrl: oldItem }, { itemUrl: unrelated }] }]);
  const offersPreview = JSON.stringify([{ shopUrl: oldShop, itemUrl: oldItem, note: oldShop }]);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO shops
      (id, shop_name, shop_url, canonical_url, product_summary_json, next_sync_at, updated_at)
      VALUES ('domain-shop', 'domain shop', ?, ?, ?, '2026-11-01', '2026-11-01')`).bind(oldShop, oldShop, shopSummary),
    env.DB.prepare(`INSERT INTO offers
      (id, shop_id, group_key, raw_name, clean_name, brand_group, price, item_url, updated_at)
      VALUES ('domain-offer', 'domain-shop', 'domain-group', 'domain', 'domain', 'Codex', 1, ?, '2026-11-01')`).bind(oldItem),
    env.DB.prepare(`INSERT INTO product_groups
      (group_key, display_name, brand_group, min_price, median_price, max_price, shop_count, offer_count,
       lead_shop_id, lead_shop_name, lead_shop_url, lead_item_url, stock_status, offers_preview_json, updated_at)
      VALUES ('domain-group', 'domain', 'Codex', 1, 1, 1, 1, 1, 'domain-shop', 'domain shop', ?, ?, 'normal', ?, '2026-11-01')`)
      .bind(oldShop, oldItem, offersPreview),
  ]);
  const migration = env.TEST_MIGRATIONS.find(entry => entry.name === "0029_market16688_store_domain.sql")!;
  await env.DB.batch(migration.queries.map(sql => env.DB.prepare(sql)));
  const shop = await env.DB.prepare("SELECT shop_url, canonical_url, product_summary_json FROM shops WHERE id='domain-shop'")
    .first<{ shop_url: string; canonical_url: string; product_summary_json: string }>();
  expect(shop?.shop_url).toBe("https://www.16688.store/shop/S-domain?ref=a");
  expect(shop?.canonical_url).toBe(shop?.shop_url);
  expect(JSON.parse(shop!.product_summary_json)).toEqual([{ items: [{ itemUrl: "https://www.16688.store/goods/G-domain#info" }, { itemUrl: unrelated }] }]);
  expect(await env.DB.prepare("SELECT item_url FROM offers WHERE id='domain-offer'").first("item_url"))
    .toBe("https://www.16688.store/goods/G-domain#info");
  const group = await env.DB.prepare("SELECT lead_shop_url, lead_item_url, offers_preview_json FROM product_groups WHERE group_key='domain-group'")
    .first<{ lead_shop_url: string; lead_item_url: string; offers_preview_json: string }>();
  expect(group?.lead_shop_url).toBe(shop?.shop_url);
  expect(group?.lead_item_url).toBe("https://www.16688.store/goods/G-domain#info");
  expect(JSON.parse(group!.offers_preview_json)).toEqual([{ shopUrl: group?.lead_shop_url, itemUrl: group?.lead_item_url, note: oldShop }]);
  const again = await env.DB.batch(migration.queries.map(sql => env.DB.prepare(sql)));
  expect(again.every(result => !result.meta.changes)).toBe(true);
});
it('识别 16688 详情和商品，保留缺货并区分空列表与异常响应',async()=>{
 const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{
  const u=String(input); if(u.includes('goodsCategory/list'))return Response.json({code:1,data:[]}); if(u.endsWith('/shop/detail'))return Response.json({code:1,data:{shop_no:'S447917',name:'测试店'}});
  return Response.json({code:1,data:{list:[{goods_no:'G001',name:'商品一',price:12,stock_available_quantity:0,stock_available_status:'out'}]}});
 });
 try {
  const shop={shop_url:'https://www.16688.com.cn/shop/S447917',canonical_url:'https://www.16688.com.cn/shop/S447917',shop_name:'测试',telegram:'',shop_sell_count:null} as ShopRecord;
  const snapshot = await market16688Adapter.fetchSnapshot(shop, env);
  expect(snapshot.canonicalUrl).toBe("https://www.16688.store/shop/S447917");
  expect(snapshot.items).toHaveLength(1);
  expect(snapshot.items[0]).toMatchObject({ itemKey: "G001", stockCount: 0, itemUrl: "https://www.16688.store/goods/G001" });
  expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual(Array(3).fill("www.16688.store"));
  fetchMock.mockImplementation(async input=>String(input).includes('goodsCategory/list')?Response.json({code:1,data:[]}):String(input).endsWith('/shop/detail')?Response.json({code:1,data:{shop_no:'S447917'}}):Response.json({code:1,data:{list:[]}}));
  expect((await market16688Adapter.fetchSnapshot(shop,env)).items).toEqual([]);
  fetchMock.mockImplementation(async input=>String(input).includes('goodsCategory/list')?Response.json({code:1,data:[]}):String(input).endsWith('/shop/detail')?Response.json({code:1,data:{shop_no:'S447917'}}):Response.json({code:1,data:{}}));
  await expect(market16688Adapter.fetchSnapshot(shop,env)).rejects.toThrow('未覆盖');
 } finally {fetchMock.mockRestore();}
});
it('指定店铺采集以部分快照合并，不删除源站未返回的旧商品',async()=>{
 const id='market-16688-test',url='https://www.16688.com.cn/shop/S447917';
 await env.DB.prepare('INSERT INTO shops (id,shop_name,shop_url,canonical_url,adapter_type,sync_supported,next_sync_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,'测试',url,url,'manual',0,'2026','2026').run();
 const auth={'Content-Type':'application/json',Authorization:'Bearer test-ingest-secret'};
 const old={itemKey:'old',rawName:'ChatGPT Plus old',shopCategory:'',price:10,stockCount:1,stockStatus:'low',itemUrl:'https://www.16688.com.cn/goods/old'};
 expect((await SELF.fetch('http://localhost/api/ingest',{method:'POST',headers:auth,body:JSON.stringify({shops:[{shopId:id,shopUrl:url,snapshot:{shopName:'测试',canonicalUrl:url,items:[old]}}]})})).status).toBe(200);
 const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>String(input).includes('goodsCategory/list')?Response.json({code:1,data:[]}):String(input).endsWith('/shop/detail')?Response.json({code:1,data:{shop_no:'S447917',name:'测试'}}):Response.json({code:1,data:{list:[{goods_no:'new',name:'ChatGPT Plus new',price:11,stock_available_quantity:0}]}}));
 try { const res=await SELF.fetch('http://localhost/api/sync',{method:'POST',headers:auth,body:JSON.stringify({shopId:id})});const data=await res.json() as {failedCount:number};expect(data.failedCount).toBe(0);expect(await env.DB.prepare('SELECT count(*) AS n FROM offers WHERE shop_id=?').bind(id).first('n')).toBe(2); } finally {spy.mockRestore();}
});

it('仅移除来源确认且未被更新的 16688 报价，重算同款最低价并保留历史', async () => {
  const shopId = 'market-16688-missing';
  const shopUrl = 'https://www.16688.com.cn/shop/S910427';
  const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer test-ingest-secret' };
  const offer = (itemKey: string, price: number) => ({
    itemKey, rawName: 'Gemini Pro 三个月 xiaomi渠道', price, stockCount: 10,
    itemUrl: `https://www.16688.com.cn/goods/${itemKey}`,
  });
  const ingest = (entry: Record<string, unknown>) => SELF.fetch('http://localhost/api/ingest', {
    method: 'POST', headers: auth, body: JSON.stringify({ shopId, shopUrl, ...entry }),
  });
  const removed = offer('G67965422', 9.45);
  const current = offer('G20780331', 9.49);
  const unconfirmed = offer('G82504891', 10.80);
  const snapshot = (items: ReturnType<typeof offer>[]) => ({ shopName: 'AIMart', canonicalUrl: shopUrl, items });
  expect((await ingest({ partial: true, snapshot: snapshot([removed, current, unconfirmed]) })).status).toBe(200);
  const old = await env.DB.prepare('SELECT updated_at, group_key FROM offers WHERE id = ?')
    .bind(`${shopId}:${removed.itemKey}`).first<{ updated_at: string; group_key: string }>();
  await env.DB.prepare('INSERT INTO shop_daily_snapshots (shop_id, day, product_count, has_stock) VALUES (?, ?, ?, ?)')
    .bind(shopId, '2020-01-01', 3, 1).run();
  const proof = { itemKey: removed.itemKey, updatedAt: old!.updated_at };
  expect((await ingest({ partial: true, snapshot: snapshot([removed]), confirmedMissingOffers: [proof] })).status).toBe(400);

  const confirmedMissingOffers = [proof, { itemKey: unconfirmed.itemKey, updatedAt: '2020-01-01T00:00:00.000Z' }];
  const update = { partial: true, snapshot: snapshot([current]), confirmedMissingOffers };
  expect((await ingest(update)).status).toBe(200);
  expect((await ingest(update)).status).toBe(200);
  const remaining = await env.DB.prepare('SELECT id FROM offers WHERE shop_id = ? ORDER BY price').bind(shopId).all<{ id: string }>();
  expect(remaining.results.map(row => row.id)).toEqual([`${shopId}:${current.itemKey}`, `${shopId}:${unconfirmed.itemKey}`]);
  const group = await env.DB.prepare('SELECT min_price, offer_count FROM product_groups WHERE group_key = ?').bind(old!.group_key).first();
  expect(group).toEqual({ min_price: 9.49, offer_count: 2 });
  expect(await env.DB.prepare('SELECT product_count FROM shop_daily_snapshots WHERE shop_id = ? AND day = ?')
    .bind(shopId, '2020-01-01').first('product_count')).toBe(3);
});

it('单店同步遇到空列表时只移除详情明确不存在的报价', async () => {
  const shopId = 'market-16688-empty';
  const shopUrl = 'https://www.16688.com.cn/shop/XIAOMO';
  const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer test-ingest-secret' };
  const items = ['G30774515', 'G82504891'].map(itemKey => ({
    itemKey, rawName: 'Gemini Pro 三个月 xiaomi渠道', price: 11, stockCount: 4,
    itemUrl: `https://www.16688.com.cn/goods/${itemKey}`,
  }));
  const seeded = await SELF.fetch('http://localhost/api/ingest', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ shopId, shopUrl, partial: true, snapshot: { shopName: 'AI小墨', canonicalUrl: shopUrl, items } }),
  });
  expect(seeded.status).toBe(200);

  const requested: string[] = [];
  const source = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/shop/detail')) return Response.json({ code: 1, data: { shop_no: 'XIAOMO' } });
    if (url.endsWith('/goodsCategory/list')) return Response.json({ code: 1, data: [] });
    if (url.endsWith('/goods/list')) return Response.json({ code: 1, data: { list: [] } });
    expect(url).toMatch(/\/goods\/detail$/);
    const { goods_no } = JSON.parse(String(init?.body)) as { goods_no: string };
    requested.push(goods_no);
    return goods_no === 'G30774515'
      ? Response.json({ code: 0, msg: '商品不存在', data: null })
      : new Response('rate limited', { status: 429 });
  });
  try {
    const response = await SELF.fetch('http://localhost/api/sync', {
      method: 'POST', headers: auth, body: JSON.stringify({ shopId }),
    });
    const data = await response.json<SyncRunSummary>();
    expect(data.failedCount).toBe(1);
    expect(data.outcomes[0].market16688Verification).toEqual({ interrupted: true });
    expect(requested).toEqual(['G30774515', 'G82504891']);
    const remaining = await env.DB.prepare('SELECT id FROM offers WHERE shop_id = ?').bind(shopId).all<{ id: string }>();
    expect(remaining.results).toEqual([{ id: `${shopId}:G82504891` }]);
  } finally {
    source.mockRestore();
  }
});

it('服务端单店同步能续查下一批，保留详情正常的遗漏报价', async () => {
  const shopId = 'market-16688-continuation';
  const shopUrl = 'https://www.16688.com.cn/shop/S345610';
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer test-ingest-secret' };
  const keys = ['G100', 'G200', 'G300', 'G400'];
  const items = keys.map(itemKey => ({
    itemKey, rawName: 'Gemini Pro 三个月', price: 12, stockCount: 3,
    itemUrl: `https://www.16688.com.cn/goods/${itemKey}`,
  }));
  const seed = await SELF.fetch('http://localhost/api/ingest', {
    method: 'POST', headers,
    body: JSON.stringify({ shopId, shopUrl, partial: true, snapshot: { shopName: '16688 Shop', canonicalUrl: shopUrl, items } }),
  });
  expect(seed.status).toBe(200);

  const requested: string[] = [];
  const source = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/shop/detail')) return Response.json({ code: 1, data: { shop_no: 'S345610' } });
    if (url.endsWith('/goodsCategory/list')) return Response.json({ code: 1, data: [] });
    if (url.endsWith('/goods/list')) return Response.json({ code: 1, data: { list: [] } });
    expect(url).toMatch(/\/goods\/detail$/);
    const { goods_no } = JSON.parse(String(init?.body)) as { goods_no: string };
    requested.push(goods_no);
    return goods_no === 'G200' ? Response.json({ code: 1, data: { goods_no } })
      : Response.json({ code: 0, msg: '商品不存在', data: null });
  });
  const sync = (market16688Cursor?: string) => SELF.fetch('http://localhost/api/sync', {
    method: 'POST', headers, body: JSON.stringify({ shopId, market16688Cursor }),
  });
  try {
    const first = await (await sync()).json<SyncRunSummary>();
    expect(first.failedCount).toBe(0);
    const cursor = first.outcomes[0].market16688Verification?.nextCursor;
    expect(cursor).toBe('G300');

    const second = await (await sync(cursor)).json<SyncRunSummary>();
    expect(second.failedCount).toBe(0);
    expect(second.outcomes[0].market16688Verification).toEqual({});
    expect(requested).toEqual(keys);
    const remaining = await env.DB.prepare('SELECT id FROM offers WHERE shop_id = ?').bind(shopId).all<{ id: string }>();
    expect(remaining.results).toEqual([{ id: `${shopId}:G200` }]);
  } finally {
    source.mockRestore();
  }
}, 12000);
