/** Administrative controls and anonymous shop favorite counts. */
import { deleteShopById } from '../collector/scheduler';
import { hideTelegramContacts } from '../collector/shopPresentation';
import { shopReadSource } from '../collector/shopSystems';
const storeTypes = ['ldxp','catfk','16688','acg-faka','dujiaoka','other','unknown'] as const;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const encoder = new TextEncoder();
const to64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const from64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const random = (n: number) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; };
async function digest(value: string): Promise<string> { return to64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
async function passwordHash(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return to64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: from64(salt), iterations: 210000 }, key, 256)));
}
function same(a: string, b: string): boolean {
  const x = encoder.encode(a), y = encoder.encode(b);
  return x.length === y.length && crypto.subtle.timingSafeEqual(x, y);
}
function json(data: unknown, status = 200): Response { return Response.json(data, { status, headers }); }
type Settings = { password_salt: string; password_hash: string; ingest_hash: string | null; favorites_enabled: number; manual_rank_enabled: number; submissions_enabled: number; open_store_url: string; revision: number };
export async function settings(db: D1Database): Promise<Settings> {
  const row = await db.prepare('SELECT * FROM admin_settings WHERE id = 1').first<Settings>();
  if (!row) throw new Error('后台配置尚未初始化，请先执行数据库迁移');
  return row;
}
function originOk(req: Request): boolean { return req.headers.get('Origin') === new URL(req.url).origin; }
function sessionCookie(req: Request): string { return /(?:^|;\s*)admin_session=([^;]+)/.exec(req.headers.get('Cookie') || '')?.[1] || ''; }
export async function authenticated(req: Request, db: D1Database): Promise<boolean> {
  const token = sessionCookie(req); if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const row = await db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > ?').bind(await digest(token), Date.now()).first();
  return !!row;
}
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new Error('请使用 JSON');
  if (Number(req.headers.get('content-length') || 0) > 8192) throw new Error('请求过长');
  const reader = req.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  if (reader) for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 8192) { await reader.cancel(); throw new Error('请求过长'); } chunks.push(part.value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  const text = new TextDecoder().decode(bytes);
  const parsed: unknown = JSON.parse(text); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求格式错误');
  return parsed as Record<string, unknown>;
}
const cookie = (request: Request, value: string, maxAge: number) => `admin_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
export async function getIngestHash(db: D1Database): Promise<string | null> { return (await settings(db)).ingest_hash; }
export async function matchesIngestSecret(input: string, expectedHash: string): Promise<boolean> { return same(await digest(input), expectedHash); }
export async function handleAdminRoute(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url), path = url.pathname, db = env.DB;
  if (path === '/api/public-settings' && req.method === 'GET') {
    const s = await settings(db); const {results}=await db.prepare('SELECT system_type FROM open_store_urls').all<{system_type:string}>(); return json({ favoritesEnabled: !!s.favorites_enabled, submissionsEnabled: !!s.submissions_enabled, openStoreTypes:['ldxp',...results.map(r=>r.system_type)] });
  }
  if (path === '/go/open-store' && req.method === 'GET') {
    const type = url.searchParams.get('type');
    if (type && !storeTypes.includes(type as typeof storeTypes[number])) return json({error:'店铺类型无效'},400);
    if (type && type !== 'ldxp') {
      const row=await db.prepare('SELECT url FROM open_store_urls WHERE system_type=?').bind(type).first<{url:string}>();
      if (!row?.url) return new Response('该平台暂未配置开店地址', {status:404,headers});
      return Response.redirect(row.url,302);
    }
    return Response.redirect((await settings(db)).open_store_url,302);
  }
  if (path === '/api/visit' && req.method === 'POST') {
    if (!originOk(req)) return json({error:'请求来源不匹配'},403);
    const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0,10);
    await db.prepare('INSERT INTO daily_page_visits(day,page_views) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET page_views=page_views+1').bind(day).run();
    return new Response(null,{status:204,headers});
  }
  if (path === '/api/shop-favorite' && req.method === 'POST') {
    if (!originOk(req)) return json({error:'请求来源不匹配'},403);
    const s = await settings(db); if (!s.favorites_enabled) return json({ enabled: false });
    let data: Record<string, unknown>; try { data = await body(req); } catch { return json({error:'请求格式错误'},400); }
    const clientId = String(data.clientId || ''), shopId = String(data.shopId || '');
    if (!/^[a-f0-9]{32}$/.test(clientId) || !shopId || shopId.length > 128 || typeof data.favorite !== 'boolean') return json({error:'参数无效'},400);
    const exists = await db.prepare('SELECT id FROM shops WHERE id = ?').bind(shopId).first(); if (!exists) return json({error:'店铺不存在'},404);
    const statement = data.favorite
      ? db.prepare('INSERT OR IGNORE INTO shop_favorite_votes(client_id,shop_id) SELECT ?,? WHERE (SELECT favorites_enabled FROM admin_settings WHERE id=1)=1').bind(clientId,shopId)
      : db.prepare('DELETE FROM shop_favorite_votes WHERE client_id=? AND shop_id=? AND (SELECT favorites_enabled FROM admin_settings WHERE id=1)=1').bind(clientId,shopId);
    await statement.run(); return json({ok:true});
  }
  if (!path.startsWith('/api/control/')) return null;
  if (req.method !== 'GET' && !originOk(req)) return json({error:'请求来源不匹配'},403);
  if (path === '/api/control/login' && req.method === 'POST') {
    let data: Record<string, unknown>; try { data = await body(req); } catch { return json({error:'请求格式错误'},400); }
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown'; const client = await digest(ip); const now = Date.now();
    const limit = await db.prepare('SELECT failures,expires_at FROM admin_login_attempts WHERE client_hash=?').bind(client).first<{failures:number;expires_at:number}>();
    if (limit && limit.expires_at > now && limit.failures >= 5) return json({error:'登录尝试过多，请稍后再试'},429);
    const s = await settings(db); const pass = String(data.password || '').slice(0, 256);
    if (!same(await passwordHash(pass,s.password_salt), s.password_hash)) {
      await db.prepare('INSERT INTO admin_login_attempts(client_hash,failures,expires_at) VALUES (?,1,?) ON CONFLICT(client_hash) DO UPDATE SET failures=CASE WHEN expires_at < ? THEN 1 ELSE failures+1 END, expires_at=CASE WHEN expires_at < ? THEN excluded.expires_at ELSE expires_at END').bind(client,now+900000,now,now).run();
      return json({error:'密码错误'},401);
    }
    const token = to64(random(32)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    await db.batch([db.prepare('DELETE FROM admin_login_attempts WHERE client_hash=?').bind(client),db.prepare('INSERT INTO admin_sessions(token_hash,expires_at) VALUES (?,?)').bind(await digest(token),now+86400000)]);
    return Response.json({ok:true},{headers:{...headers,'Set-Cookie':cookie(req,token,86400)}});
  }
  if (!await authenticated(req,db)) return json({error:'请先登录'},401);
  if (path === '/api/control/session' && req.method === 'GET') return json({ok:true});
  if (path === '/api/control/visits' && req.method === 'GET') {
    const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0,10);
    const start = new Date(Date.now() + 8 * 60 * 60 * 1000 - 29 * 86400000).toISOString().slice(0,10);
    const {results} = await db.prepare('SELECT day,page_views FROM daily_page_visits WHERE day >= ? AND day <= ? ORDER BY day DESC').bind(start,day).all<{day:string;page_views:number}>();
    return json({today:day,todayViews:results.find(r=>r.day===day)?.page_views || 0,days:results});
  }
  if (path === '/api/control/rank-shops' && req.method === 'GET') {
    const q=(url.searchParams.get('q') || '').trim().slice(0,120).toLowerCase();
    const page=Math.max(1,Math.min(100000,Number.parseInt(url.searchParams.get('page') || '1',10) || 1));
    const sort=url.searchParams.get('sort') || 'manual';
    const filter=url.searchParams.get('filter') || 'all';
    const sync=url.searchParams.get('sync') || 'all';
    const stock=url.searchParams.get('stock') || 'all';
    const system=url.searchParams.get('system') || 'all';
    const order: Record<string,string> = {
      manual: 'CASE WHEN manual_rank IS NULL THEN 1 ELSE 0 END, manual_rank ASC, favorite_count DESC, CASE WHEN favorite_count=0 THEN last_synced_at END DESC, product_count DESC, id ASC',
      favorites: 'favorite_count DESC, CASE WHEN favorite_count=0 THEN last_synced_at END DESC, product_count DESC, id ASC',
      products: 'product_count DESC, favorite_count DESC, id ASC',
      'products-asc': 'product_count ASC, favorite_count DESC, id ASC',
      current: 'global_rank ASC',
      synced: 'last_synced_at IS NULL, last_synced_at DESC, id ASC',
      stale: 'last_synced_at IS NOT NULL, last_synced_at ASC, id ASC',
    };
    const rankFilters: Record<string,string> = { all:'1=1', 'manual-ranked':'manual_rank IS NOT NULL', unranked:'manual_rank IS NULL', 'has-code':"trim(submitted_integration_code)!=''", 'no-code':"trim(submitted_integration_code)=''" };
    const syncFilters: Record<string,string> = { all:'1=1', ready:"sync_state='ready'", pending:"sync_state='pending'", error:"sync_state='error'", manual:"sync_state='manual'", never:'last_synced_at IS NULL' };
    const stockFilters: Record<string,string> = { all:'1=1', 'in-stock':'product_count>0', empty:'product_count=0' };
    if (!Object.hasOwn(order,sort)) return json({error:'排序方式无效'},400);
    if (!Object.hasOwn(rankFilters,filter) || !Object.hasOwn(syncFilters,sync) || !Object.hasOwn(stockFilters,stock) || (system !== 'all' && !storeTypes.includes(system as typeof storeTypes[number]))) return json({error:'筛选条件无效'},400);
    const cfg=await settings(db), src=shopReadSource({systemType:true,description:true,createdAt:true,submittedIntegrationCode:true});
    const cte=`WITH ranked AS (SELECT shops_read.id,shops_read.shop_name,shops_read.shop_url,shops_read.product_count,shops_read.last_synced_at,shops_read.sync_state,shops_read.sync_supported,shops_read.adapter_type,shops_read.submitted_integration_code,shops_read.effective_system_type,COALESCE(r.favorite_count,0) favorite_count,r.manual_rank,
      ROW_NUMBER() OVER (ORDER BY CASE WHEN ?=1 AND r.manual_rank IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN ?=1 THEN r.manual_rank END ASC, COALESCE(r.favorite_count,0) DESC,CASE WHEN COALESCE(r.favorite_count,0)=0 THEN shops_read.last_synced_at END DESC,shops_read.product_count DESC,shops_read.id ASC) global_rank
      FROM ${src} LEFT JOIN shop_rank_settings r ON r.shop_id=shops_read.id),
      matched AS (SELECT * FROM ranked WHERE (?='' OR instr(lower(shop_name),?)>0 OR instr(lower(shop_url),?)>0 OR instr(lower(submitted_integration_code),?)>0) AND ${rankFilters[filter]} AND ${syncFilters[sync]} AND ${stockFilters[stock]} AND (?='all' OR effective_system_type=?))`;
    const params=[cfg.manual_rank_enabled,cfg.manual_rank_enabled,q,q,q,q,system,system];
    const [count, result] = await Promise.all([
      db.prepare(`${cte} SELECT COUNT(*) total FROM matched`).bind(...params).first<{total:number}>(),
      db.prepare(`${cte} SELECT * FROM matched ORDER BY ${order[sort]} LIMIT ? OFFSET ?`).bind(...params,20,(page-1)*20).all<{id:string;shop_name:string;shop_url:string;product_count:number;favorite_count:number;manual_rank:number|null;global_rank:number;last_synced_at:string|null;sync_state:string;sync_supported:number;adapter_type:string;submitted_integration_code:string;effective_system_type:string}>(),
    ]);
    const total=Number(count?.total || 0);
    return json({shops:result.results.map(s=>({id:s.id,shopName:hideTelegramContacts(s.shop_name),shopUrl:s.shop_url,productCount:s.product_count,favoriteCount:s.favorite_count,integrationCode:s.submitted_integration_code || '',manualRank:s.manual_rank,rank:s.global_rank,lastSyncedAt:s.last_synced_at,syncState:s.sync_state,syncSupported:!!s.sync_supported,adapterType:s.adapter_type,systemType:s.effective_system_type})),total,totalPages:Math.max(1,Math.ceil(total/20)),page});
  }
  if (path === '/api/control/shop-details' && req.method === 'POST') {
    let d:Record<string,unknown>; try { d=await body(req); } catch { return json({error:'请求格式错误'},400); }
    const id=typeof d.shopId==='string'?d.shopId.trim():'';
    const code=typeof d.integrationCode==='string'?d.integrationCode.trim():null;
    const count=d.favoriteCount;
    const rank=d.manualRank;
    if (rank !== undefined && rank !== null && (typeof rank!=='number' || !Number.isSafeInteger(rank) || rank<1 || rank>1000000)) return json({error:'排名无效'},400);
    if (!id || id.length>128 || code===null || code.length>128 || (code && !/^[A-Za-z0-9][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(code)) || typeof count!=='number' || !Number.isSafeInteger(count) || count<0 || count>1000000000) return json({error:'对接码或收藏数量无效'},400);
    if (!await db.prepare('SELECT id FROM shops WHERE id=?').bind(id).first()) return json({error:'店铺不存在'},404);
    const now=new Date().toISOString();
    const rankWrite = rank === undefined
      ? db.prepare('INSERT INTO shop_rank_settings(shop_id,favorite_count) VALUES (?,?) ON CONFLICT(shop_id) DO UPDATE SET favorite_count=excluded.favorite_count').bind(id,count)
      : db.prepare('INSERT INTO shop_rank_settings(shop_id,favorite_count,manual_rank) VALUES (?,?,?) ON CONFLICT(shop_id) DO UPDATE SET favorite_count=excluded.favorite_count,manual_rank=excluded.manual_rank').bind(id,count,rank);
    await db.batch([db.prepare('UPDATE shops SET submitted_integration_code=?,updated_at=? WHERE id=?').bind(code,now,id),rankWrite,db.prepare('UPDATE admin_settings SET revision=revision+1 WHERE id=1')]);
    return json({ok:true});
  }
  if (path === '/api/control/delete-shop' && req.method === 'POST') {
    let d: Record<string,unknown>; try { d=await body(req); } catch { return json({error:'请求格式错误'},400); }
    const id=typeof d.shopId==='string' ? d.shopId.trim() : '';
    if (!id || id.length>128) return json({error:'店铺 ID 无效'},400);
    const result=await deleteShopById(db,id);
    if (!result.deleted) return json({error:'店铺不存在'},404);
    await db.prepare('UPDATE admin_settings SET revision=revision+1 WHERE id=1').run();
    return json({ok:true,deleted:true});
  }
  if (path === '/api/control/sync-shops' && req.method === 'GET') {
    const {results} = await db.prepare('SELECT id,shop_name,shop_url FROM shops ORDER BY id ASC').all<{id:string;shop_name:string;shop_url:string}>();
    return json({shops:results.map(s => ({id:s.id,name:s.shop_name,url:s.shop_url}))});
  }
  if (path === '/api/control/logout' && req.method === 'POST') {
    await db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await digest(sessionCookie(req))).run();
    return Response.json({ok:true},{headers:{...headers,'Set-Cookie':cookie(req,'',0)}});
  }
  if (path === '/api/control/settings' && req.method === 'GET') {
    const s = await settings(db); const {results}=await db.prepare('SELECT system_type,url FROM open_store_urls').all<{system_type:string;url:string}>(); return json({openStoreUrls:Object.fromEntries(results.map(r=>[r.system_type,r.url])),favoritesEnabled:!!s.favorites_enabled, manualRankEnabled:!!s.manual_rank_enabled, submissionsEnabled:!!s.submissions_enabled, openStoreUrl:s.open_store_url, ingestConfigured:!!(s.ingest_hash || env.INGEST_SECRET)});
  }
  if (path === '/api/control/settings' && req.method === 'POST') {
    let d: Record<string, unknown>; try { d = await body(req); } catch { return json({error:'请求格式错误'},400); }
    if (typeof d.favoritesEnabled !== 'boolean' || typeof d.manualRankEnabled !== 'boolean' || typeof d.submissionsEnabled !== 'boolean' || typeof d.openStoreUrl !== 'string') return json({error:'参数无效'},400);
    let target: URL; try { target = new URL(d.openStoreUrl); } catch { return json({error:'开店地址无效'},400); }
    if (!['http:','https:'].includes(target.protocol) || target.username || target.password || target.href.length > 2048) return json({error:'开店地址无效'},400);
    const urls = d.openStoreUrls;
    if (urls !== undefined && (!urls || typeof urls !== 'object' || Array.isArray(urls))) return json({error:'平台开店地址无效'},400);
    const changes: D1PreparedStatement[] = [];
    if (urls !== undefined) for (const [type,value] of Object.entries(urls as Record<string,unknown>)) {
      if (!storeTypes.includes(type as typeof storeTypes[number]) || type==='ldxp' || typeof value!=='string') return json({error:'平台开店地址无效'},400);
      if (!value.trim()) { changes.push(db.prepare('DELETE FROM open_store_urls WHERE system_type=?').bind(type)); continue; }
      let parsed:URL; try { parsed=new URL(value.trim()); } catch { return json({error:'平台开店地址无效'},400); }
      if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.href.length>2048) return json({error:'平台开店地址无效'},400);
      changes.push(db.prepare('INSERT INTO open_store_urls(system_type,url) VALUES (?,?) ON CONFLICT(system_type) DO UPDATE SET url=excluded.url').bind(type,parsed.href));
    }
    await db.batch([db.prepare('UPDATE admin_settings SET favorites_enabled=?,manual_rank_enabled=?,submissions_enabled=?,open_store_url=?,revision=revision+1 WHERE id=1').bind(+d.favoritesEnabled,+d.manualRankEnabled,+d.submissionsEnabled,target.href),...changes]);
    return json({ok:true});
  }
  if (path === '/api/control/password' && req.method === 'POST') {
    let d: Record<string,unknown>; try { d = await body(req); } catch { return json({error:'请求格式错误'},400); }
    const s = await settings(db), old = String(d.oldPassword || ''), next = String(d.newPassword || '');
    if (!same(await passwordHash(old,s.password_salt),s.password_hash)) return json({error:'原密码错误'},400);
    if (next.length < 12 || next.length > 256) return json({error:'新密码须为 12–256 位'},400);
    const salt = to64(random(16)), hash = await passwordHash(next,salt);
    await db.batch([db.prepare('UPDATE admin_settings SET password_salt=?,password_hash=? WHERE id=1').bind(salt,hash),db.prepare('DELETE FROM admin_sessions')]);
    return json({ok:true});
  }
  if (path === '/api/control/ingest-secret' && req.method === 'POST') {
    let d: Record<string,unknown>; try { d = await body(req); } catch { return json({error:'请求格式错误'},400); }
    const secret = String(d.secret || ''); if (secret.length < 24 || secret.length > 256) return json({error:'密钥须为 24–256 位'},400);
    await db.prepare('UPDATE admin_settings SET ingest_hash=? WHERE id=1').bind(await digest(secret)).run(); return json({ok:true});
  }
  if (path === '/api/control/rank' && req.method === 'POST') {
    let d: Record<string,unknown>; try { d = await body(req); } catch { return json({error:'请求格式错误'},400); }
    const shopId = String(d.shopId || ''), rank = d.rank;
    if (!shopId || !(rank === null || (typeof rank === 'number' && Number.isInteger(rank) && rank >= 1 && rank <= 1000000))) return json({error:'排名无效'},400);
    if (!await db.prepare('SELECT id FROM shops WHERE id=?').bind(shopId).first()) return json({error:'店铺不存在'},404);
    await db.batch([db.prepare('INSERT INTO shop_rank_settings(shop_id,manual_rank) VALUES (?,?) ON CONFLICT(shop_id) DO UPDATE SET manual_rank=excluded.manual_rank').bind(shopId,rank), db.prepare('UPDATE admin_settings SET revision=revision+1 WHERE id=1')]);
    return json({ok:true});
  }
  return json({error:'接口不存在'},404);
}
