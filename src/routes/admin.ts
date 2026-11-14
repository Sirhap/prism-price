/** Administrative controls and anonymous shop favorite counts. */
import { deleteShopById } from '../collector/scheduler';
import { hideTelegramContacts } from '../collector/shopPresentation';
import { getShopColumnCapabilities, SHOP_SYSTEMS, shopReadSource } from '../collector/shopSystems';
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

const COUNTRY_NAMES: Record<string, string> = {
  CN: '中国', HK: '中国香港', MO: '中国澳门', TW: '中国台湾',
  US: '美国', JP: '日本', SG: '新加坡', KR: '韩国',
  GB: '英国', DE: '德国', FR: '法国', CA: '加拿大',
  AU: '澳大利亚', NL: '荷兰', RU: '俄罗斯', IN: '印度',
  MY: '马来西亚', TH: '泰国', VN: '越南', PH: '菲律宾',
  ID: '印度尼西亚', BR: '巴西', IT: '意大利', ES: '西班牙',
  SE: '瑞典', CH: '瑞士', AE: '阿联酋', T1: 'Tor 网络', XX: '未知地区',
};

const regionDisplay = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['zh-Hans'], { type: 'region' })
  : null;

export interface VisitorGeo {
  country: string;
  region: string;
  city: string;
  location: string;
}

const IP_GEO_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const IP_GEO_CACHE_MAX = 512;
const ipGeoCache = new Map<string, { value: VisitorGeo; expiresAt: number }>();

/** 将国家/地区码或原始名称解析为规范中文国家名。 */
function resolveCountryLabel(rawCountry: string): string {
  const clean = rawCountry.trim();
  if (!clean) return '';
  const upper = clean.toUpperCase();
  if (upper === 'XX' || upper === 'UNKNOWN') return '';
  if (COUNTRY_NAMES[upper]) return COUNTRY_NAMES[upper];
  if (/^[A-Z]{2}$/.test(upper) && regionDisplay) {
    try {
      const translated = regionDisplay.of(upper);
      if (translated && translated.toUpperCase() !== upper) return translated;
    } catch {
      // 忽略非常规两位字母代码错误
    }
  }
  return clean;
}

/** 按代理可信优先级提取客户端 IP。 */
function extractClientIp(req: Request): string {
  const candidates = [
    req.headers.get('CF-Connecting-IP'),
    req.headers.get('True-Client-IP'),
    req.headers.get('X-Real-IP'),
    req.headers.get('X-Forwarded-For')?.split(',')[0],
  ];
  for (const raw of candidates) {
    const trimmed = (raw || '').trim();
    if (!trimmed) continue;
    const stripped = trimmed.startsWith('[') && trimmed.includes(']')
      ? trimmed.slice(1, trimmed.indexOf(']'))
      : /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(trimmed)
        ? trimmed.replace(/:\d+$/, '')
        : trimmed;
    if (stripped) return stripped.slice(0, 64);
  }
  return 'unknown';
}

