/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF, type D1Migration } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
declare global { namespace Cloudflare { interface Env { TEST_MIGRATIONS: D1Migration[] } } }
const origin = 'http://localhost';
const testPassword = 'only-for-isolated-test';
let cookie = '';
const headers = (authenticated = false) => ({'content-type':'application/json','origin':origin,...(authenticated ? {cookie} : {})});
async function post(path:string, data:unknown, authenticated = false) { return SELF.fetch(origin+path,{method:'POST',headers:headers(authenticated),body:JSON.stringify(data)}); }
beforeAll(async () => {
  await applyD1Migrations(env.DB,env.TEST_MIGRATIONS);
  const salt = new Uint8Array(16).fill(37), key = await crypto.subtle.importKey('raw',new TextEncoder().encode(testPassword),'PBKDF2',false,['deriveBits']);
  const hash = new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:210000},key,256));
  await env.DB.prepare('UPDATE admin_settings SET password_salt=?,password_hash=? WHERE id=1').bind(btoa(String.fromCharCode(...salt)),btoa(String.fromCharCode(...hash))).run();
  for (const [id,count] of [['a',2],['b',8],['c',5]] as const) await env.DB.prepare("INSERT INTO shops(id,shop_name,shop_url,canonical_url,product_count,next_sync_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(`admin-test-${id}`,`管理测试${id}`,`https://example.com/${id}`,`https://example.com/${id}`,count,'2026-01-01','2026-01-01').run();
});
describe('后台和店铺排名', () => {
 it('会话需要认证、相同来源，错误尝试被限制', async () => {
  expect((await SELF.fetch(origin+'/api/control/settings')).status).toBe(401);
  expect((await SELF.fetch(origin+'/api/control/login',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body:'{}'})).status).toBe(403);
  for(let i=0;i<5;i++) expect((await SELF.fetch(origin+'/api/control/login',{method:'POST',headers:{...headers(),'CF-Connecting-IP':'198.51.100.1'},body:JSON.stringify({password:'wrong'})})).status).toBe(401);
  expect((await SELF.fetch(origin+'/api/control/login',{method:'POST',headers:{...headers(),'CF-Connecting-IP':'198.51.100.1'},body:JSON.stringify({password:testPassword})})).status).toBe(429);
  const response=await post('/api/control/login',{password:testPassword}); expect(response.status).toBe(200);
  cookie=response.headers.get('set-cookie')!.split(';')[0]; expect(cookie).toContain('admin_session=');
  expect((await SELF.fetch(origin+'/api/control/settings',{headers:{cookie}})).status).toBe(200);
  expect((await post('/api/control/shop-details',{shopId:'admin-test-a',integrationCode:'Lucky plus',favoriteCount:7})).status).toBe(401);
  expect((await SELF.fetch(origin+'/api/control/visits')).status).toBe(401);
  expect((await SELF.fetch(origin+'/api/visit',{method:'POST',headers:{...headers(),'CF-Connecting-IP':'203.0.113.8','CF-IPCountry':'CN','CF-IPCity':'Beijing','User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'},body:'{}'})).status).toBe(204);
  expect((await SELF.fetch(origin+'/api/visit',{method:'POST',headers:{...headers(),'X-Real-IP':'127.0.0.1','User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'},body:'{}'})).status).toBe(204);
  const visits=await (await SELF.fetch(origin+'/api/control/visits',{headers:{cookie}})).json() as {todayViews:number;days:Array<{day:string;page_views:number}>;recentLogs:Array<{ip:string;location:string;device:string;os:string;browser:string}>};
  expect(visits.todayViews).toBe(2);expect(visits.days[0].page_views).toBe(2);
  expect(visits.recentLogs[0]).toMatchObject({ip:'127.0.0.1',location:'本地 / 内网',device:'桌面端',os:'macOS',browser:'Chrome'});
  expect(visits.recentLogs[1]).toMatchObject({ip:'203.0.113.8',location:'中国 · Beijing',device:'手机',os:'iOS',browser:'Safari'});
  expect((await SELF.fetch(origin+'/api/control/sync-shops')).status).toBe(401);
  const syncList=await (await SELF.fetch(origin+'/api/control/sync-shops',{headers:{cookie}})).json() as {shops:Array<{id:string}>};
  expect(syncList.shops.some(s=>s.id==='admin-test-a')).toBe(true);
 });
 it('收藏幂等，关闭停止写入，排名与过滤一致', async () => {
  await env.DB.prepare("UPDATE shops SET last_synced_at=CASE id WHEN 'admin-test-a' THEN '2026-03-01' WHEN 'admin-test-b' THEN '2026-01-01' ELSE '2026-02-01' END WHERE id LIKE 'admin-test-%'").run();
  const natural=await (await SELF.fetch(origin+'/api/shops?q=管理测试&page=1')).json() as {shops:Array<{id:string}>};
  expect(natural.shops.map(s=>s.id)).toEqual(['admin-test-a','admin-test-c','admin-test-b']);
  const clientId='a'.repeat(32), shopId='admin-test-a';
  expect((await post('/api/control/shop-details',{shopId,integrationCode:'Lucky plus',favoriteCount:7},true)).status).toBe(200);
  const managed=await (await SELF.fetch(origin+'/api/control/rank-shops?q=管理测试a',{headers:{cookie}})).json() as {shops:Array<{integrationCode:string;favoriteCount:number}>};
  expect(managed.shops[0]).toMatchObject({integrationCode:'Lucky plus',favoriteCount:7});
  expect((await post('/api/control/shop-details',{shopId,integrationCode:'Test',favoriteCount:9,manualRank:2},true)).status).toBe(200);
  expect(await env.DB.prepare('SELECT manual_rank,favorite_count FROM shop_rank_settings WHERE shop_id=?').bind(shopId).first()).toMatchObject({manual_rank:2,favorite_count:9});
  expect((await post('/api/control/shop-details',{shopId,integrationCode:'Ignored',favoriteCount:2,manualRank:-1},true)).status).toBe(400);
  expect(await env.DB.prepare('SELECT submitted_integration_code FROM shops WHERE id=?').bind(shopId).first('submitted_integration_code')).toBe('Test');
  await post('/api/control/rank',{shopId,rank:null},true);
  expect((await post('/api/control/shop-details',{shopId,integrationCode:'bad/code',favoriteCount:7},true)).status).toBe(400);
  expect((await post('/api/control/shop-details',{shopId,integrationCode:'',favoriteCount:0},true)).status).toBe(200);
  const vote={clientId,shopId,favorite:true}; expect((await post('/api/shop-favorite',vote)).status).toBe(200); await post('/api/shop-favorite',vote);
  expect((await env.DB.prepare('SELECT favorite_count FROM shop_rank_settings WHERE shop_id=?').bind(shopId).first<{favorite_count:number}>())?.favorite_count).toBe(1);
  const set={favoritesEnabled:false,manualRankEnabled:true,submissionsEnabled:false,openStoreUrl:'https://example.com/register'};
  expect((await post('/api/control/settings',set,true)).status).toBe(200);
  await post('/api/shop-favorite',{...vote,favorite:false});
  expect((await env.DB.prepare('SELECT favorite_count FROM shop_rank_settings WHERE shop_id=?').bind(shopId).first<{favorite_count:number}>())?.favorite_count).toBe(1);
  expect((await post('/api/shops/submit',{shopUrl:'https://example.com/shop/new'})).status).toBe(403);
  expect((await SELF.fetch(origin+'/go/open-store',{redirect:'manual'})).headers.get('location')).toBe('https://example.com/register');
  expect((await post('/api/control/settings',{...set,openStoreUrls:{'16688':'https://example.com/16688'}},true)).status).toBe(200);
  expect((await SELF.fetch(origin+'/go/open-store?type=16688',{redirect:'manual'})).headers.get('location')).toBe('https://example.com/16688');
  expect((await SELF.fetch(origin+'/go/open-store?type=catfk',{redirect:'manual'})).headers.get('location')).toBe('https://catfk.com/merchant/register?invite_token=AQSDVWGY');
  expect((await SELF.fetch(origin+'/go/open-store?type=dujiaoka',{redirect:'manual'})).status).toBe(404);
  expect((await post('/api/control/settings',{...set,openStoreUrls:{'16688':'javascript:alert(1)'}},true)).status).toBe(400);
  expect((await post('/api/control/rank',{shopId:'admin-test-c',rank:1},true)).status).toBe(200);
  const adminList=async (sort:string,extra='') => await (await SELF.fetch(origin+`/api/control/rank-shops?q=管理测试&sort=${sort}${extra}`,{headers:{cookie}})).json() as {shops:Array<{id:string;rank:number;systemType?:string}>;total:number};
  expect((await adminList('manual')).shops[0].id).toBe('admin-test-c');
  expect((await adminList('products')).shops[0].id).toBe('admin-test-b');
  expect((await adminList('products-asc')).shops[0].id).toBe('admin-test-a');
  expect((await adminList('favorites')).shops[0].id).toBe('admin-test-a');
  expect((await adminList('stale')).shops[0].id).toBe('admin-test-b');
  expect((await adminList('manual','&filter=manual-ranked')).shops.map(s=>s.id)).toEqual(['admin-test-c']);
  expect((await adminList('manual','&filter=unranked')).shops.map(s=>s.id)).toEqual(['admin-test-a','admin-test-b']);
  await post('/api/control/shop-details',{shopId:'admin-test-c',integrationCode:'CODE888',favoriteCount:0,manualRank:1},true);
  expect((await adminList('manual','&filter=has-code')).shops.map(s=>s.id)).toEqual(['admin-test-c']);
  expect((await adminList('manual','&filter=no-code')).shops.map(s=>s.id)).toEqual(['admin-test-a','admin-test-b']);
  expect((await (await SELF.fetch(origin+'/api/control/rank-shops?q=code888',{headers:{cookie}})).json() as {shops:Array<{id:string}>}).shops.map(s=>s.id)).toEqual(['admin-test-c']);
  await env.DB.prepare("UPDATE shops SET sync_state='error',product_count=0,shop_url='https://catfk.com/shop/testb' WHERE id='admin-test-b'").run();
  expect((await adminList('manual','&sync=error')).shops.map(s=>s.id)).toEqual(['admin-test-b']);
  expect((await adminList('manual','&stock=empty')).shops.map(s=>s.id)).toEqual(['admin-test-b']);
  expect((await adminList('manual','&stock=in-stock')).shops.map(s=>s.id)).toEqual(['admin-test-c','admin-test-a']);
  expect((await adminList('manual','&system=catfk')).shops.map(s=>s.id)).toEqual(['admin-test-b']);
  await env.DB.prepare("UPDATE shops SET sync_state='ready',product_count=8,shop_url='https://example.com/b' WHERE id='admin-test-b'").run();
  const synced=await (await SELF.fetch(origin+'/api/control/rank-shops?q=管理测试&sort=synced',{headers:{cookie}})).json() as {shops:Array<{id:string;lastSyncedAt:string;syncState:string}>};
  expect(synced.shops[0]).toMatchObject({id:'admin-test-a',lastSyncedAt:'2026-03-01'});
  expect((await SELF.fetch(origin+'/api/control/rank-shops')).status).toBe(401);
  expect((await SELF.fetch(origin+'/api/control/rank-shops?sort=unexpected',{headers:{cookie}})).status).toBe(400);
  expect((await SELF.fetch(origin+'/api/control/rank-shops?filter=bad',{headers:{cookie}})).status).toBe(400);
  expect((await SELF.fetch(origin+'/api/control/rank-shops?sync=bad',{headers:{cookie}})).status).toBe(400);
  expect((await SELF.fetch(origin+'/api/control/rank-shops?stock=bad',{headers:{cookie}})).status).toBe(400);
  expect((await SELF.fetch(origin+'/api/control/rank-shops?system=bad',{headers:{cookie}})).status).toBe(400);
  const all=await (await SELF.fetch(origin+'/api/shops?q=管理测试&page=1&pageSize=1')).json() as {shops:Array<{id:string;rank:number;manualRecommended:boolean}>};
  expect(all.shops[0]).toMatchObject({id:'admin-test-c',manualRecommended:true});
  const filtered=await (await SELF.fetch(origin+'/api/shops?q=管理测试c&page=1&pageSize=1')).json() as {shops:Array<{rank:number}>};
  expect(filtered.shops[0].rank).toBe(all.shops[0].rank);
  await post('/api/control/settings',{...set,favoritesEnabled:true},true); await post('/api/shop-favorite',{...vote,favorite:false});
  expect((await env.DB.prepare('SELECT favorite_count FROM shop_rank_settings WHERE shop_id=?').bind(shopId).first<{favorite_count:number}>())?.favorite_count).toBe(0);
 });
 it('仅登录管理员可删除店铺及报价',async()=>{
  expect((await post('/api/control/delete-shop',{shopId:'admin-test-b'})).status).toBe(401);
  expect((await post('/api/control/delete-shop',{shopId:'admin-test-b'},true)).status).toBe(200);
  expect(await env.DB.prepare('SELECT id FROM shops WHERE id=?').bind('admin-test-b').first()).toBeNull();
 });
 it('默认推荐在同等相关度和店铺数下优先排名店铺，最低价排序仍严格按价格', async () => {
  await env.DB.prepare('UPDATE admin_settings SET manual_rank_enabled=1 WHERE id=1').run();
  await env.DB.prepare('INSERT INTO shop_rank_settings(shop_id,manual_rank) VALUES (?,?) ON CONFLICT(shop_id) DO UPDATE SET manual_rank=excluded.manual_rank').bind('admin-test-a',1).run();
  for(const [key,shop,price] of [['rank-bonus','admin-test-a',20],['rank-cheap','admin-test-b',10]] as const) {
    const preview=JSON.stringify([{id:key,shopId:shop,price}]);
    await env.DB.prepare(`INSERT INTO product_groups(group_key,display_name,brand_group,min_price,median_price,max_price,shop_count,offer_count,lead_shop_id,lead_shop_name,lead_shop_url,lead_item_url,offers_preview_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(key,'算法验证商品','ChatGPT',price,price,price,1,1,shop,'测试','https://example.com','https://example.com/item',preview,'2026-01-01').run();
  }
  const get=async (sort:string,page=1)=>await (await SELF.fetch(origin+`/api/products?q=算法验证商品&sort=${sort}&page=${page}&pageSize=1`)).json() as {items:Array<{id:string;minPrice:number}>};
  await env.DB.prepare('UPDATE product_groups SET shop_count=5 WHERE group_key=?').bind('rank-cheap').run();
  expect((await get('relevance')).items[0].minPrice).toBe(20);
  expect((await get('relevance',2)).items[0].minPrice).toBe(10);
  expect((await get('price-asc')).items[0].minPrice).toBe(10);
  const previewPath=origin+'/api/control/product-ranking-preview?q='+encodeURIComponent('算法验证商品');
  expect((await SELF.fetch(previewPath)).status).toBe(401);
  const preview=await (await SELF.fetch(previewPath,{headers:{cookie}})).json() as {items:Array<{minPrice:number;previousRank:number|null;textScore:number;shopBonus:number}>};
  expect(preview.items[0]).toMatchObject({minPrice:20,previousRank:2});
  expect(preview.items[0].shopBonus).toBeGreaterThan(0); expect(preview.items[0].textScore).toBeGreaterThan(0);
  await env.DB.prepare('UPDATE product_groups SET shop_count=100 WHERE group_key=?').bind('rank-cheap').run();
  expect((await get('relevance')).items[0].minPrice).toBe(10);
 });
 it('工作台综合指标接口需鉴权且准确汇总访问、店铺、商品、平台与同步记录', async () => {
  expect((await SELF.fetch(origin+'/api/control/overview')).status).toBe(401);
  await env.DB.prepare("UPDATE shops SET sync_state='ready',last_synced_at=? WHERE id='admin-test-a'").bind(new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO sync_runs(id,trigger_source,processed_count,skipped_unchanged,updated_count,failed_count,estimated_d1_writes,details_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
   .bind('run-overview-1','manual',3,1,2,0,45,'{"secret":"hidden"}','2026-03-02T10:00:00.000Z').run();
  const res = await SELF.fetch(origin+'/api/control/overview',{headers:{cookie}});
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).not.toContain('hidden');
  const overview = JSON.parse(text) as {
   visits: { todayViews: number; last30DaysViews: number; days: Array<{ day: string; pageViews: number }>; recentLogs: Array<{ ip: string; location: string; device: string }> };
   shops: { total: number; ready: number; inStock: number; synced24h: number; totalShopProducts: number };
   systems: Array<{ systemType: string; shopCount: number }>;
   catalog: { groupCount: number; offerCount: number; brands: Array<{ brand: string; groupCount: number; offerCount: number }> };
   operations: { manualRankedCount: number; openStoreUrlCount: number; ingestConfigured: boolean };
   recentSyncs: Array<{ id: string; triggerSource: string; processedCount: number; updatedCount: number }>;
  };
  expect(overview.visits.todayViews).toBeGreaterThanOrEqual(2);
  expect(overview.visits.last30DaysViews).toBeGreaterThanOrEqual(2);
  expect(overview.visits.recentLogs.length).toBeGreaterThanOrEqual(2);
  expect(overview.visits.recentLogs[1]).toMatchObject({ ip: '203.0.113.8', location: '中国 · Beijing', device: '手机' });
  expect(overview.shops.total).toBeGreaterThanOrEqual(2);
  expect(overview.shops.ready).toBeGreaterThanOrEqual(1);
  expect(overview.shops.synced24h).toBeGreaterThanOrEqual(1);
  expect(overview.shops.totalShopProducts).toBeGreaterThanOrEqual(7);
  expect(overview.systems.reduce((sum, item) => sum + item.shopCount, 0)).toBe(overview.shops.total);
  expect(overview.catalog.groupCount).toBeGreaterThanOrEqual(2);
  expect(overview.catalog.brands.some(b => b.brand === 'ChatGPT')).toBe(true);
  expect(overview.operations.manualRankedCount).toBeGreaterThanOrEqual(1);
  expect(overview.operations.ingestConfigured).toBe(true);
  expect(overview.recentSyncs[0]).toMatchObject({ id: 'run-overview-1', triggerSource: 'manual', processedCount: 3, updatedCount: 2 });
 });
 it('密钥轮换生效且不回显，修改密码后旧会话失效', async () => {
  const nextSecret='isolated-new-secret-123456789';
  expect((await post('/api/control/ingest-secret',{secret:nextSecret},true)).status).toBe(200);
  const data=await (await SELF.fetch(origin+'/api/control/settings',{headers:{cookie}})).text(); expect(data).not.toContain(nextSecret);
  const old=await SELF.fetch(origin+'/api/admin/shops',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test-ingest-secret'},body:'{}'}); expect(old.status).toBe(401);
  const updated=await SELF.fetch(origin+'/api/admin/shops',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${nextSecret}`},body:'{}'}); expect(updated.status).not.toBe(401);
  expect((await post('/api/control/password',{oldPassword:testPassword,newPassword:'new-isolated-password'},true)).status).toBe(200);
  expect((await SELF.fetch(origin+'/api/control/settings',{headers:{cookie}})).status).toBe(401);
 });
});