function isLocalOrPrivateIp(ip: string): boolean {
  if (!ip || ip === 'unknown') return false;
  const normalized = ip.replace(/^::ffff:/i, '').toLowerCase();
  if (normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost') return true;
  if (normalized.startsWith('10.') || normalized.startsWith('192.168.') || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) return true;
  const match = /^172\.(\d+)\./.exec(normalized);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/** 识别文档/测试保留段与链路本地地址，避免对外发起无效查询。 */
function isNonPublicLookupIp(ip: string): boolean {
  if (!ip || ip === 'unknown' || isLocalOrPrivateIp(ip)) return true;
  const normalized = ip.replace(/^::ffff:/i, '').toLowerCase();
  if (
    normalized.startsWith('169.254.') ||
    normalized.startsWith('192.0.2.') ||
    normalized.startsWith('198.51.100.') ||
    normalized.startsWith('203.0.113.') ||
    normalized.startsWith('0.')
  ) {
    return true;
  }
  const cgnat = /^100\.(\d+)\./.exec(normalized);
  if (cgnat) {
    const second = Number(cgnat[1]);
    if (second >= 64 && second <= 127) return true;
  }
  return false;
}

/** 识别 Miniflare/workerd 本地运行时注入的默认模拟 cf 对象。 */
function isMiniflareMockCf(cf: Record<string, unknown> | undefined, headerCountry: string): boolean {
  if (!cf) return false;
  const cfCountry = String(cf.country || '').trim().toUpperCase();
  const cleanHeaderCountry = headerCountry.trim().toUpperCase();
  if (cleanHeaderCountry && cleanHeaderCountry !== 'XX' && cfCountry && cleanHeaderCountry !== cfCountry) {
    return true;
  }
  return cfCountry === 'US'
    && String(cf.region || '') === 'Texas'
    && String(cf.city || '') === 'Austin'
    && (String(cf.postalCode || '') === '78701' || String(cf.colo || '') === 'DFW');
}

function normalizeGeoPlaceKey(name: string): string {
  return name.trim().replace(/(省|市|自治区|特别行政区|地区)$/u, '').toLowerCase();
}

function buildVisitorGeo(rawCountry: string, rawRegion: string, rawCity: string, ip: string): VisitorGeo {
  const countryLabel = resolveCountryLabel(rawCountry);
  const region = rawRegion.trim().slice(0, 64);
  const city = rawCity.trim().slice(0, 64);

  const parts: string[] = [];
  const seenKeys = new Set<string>();
  for (const seg of [countryLabel, region, city]) {
    const clean = seg.trim();
    if (!clean) continue;
    const key = normalizeGeoPlaceKey(clean);
    if (seenKeys.has(clean) || (key && seenKeys.has(key))) continue;
    seenKeys.add(clean);
    if (key) seenKeys.add(key);
    parts.push(clean);
  }
  if (parts.length > 0) {
    return { country: countryLabel || rawCountry.trim().toUpperCase(), region, city, location: parts.join(' · ') };
  }
  if (isLocalOrPrivateIp(ip)) {
    return { country: 'LOCAL', region: '', city: '', location: '本地 / 内网' };
  }
  return { country: '', region: '', city: '', location: '未知地区' };
}

/** 优先从可信代理请求头提取地区；仅在非 Miniflare 模拟环境下补充 request.cf。 */
function extractVisitorGeo(req: Request, ip: string): VisitorGeo {
  const cf = (req as Request & { cf?: Record<string, unknown> }).cf;
  const headerCountry = String(
    req.headers.get('CF-IPCountry') ||
    req.headers.get('X-Vercel-IP-Country') ||
    req.headers.get('X-Geo-Country') ||
    ''
  ).trim().slice(0, 64);
  const headerRegion = String(
    req.headers.get('CF-Region') ||
    req.headers.get('X-Vercel-IP-Country-Region') ||
    req.headers.get('X-Geo-Region') ||
    ''
  ).trim().slice(0, 64);
  const headerCity = String(
    req.headers.get('CF-IPCity') ||
    req.headers.get('X-Vercel-IP-City') ||
    req.headers.get('X-Geo-City') ||
    ''
  ).trim().slice(0, 64);

  const allowCf = !isMiniflareMockCf(cf, headerCountry);
  const rawCountry = headerCountry || (allowCf ? String(cf?.country || '').trim().slice(0, 64) : '');
  const rawRegion = headerRegion || (allowCf ? String(cf?.region || '').trim().slice(0, 64) : '');
  const rawCity = headerCity || (allowCf ? String(cf?.city || '').trim().slice(0, 64) : '');

  return buildVisitorGeo(rawCountry, rawRegion, rawCity, ip);
}

/** 查询公网 IP 所属国家、省州与城市，支持短超时多源降级与内存缓存。 */
async function lookupPublicIpGeo(ip: string, fetchImpl: typeof fetch = fetch): Promise<VisitorGeo | null> {
  const now = Date.now();
  const cached = ipGeoCache.get(ip);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let resolved: VisitorGeo | null = null;
  try {
    const res = await fetchImpl(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN&fields=status,country,countryCode,regionName,city`,
      { signal: AbortSignal.timeout(1200) },
    );
    if (res.ok) {
      const payload = await res.json() as { status?: string; country?: string; countryCode?: string; regionName?: string; city?: string };
      if (payload.status === 'success') {
        const candidate = buildVisitorGeo(
          payload.countryCode || payload.country || '',
          payload.regionName || '',
          payload.city || '',
          ip,
        );
        if (candidate.location && candidate.location !== '未知地区') resolved = candidate;
      }
    }
  } catch {
    // 主归属地接口超时或异常时平滑降级到备选源
  }

  if (!resolved) {
    try {
      const res = await fetchImpl(
        `https://ipwho.is/${encodeURIComponent(ip)}?lang=zh-CN`,
        { signal: AbortSignal.timeout(1200) },
      );
      if (res.ok) {
        const payload = await res.json() as { success?: boolean; country?: string; country_code?: string; region?: string; city?: string };
        if (payload.success) {
          const candidate = buildVisitorGeo(
            payload.country_code || payload.country || '',
            payload.region || '',
            payload.city || '',
            ip,
          );
          if (candidate.location && candidate.location !== '未知地区') resolved = candidate;
        }
      }
    } catch {
      // 备选接口失败时忽略，退回代理头提取的国家信息
    }
  }

  if (resolved) {
    if (ipGeoCache.size >= IP_GEO_CACHE_MAX) {
      const oldestKey = ipGeoCache.keys().next().value;
      if (oldestKey) ipGeoCache.delete(oldestKey);
    }
    ipGeoCache.set(ip, { value: resolved, expiresAt: now + IP_GEO_CACHE_TTL_MS });
  }
  return resolved;
}

/** 结合可信代理头与公网 IP 实时归属地补全访客地区。 */
export async function resolveVisitorGeo(req: Request, ip: string, fetchImpl: typeof fetch = fetch): Promise<VisitorGeo> {
  const base = extractVisitorGeo(req, ip);
  if (base.region || base.city || isNonPublicLookupIp(ip)) {
    return base;
  }
  const lookedUp = await lookupPublicIpGeo(ip, fetchImpl);
  if (!lookedUp) return base;
  if (!lookedUp.country && base.country) {
    return buildVisitorGeo(base.country, lookedUp.region, lookedUp.city, ip);
  }
  return lookedUp;
}


/** 从 User-Agent 及 Client Hints 识别设备形态、操作系统与浏览器。 */
function parseVisitorDevice(req: Request): { device: string; os: string; browser: string; userAgent: string } {
  const ua = (req.headers.get('User-Agent') || '').trim().slice(0, 300);
  const chMobile = req.headers.get('Sec-CH-UA-Mobile') === '?1';
  const isBot = /bot|spider|crawl|slurp|curl|wget|python-requests|go-http-client|headless|lighthouse/i.test(ua);

  let os = '未知系统';
  if (/HarmonyOS/i.test(ua)) os = 'HarmonyOS';
  else if (/iPad/i.test(ua)) os = 'iPadOS';
  else if (/iPhone|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux|X11/i.test(ua)) os = 'Linux';
  else if (isBot) os = '脚本/爬虫';

  let device = '桌面端';
  if (isBot) device = '爬虫/脚本';
  else if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) device = '平板';
  else if (chMobile || /Mobile|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) device = '手机';
  else if (!ua) device = '未知设备';

  let browser = '其它客户端';
  if (/MicroMessenger/i.test(ua)) browser = '微信';
  else if (/QQBrowser|MQQBrowser/i.test(ua)) browser = 'QQ 浏览器';
  else if (/EdgA|EdgiOS|Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome|Chromium|CriOS|Edg/i.test(ua)) browser = 'Safari';
  else if (/curl\//i.test(ua)) browser = 'curl';
  else if (isBot) browser = 'Bot';

  return { device, os, browser, userAgent: ua };
}

type VisitLogRow = { id: number; day: string; ip: string; location: string; device: string; os: string; browser: string; visited_at: string };
type VisitBreakdownItem = { label: string; count: number };

function summarizeVisitDays(visitDays: Array<{ day: string; page_views: number }>, bjNowMs: number) {
  const today = new Date(bjNowMs).toISOString().slice(0, 10);
  const yesterday = new Date(bjNowMs - 86400000).toISOString().slice(0, 10);
  const start7 = new Date(bjNowMs - 6 * 86400000).toISOString().slice(0, 10);
  const todayViews = Number(visitDays.find(r => r.day === today)?.page_views || 0);
  const yesterdayViews = Number(visitDays.find(r => r.day === yesterday)?.page_views || 0);
  const last7DaysViews = visitDays.filter(r => r.day >= start7).reduce((sum, r) => sum + Number(r.page_views || 0), 0);
  const last30DaysViews = visitDays.reduce((sum, r) => sum + Number(r.page_views || 0), 0);
  let peakDay: { day: string; pageViews: number } | null = null;
  for (const row of visitDays) {
    const pv = Number(row.page_views || 0);
    if (!peakDay || pv > peakDay.pageViews) peakDay = { day: row.day, pageViews: pv };
  }
  return {
    today,
    todayViews,
    yesterdayViews,
    last7DaysViews,
    last30DaysViews,
    activeDays30: visitDays.length,
    avgDailyViews: visitDays.length > 0 ? Math.round((last30DaysViews / visitDays.length) * 10) / 10 : 0,
    peakDay,
    days: visitDays.map(r => ({ day: r.day, pageViews: Number(r.page_views || 0) })),
  };
}

async function readRecentVisitLogs(db: D1Database, limit = 30): Promise<VisitLogRow[]> {
  try {
    const { results } = await db.prepare('SELECT id,day,ip,location,device,os,browser,visited_at FROM visit_logs ORDER BY id DESC LIMIT ?')
      .bind(limit).all<VisitLogRow>();
    return results || [];
  } catch (err) {
    if (err instanceof Error && err.message.includes('no such table')) return [];
    throw err;
  }
}

async function readVisitInsights(db: D1Database, sinceDay: string, logLimit = 50): Promise<{
  recentLogs: VisitLogRow[];
  sampleTotal: number;
  geoBreakdown: VisitBreakdownItem[];
  deviceBreakdown: VisitBreakdownItem[];
  browserBreakdown: VisitBreakdownItem[];
}> {
  try {
    const [recentLogs, totalRow, geoRes, devRes, browserRes] = await Promise.all([
      readRecentVisitLogs(db, logLimit),
      db.prepare('SELECT COUNT(*) AS cnt FROM visit_logs WHERE day >= ?').bind(sinceDay).first<{ cnt: number }>(),
      db.prepare("SELECT COALESCE(NULLIF(trim(location), ''), '未知地区') AS label, COUNT(*) AS count FROM visit_logs WHERE day >= ? GROUP BY label ORDER BY count DESC, label ASC LIMIT 8").bind(sinceDay).all<VisitBreakdownItem>(),
      db.prepare("SELECT COALESCE(NULLIF(trim(device), ''), '未知设备') AS label, COUNT(*) AS count FROM visit_logs WHERE day >= ? GROUP BY label ORDER BY count DESC, label ASC LIMIT 6").bind(sinceDay).all<VisitBreakdownItem>(),
      db.prepare("SELECT COALESCE(NULLIF(trim(browser), ''), '其它客户端') AS label, COUNT(*) AS count FROM visit_logs WHERE day >= ? GROUP BY label ORDER BY count DESC, label ASC LIMIT 6").bind(sinceDay).all<VisitBreakdownItem>(),
    ]);
    return {
      recentLogs,
      sampleTotal: Number(totalRow?.cnt || 0),
      geoBreakdown: (geoRes.results || []).map(r => ({ label: r.label, count: Number(r.count || 0) })),
      deviceBreakdown: (devRes.results || []).map(r => ({ label: r.label, count: Number(r.count || 0) })),
      browserBreakdown: (browserRes.results || []).map(r => ({ label: r.label, count: Number(r.count || 0) })),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('no such table')) {
      return { recentLogs: [], sampleTotal: 0, geoBreakdown: [], deviceBreakdown: [], browserBreakdown: [] };
    }
    throw err;
  }
}

async function readRecentSyncRuns(db: D1Database, limit = 10) {
  const { results } = await db.prepare(
    'SELECT id,trigger_source,processed_count,skipped_unchanged,updated_count,failed_count,estimated_d1_writes,created_at FROM sync_runs ORDER BY created_at DESC LIMIT ?',
  ).bind(limit).all<{
    id: string;
    trigger_source: string;
    processed_count: number;
    skipped_unchanged: number;
    updated_count: number;
    failed_count: number;
    estimated_d1_writes: number;
    created_at: string;
  }>();
  return (results || []).map(row => ({
    id: row.id,
    triggerSource: row.trigger_source,
    processedCount: Number(row.processed_count || 0),
    skippedUnchanged: Number(row.skipped_unchanged || 0),
    updatedCount: Number(row.updated_count || 0),
    failedCount: Number(row.failed_count || 0),
    estimatedD1Writes: Number(row.estimated_d1_writes || 0),
    createdAt: row.created_at,
  }));
}

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
    const nowIso = new Date().toISOString();
    const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0,10);
    const ip = extractClientIp(req);
    const geo = await resolveVisitorGeo(req, ip);
    const dev = parseVisitorDevice(req);
    const writeDaily = db.prepare('INSERT INTO daily_page_visits(day,page_views) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET page_views=page_views+1').bind(day);
    const writeLog = db.prepare('INSERT INTO visit_logs(day,ip,country,region,city,location,device,os,browser,user_agent,visited_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(day, ip, geo.country, geo.region, geo.city, geo.location, dev.device, dev.os, dev.browser, dev.userAgent, nowIso);
    try {
      await db.batch([writeDaily, writeLog]);
    } catch (err) {
      if (err instanceof Error && err.message.includes('no such table')) {
        await writeDaily.run();
      } else {
        throw err;
      }
    }
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
    const bjNow = Date.now() + 8 * 60 * 60 * 1000;
    const day = new Date(bjNow).toISOString().slice(0, 10);
    const start = new Date(bjNow - 29 * 86400000).toISOString().slice(0, 10);
    const [{ results }, insights] = await Promise.all([
      db.prepare('SELECT day,page_views FROM daily_page_visits WHERE day >= ? AND day <= ? ORDER BY day DESC')
        .bind(start, day).all<{ day: string; page_views: number }>(),
      readVisitInsights(db, start, 50),
    ]);
    const summary = summarizeVisitDays(results || [], bjNow);
    return json({
      ...summary,
      days: (results || []).map(r => ({ day: r.day, page_views: Number(r.page_views || 0), pageViews: Number(r.page_views || 0) })),
      sampleTotal: insights.sampleTotal,
      geoBreakdown: insights.geoBreakdown,
      deviceBreakdown: insights.deviceBreakdown,
      browserBreakdown: insights.browserBreakdown,
      recentLogs: insights.recentLogs.map(r => ({
        id: r.id, day: r.day, ip: r.ip, location: r.location,
        device: r.device, os: r.os, browser: r.browser, visitedAt: r.visited_at,
      })),
    });
  }
  if (path === '/api/control/catalog' && req.method === 'GET') {
    const caps = await getShopColumnCapabilities(db);
    const src = shopReadSource(caps);
    const [shopCountRow, systemRes, catalogSummary, brandRes] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS total FROM ${src}`).first<{ total: number }>(),
      db.prepare(`SELECT
        effective_system_type AS system_type,
        COUNT(*) AS shop_count,
        COALESCE(SUM(CASE WHEN product_count > 0 THEN 1 ELSE 0 END), 0) AS in_stock_count,
        COALESCE(SUM(product_count), 0) AS product_count
        FROM ${src} GROUP BY effective_system_type ORDER BY shop_count DESC`).all<{ system_type: string; shop_count: number; in_stock_count: number; product_count: number }>(),
      db.prepare(`SELECT
        COUNT(*) AS group_count,
        COALESCE(SUM(offer_count), 0) AS offer_count,
        COALESCE(SUM(CASE WHEN stock_status = 'low' THEN 1 ELSE 0 END), 0) AS low_stock_groups,
        MIN(min_price) AS min_price,
        AVG(min_price) AS avg_min_price
        FROM product_groups`).first<{ group_count: number; offer_count: number; low_stock_groups: number; min_price: number | null; avg_min_price: number | null }>(),
      db.prepare(`SELECT
        brand_group AS brand,
        COUNT(*) AS group_count,
        COALESCE(SUM(offer_count), 0) AS offer_count,
        MIN(min_price) AS min_price
        FROM product_groups GROUP BY brand_group ORDER BY offer_count DESC, group_count DESC LIMIT 15`).all<{ brand: string; group_count: number; offer_count: number; min_price: number | null }>(),
    ]);
    return json({
      totalShops: Number(shopCountRow?.total || 0),
      systems: (systemRes.results || []).map(row => ({
        systemType: row.system_type || 'unknown',
        label: SHOP_SYSTEMS[(row.system_type || 'unknown') as keyof typeof SHOP_SYSTEMS] || row.system_type || '未知',
        shopCount: Number(row.shop_count || 0),
        inStockCount: Number(row.in_stock_count || 0),
        productCount: Number(row.product_count || 0),
      })),
      catalog: {
        groupCount: Number(catalogSummary?.group_count || 0),
        offerCount: Number(catalogSummary?.offer_count || 0),
        lowStockGroups: Number(catalogSummary?.low_stock_groups || 0),
        minPrice: catalogSummary?.min_price ?? null,
        avgMinPrice: catalogSummary?.avg_min_price != null ? Math.round(Number(catalogSummary.avg_min_price) * 100) / 100 : null,
        brands: (brandRes.results || []).map(row => ({
          brand: row.brand || '其它',
          groupCount: Number(row.group_count || 0),
          offerCount: Number(row.offer_count || 0),
          minPrice: row.min_price ?? null,
        })),
      },
    });
  }
  if (path === '/api/control/sync-runs' && req.method === 'GET') {
    const recentSyncs = await readRecentSyncRuns(db, 10);
    return json({ recentSyncs });
  }
  if (path === '/api/control/overview' && req.method === 'GET') {
    const lite = url.searchParams.get('lite') === '1';
    const nowMs = Date.now();
    const bjNow = nowMs + 8 * 60 * 60 * 1000;
    const today = new Date(bjNow).toISOString().slice(0, 10);
    const start30 = new Date(bjNow - 29 * 86400000).toISOString().slice(0, 10);
    const since24h = new Date(nowMs - 86400000).toISOString();
    const since7d = new Date(nowMs - 7 * 86400000).toISOString();
    const caps = await getShopColumnCapabilities(db);
    const src = shopReadSource(caps);

    const [visitRes, shopSummary, catalogSummary, rankSummary, openUrlRow, cfg, extra] = await Promise.all([
      db.prepare('SELECT day,page_views FROM daily_page_visits WHERE day >= ? AND day <= ? ORDER BY day DESC')
        .bind(start30, today).all<{ day: string; page_views: number }>(),
      db.prepare(`SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN product_count > 0 THEN 1 ELSE 0 END), 0) AS in_stock,
        COALESCE(SUM(CASE WHEN product_count = 0 THEN 1 ELSE 0 END), 0) AS empty,
        COALESCE(SUM(CASE WHEN sync_supported = 1 THEN 1 ELSE 0 END), 0) AS sync_supported,
        COALESCE(SUM(CASE WHEN sync_state = 'ready' THEN 1 ELSE 0 END), 0) AS ready,
        COALESCE(SUM(CASE WHEN sync_state = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN sync_state = 'error' THEN 1 ELSE 0 END), 0) AS error,
        COALESCE(SUM(CASE WHEN sync_state = 'manual' THEN 1 ELSE 0 END), 0) AS manual,
        COALESCE(SUM(CASE WHEN last_synced_at IS NULL THEN 1 ELSE 0 END), 0) AS never_synced,
        COALESCE(SUM(CASE WHEN last_synced_at >= ? THEN 1 ELSE 0 END), 0) AS synced_24h,
        COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS added_7d,
        COALESCE(SUM(CASE WHEN trim(submitted_integration_code) != '' THEN 1 ELSE 0 END), 0) AS with_code,
        COALESCE(SUM(product_count), 0) AS total_shop_products
        FROM ${src}`).bind(since24h, since7d).first<Record<string, number>>(),
      db.prepare(`SELECT
        COUNT(*) AS group_count,
        COALESCE(SUM(offer_count), 0) AS offer_count,
        COALESCE(SUM(CASE WHEN stock_status = 'low' THEN 1 ELSE 0 END), 0) AS low_stock_groups,
        MIN(min_price) AS min_price,
        AVG(min_price) AS avg_min_price
        FROM product_groups`).first<{ group_count: number; offer_count: number; low_stock_groups: number; min_price: number | null; avg_min_price: number | null }>(),
      db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN manual_rank IS NOT NULL THEN 1 ELSE 0 END), 0) AS manual_ranked_count,
        COALESCE(SUM(favorite_count), 0) AS total_favorites,
        COALESCE(SUM(CASE WHEN favorite_count > 0 THEN 1 ELSE 0 END), 0) AS favorited_shop_count
        FROM shop_rank_settings`).first<{ manual_ranked_count: number; total_favorites: number; favorited_shop_count: number }>(),
      db.prepare('SELECT COUNT(*) AS cnt FROM open_store_urls').first<{ cnt: number }>(),
      settings(db),
      lite ? Promise.resolve(null) : Promise.all([
        readRecentVisitLogs(db, 30),
        db.prepare(`SELECT
          effective_system_type AS system_type,
          COUNT(*) AS shop_count,
          COALESCE(SUM(CASE WHEN product_count > 0 THEN 1 ELSE 0 END), 0) AS in_stock_count,
          COALESCE(SUM(product_count), 0) AS product_count
          FROM ${src} GROUP BY effective_system_type ORDER BY shop_count DESC`).all<{ system_type: string; shop_count: number; in_stock_count: number; product_count: number }>(),
        db.prepare(`SELECT
          brand_group AS brand,
          COUNT(*) AS group_count,
          COALESCE(SUM(offer_count), 0) AS offer_count,
          MIN(min_price) AS min_price
          FROM product_groups GROUP BY brand_group ORDER BY offer_count DESC, group_count DESC LIMIT 8`).all<{ brand: string; group_count: number; offer_count: number; min_price: number | null }>(),
        readRecentSyncRuns(db, 5),
      ]),
    ]);

    const visitSummary = summarizeVisitDays(visitRes.results || [], bjNow);
    const s = shopSummary || {};
    const totalShops = Number(s.total || 0);
    const readyShops = Number(s.ready || 0);
    const recentLogs = extra ? extra[0] : [];
    const systemRes = extra ? extra[1] : null;
    const brandRes = extra ? extra[2] : null;
    const recentSyncs = extra ? extra[3] : [];

    return json({
      visits: {
        ...visitSummary,
        recentLogs: recentLogs.map(r => ({
          id: r.id,
          day: r.day,
          ip: r.ip,
          location: r.location,
          device: r.device,
          os: r.os,
          browser: r.browser,
          visitedAt: r.visited_at,
        })),
      },
      shops: {
        total: totalShops,
        inStock: Number(s.in_stock || 0),
        empty: Number(s.empty || 0),
        syncSupported: Number(s.sync_supported || 0),
        ready: readyShops,
        pending: Number(s.pending || 0),
        error: Number(s.error || 0),
        manual: Number(s.manual || 0),
        neverSynced: Number(s.never_synced || 0),
        synced24h: Number(s.synced_24h || 0),
        added7d: Number(s.added_7d || 0),
        withCode: Number(s.with_code || 0),
        totalShopProducts: Number(s.total_shop_products || 0),
        healthRate: totalShops > 0 ? Math.round((readyShops / totalShops) * 1000) / 10 : 0,
      },
      systems: (systemRes?.results || []).map(row => ({
        systemType: row.system_type || 'unknown',
        label: SHOP_SYSTEMS[(row.system_type || 'unknown') as keyof typeof SHOP_SYSTEMS] || row.system_type || '未知',
        shopCount: Number(row.shop_count || 0),
        inStockCount: Number(row.in_stock_count || 0),
        productCount: Number(row.product_count || 0),
      })),
      catalog: {
        groupCount: Number(catalogSummary?.group_count || 0),
        offerCount: Number(catalogSummary?.offer_count || 0),
        lowStockGroups: Number(catalogSummary?.low_stock_groups || 0),
        minPrice: catalogSummary?.min_price ?? null,
        avgMinPrice: catalogSummary?.avg_min_price != null ? Math.round(Number(catalogSummary.avg_min_price) * 100) / 100 : null,
        brands: (brandRes?.results || []).map(row => ({
          brand: row.brand || '其它',
          groupCount: Number(row.group_count || 0),
          offerCount: Number(row.offer_count || 0),
          minPrice: row.min_price ?? null,
        })),
      },
      operations: {
        manualRankedCount: Number(rankSummary?.manual_ranked_count || 0),
        totalFavorites: Number(rankSummary?.total_favorites || 0),
        favoritedShopCount: Number(rankSummary?.favorited_shop_count || 0),
        openStoreUrlCount: Number(openUrlRow?.cnt || 0),
        favoritesEnabled: !!cfg.favorites_enabled,
        manualRankEnabled: !!cfg.manual_rank_enabled,
        submissionsEnabled: !!cfg.submissions_enabled,
        ingestConfigured: !!(cfg.ingest_hash || env.INGEST_SECRET),
      },
      recentSyncs,
    });
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
