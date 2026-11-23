/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF, type D1Migration } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const origin = 'http://localhost';
const testPassword = 'only-for-isolated-visit-test';

/**
 * 计算相对于当前北京时间的日期字符串（YYYY-MM-DD）。
 * @param offsetDays 向前偏移的天数，0 表示今天，1 表示昨天。
 */
function getBeijingDay(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3600_000 - offsetDays * 86400_000).toISOString().slice(0, 10);
}

describe('流量访客 IP 去重统计', () => {
  let cookie = '';

  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    const salt = new Uint8Array(16).fill(41);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(testPassword), 'PBKDF2', false, ['deriveBits']);
    const hash = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 }, key, 256));
    await env.DB.prepare('UPDATE admin_settings SET password_salt=?, password_hash=? WHERE id=1')
      .bind(btoa(String.fromCharCode(...salt)), btoa(String.fromCharCode(...hash)))
      .run();

    const loginRes = await SELF.fetch(`${origin}/api/control/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ password: testPassword }),
    });
    expect(loginRes.status).toBe(200);
    cookie = loginRes.headers.get('set-cookie')!.split(';')[0];
  });

  it('按有效 IP 去重统计实际访客人数，排除空值与 unknown 且跨天窗口不重复累加', async () => {
    const today = getBeijingDay(0);
    const yesterday = getBeijingDay(1);
    const tenDaysAgo = getBeijingDay(10);

    // 插入历史访客记录：昨日包含 1 个跨天重复 IP 和 1 个纯空白 IP；10 天前包含 1 个新 IP
    await env.DB.prepare('INSERT INTO daily_page_visits (day, page_views) VALUES (?, ?), (?, ?)')
      .bind(yesterday, 2, tenDaysAgo, 1)
      .run();

    await env.DB.prepare(
      'INSERT INTO visit_logs (day, ip, country, region, city, location, device, os, browser, user_agent, visited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        yesterday, '203.0.113.8', 'CN', 'Beijing', 'Beijing', '中国 · Beijing', '手机', 'iOS', 'Safari', 'Mozilla/5.0', `${yesterday} 10:00:00`,
        yesterday, '   ', '', '', '', '未知', '桌面端', 'Windows', 'Chrome', 'Mozilla/5.0', `${yesterday} 11:00:00`,
        tenDaysAgo, '198.51.100.7', 'JP', 'Tokyo', 'Tokyo', '日本 · Tokyo', '桌面端', 'Windows', 'Firefox', 'Mozilla/5.0', `${tenDaysAgo} 09:00:00`,
      )
      .run();

    const visitHeaders = { 'content-type': 'application/json', origin };
    const iphoneUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const macChromeUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    const winEdgeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';

    // 今日同一公网 IP 连续访问 2 次
    expect((await SELF.fetch(`${origin}/api/visit`, {
      method: 'POST',
      headers: { ...visitHeaders, 'CF-Connecting-IP': '203.0.113.8', 'CF-IPCountry': 'CN', 'CF-IPCity': 'Beijing', 'User-Agent': iphoneUa },
      body: '{}',
    })).status).toBe(204);
    expect((await SELF.fetch(`${origin}/api/visit`, {
      method: 'POST',
      headers: { ...visitHeaders, 'CF-Connecting-IP': '203.0.113.8', 'CF-IPCountry': 'CN', 'CF-IPCity': 'Beijing', 'User-Agent': iphoneUa },
      body: '{}',
    })).status).toBe(204);

    // 今日另一独立 IP 访问 1 次
    expect((await SELF.fetch(`${origin}/api/visit`, {
      method: 'POST',
      headers: { ...visitHeaders, 'X-Real-IP': '127.0.0.1', 'User-Agent': macChromeUa },
      body: '{}',
    })).status).toBe(204);

    // 今日缺失 IP（记录为 unknown），计入访问次数但不计入独立访客人数
    expect((await SELF.fetch(`${origin}/api/visit`, {
      method: 'POST',
      headers: { ...visitHeaders, 'User-Agent': winEdgeUa },
      body: '{}',
    })).status).toBe(204);

    const visits = await (await SELF.fetch(`${origin}/api/control/visits`, { headers: { cookie } })).json() as {
      today: string;
      todayViews: number;
      todayVisitors: number;
      yesterdayViews: number;
      yesterdayVisitors: number;
      last7DaysViews: number;
      last7DaysVisitors: number;
      last30DaysViews: number;
      last30DaysVisitors: number;
      avgDailyViews: number;
      avgDailyVisitors: number;
      uniqueIpCount: number;
      days: Array<{ day: string; page_views: number; unique_visitors: number; uniqueVisitors: number }>;
      geoBreakdown: Array<{ label: string; count: number; uniqueVisitors: number }>;
      deviceBreakdown: Array<{ label: string; count: number; uniqueVisitors: number }>;
      browserBreakdown: Array<{ label: string; count: number; uniqueVisitors: number }>;
    };

    expect(visits.today).toBe(today);
    expect(visits.todayViews).toBe(4);
    expect(visits.todayVisitors).toBe(2);
    expect(visits.yesterdayViews).toBe(2);
    expect(visits.yesterdayVisitors).toBe(1);
    expect(visits.last7DaysViews).toBe(6);
    expect(visits.last7DaysVisitors).toBe(2);
    expect(visits.last30DaysViews).toBe(7);
    expect(visits.last30DaysVisitors).toBe(3);
    expect(visits.uniqueIpCount).toBe(3);
    expect(visits.avgDailyVisitors).toBeGreaterThanOrEqual(1);

    const todayRow = visits.days.find((d) => d.day === today);
    const yesterdayRow = visits.days.find((d) => d.day === yesterday);
    const tenDaysAgoRow = visits.days.find((d) => d.day === tenDaysAgo);
    expect(todayRow).toMatchObject({ day: today, page_views: 4, unique_visitors: 2, uniqueVisitors: 2 });
    expect(yesterdayRow).toMatchObject({ day: yesterday, page_views: 2, unique_visitors: 1, uniqueVisitors: 1 });
    expect(tenDaysAgoRow).toMatchObject({ day: tenDaysAgo, page_views: 1, unique_visitors: 1, uniqueVisitors: 1 });

    // 分组统计同样按有效 IP 去重，且保留访问次数 count
    const bjGeo = visits.geoBreakdown.find((item) => item.label === '中国 · Beijing');
    expect(bjGeo).toMatchObject({ count: 3, uniqueVisitors: 1 });
    const mobileDevice = visits.deviceBreakdown.find((item) => item.label === '手机');
    expect(mobileDevice).toMatchObject({ count: 3, uniqueVisitors: 1 });
    const edgeBrowser = visits.browserBreakdown.find((item) => item.label === 'Edge');
    expect(edgeBrowser).toMatchObject({ count: 1, uniqueVisitors: 0 });

    const loadRange = async (query: string) => {
      const response = await SELF.fetch(`${origin}/api/control/visits?${query}`, { headers: { cookie } });
      expect(response.status).toBe(200);
      return await response.json() as typeof visits & {
        insightRange: { from: string; to: string };
        sampleTotal: number;
        recentLogs: Array<{ day: string; visitedAt: string }>;
      };
    };
    const yesterdayOnly = await loadRange('range=yesterday');
    expect(yesterdayOnly.insightRange).toEqual({ from: yesterday, to: yesterday });
    expect(yesterdayOnly).toMatchObject({ sampleTotal: 2, uniqueIpCount: 1, todayViews: 4, last30DaysViews: 7 });
    expect(yesterdayOnly.geoBreakdown.map(item => item.label)).toEqual(['中国 · Beijing', '未知']);
    expect(yesterdayOnly.deviceBreakdown.map(item => item.label)).toEqual(['手机', '桌面端']);
    expect(yesterdayOnly.browserBreakdown.map(item => item.label)).toEqual(['Safari', 'Chrome']);
    expect(yesterdayOnly.recentLogs.map(log => log.visitedAt)).toEqual([`${yesterday} 11:00:00`, `${yesterday} 10:00:00`]);

    const dateRange = await loadRange(`range=custom&from=${tenDaysAgo}&to=${yesterday}`);
    expect(dateRange.insightRange).toEqual({ from: tenDaysAgo, to: yesterday });
    expect(dateRange).toMatchObject({ sampleTotal: 3, uniqueIpCount: 2 });
    expect(dateRange.recentLogs.map(log => log.day)).toEqual([yesterday, yesterday, tenDaysAgo]);
    expect((await loadRange('range=7d')).sampleTotal).toBe(6);
    expect(await loadRange(`range=custom&from=${getBeijingDay(40)}&to=${getBeijingDay(40)}`))
      .toMatchObject({ sampleTotal: 0, uniqueIpCount: 0, recentLogs: [], geoBreakdown: [], deviceBreakdown: [], browserBreakdown: [] });
    for (const query of ['range=bad', 'range=custom', `range=custom&from=${today}&to=${yesterday}`,
      `range=custom&from=2024-02-30&to=2024-03-03`, `range=custom&from=${getBeijingDay(90)}&to=${today}`, `range=custom&from=${today}&to=${getBeijingDay(-1)}`]) {
      expect((await SELF.fetch(`${origin}/api/control/visits?${query}`, { headers: { cookie } })).status).toBe(400);
    }

    // 校验工作台概览（全量与 lite=1）同样携带 IP 去重汇总
    for (const overviewUrl of ['/api/control/overview', '/api/control/overview?lite=1']) {
      const overview = await (await SELF.fetch(`${origin}${overviewUrl}`, { headers: { cookie } })).json() as {
        visits: {
          todayViews: number;
          todayVisitors: number;
          yesterdayViews: number;
          yesterdayVisitors: number;
          last7DaysViews: number;
          last7DaysVisitors: number;
          last30DaysViews: number;
          last30DaysVisitors: number;
          avgDailyVisitors: number;
        };
      };
      expect(overview.visits).toMatchObject({
        todayViews: 4,
        todayVisitors: 2,
        yesterdayViews: 2,
        yesterdayVisitors: 1,
        last7DaysViews: 6,
        last7DaysVisitors: 2,
        last30DaysViews: 7,
        last30DaysVisitors: 3,
      });
      expect(overview.visits.avgDailyVisitors).toBeGreaterThanOrEqual(1);
    }
  });

  it('服务端记录爬虫请求，按 IP 拦截并保留历史，且不影响后台', async () => {
    const ip = '2001:db8::123';
    const crawlerHeaders = { 'CF-Connecting-IP': '2001:0db8:0:0:0:0:0:0123', 'User-Agent': 'Googlebot/2.1' };
    const postBlock = (siteOrigin: string, sessionCookie: string, blocked: boolean, targetIp = ip) => SELF.fetch(`${origin}/api/control/crawler-block`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: siteOrigin, cookie: sessionCookie },
      body: JSON.stringify({ ip: targetIp, blocked }),
    });
    expect((await SELF.fetch(`${origin}/?lang=zh&secret=should-not-be-logged`, { headers: crawlerHeaders })).status).toBe(200);
    expect((await postBlock(origin, '', true)).status).toBe(401);
    expect((await postBlock('https://other.example', cookie, true)).status).toBe(403);
    expect((await postBlock(origin, cookie, true, 'unknown')).status).toBe(400);
    expect((await postBlock(origin, cookie, true)).status).toBe(200);

    const blocked = await SELF.fetch(`${origin}/api/products`, { headers: { ...crawlerHeaders, 'User-Agent': 'Mozilla/5.0' } });
    expect(blocked.status).toBe(500);
    expect(blocked.headers.get('Cache-Control')).toBe('no-store');
    expect(await blocked.text()).toBe('Internal Server Error');
    expect((await SELF.fetch(`${origin}/`, { method: 'HEAD', headers: crawlerHeaders })).status).toBe(500);
    expect((await SELF.fetch(`${origin}/api/control/session`, { headers: { ...crawlerHeaders, cookie } })).status).toBe(200);
    expect((await SELF.fetch(`${origin}/api/products`, { headers: { 'X-Forwarded-For': ip } })).status).toBe(200);
    expect((await SELF.fetch(`${origin}/api/products`, { headers: { 'CF-Connecting-IP': '192.0.2.55' } })).status).toBe(200);

    const read = async (range: string) => (await (await SELF.fetch(`${origin}/api/control/visits?range=${range}`, { headers: { cookie } })).json()) as {
      crawlerAccess: { logs: Array<{ ip: string; path: string; method: string; blocked: number; isBlocked: number; userAgent: string }>; blocklist: Array<{ ip: string }> };
    };
    const current = (await read('today')).crawlerAccess;
    expect(current.blocklist).toMatchObject([{ ip }]);
    expect(current.logs.filter(log => log.ip === ip)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ip, path: '/', method: 'GET', blocked: 0, isBlocked: 1, userAgent: 'Googlebot/2.1' }),
      expect.objectContaining({ ip, path: '/api/products', blocked: 1, isBlocked: 1 }),
      expect.objectContaining({ ip, path: '/', method: 'HEAD', blocked: 1, isBlocked: 1 }),
    ]));
    expect((await read('yesterday')).crawlerAccess).toMatchObject({ logs: [], blocklist: [{ ip }] });
    expect((await postBlock(origin, cookie, false)).status).toBe(200);
    expect((await SELF.fetch(`${origin}/?lang=zh`, { headers: crawlerHeaders })).status).toBe(200);
    const unblocked = (await read('today')).crawlerAccess;
    expect(unblocked.blocklist).toEqual([]);
    expect(unblocked.logs.some(log => log.ip === ip && log.blocked === 1 && log.isBlocked === 0)).toBe(true);
  });

  it('自动拦截换 IP 的采集客户端并留档，不永久拉黑共享 IP', async () => {
    const clientIp = '192.0.2.123';
    const otherIp = '192.0.2.124';
    const fetchAs = (path: string, userAgent: string, ip?: string, method = 'GET') => SELF.fetch(`${origin}${path}`, {
      method, headers: { 'User-Agent': userAgent, ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
    });
    for (const ip of [clientIp, otherIp, undefined]) {
      const blocked = await fetchAs('/api/products?secret=not-in-log', 'curl/8.9.1', ip);
      expect(blocked.status).toBe(500);
      expect(blocked.headers.get('cache-control')).toBe('no-store');
      expect(await blocked.text()).toBe('Internal Server Error');
    }
    const head = await fetchAs('/catalog/', 'Mozilla/5.0 (compatible; FixtureSpider/1.0)', otherIp, 'HEAD');
    expect(head.status).toBe(500);
    expect(await head.text()).toBe('');
    expect((await fetchAs('/api/products', 'Mozilla/5.0', clientIp)).status).toBe(200);
    expect((await fetchAs('/api/shops?fields=sync', 'node', clientIp)).status).toBe(200);
    expect((await fetchAs('/robots.txt', 'curl/8.9.1', clientIp)).status).toBe(200);
    expect((await fetchAs('/catalog/', 'Mozilla/5.0 (compatible; OAI-SearchBot/1.0)', otherIp)).status).toBe(200);
    expect((await fetchAs('/catalog/', 'Mozilla/5.0 (compatible; FakeGooglebot/1.0)', otherIp)).status).toBe(500);
    expect((await fetchAs('/api/products', 'Googlebot/2.1', otherIp)).status).toBe(500);

    const response = await SELF.fetch(`${origin}/api/control/visits?range=today`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const { crawlerAccess } = await response.json<{ crawlerAccess: { blocklist: unknown[]; logs: unknown[] } }>();
    expect(crawlerAccess.blocklist).toEqual([]);
    expect(crawlerAccess.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ ip: clientIp, path: '/api/products', blocked: 1, isBlocked: 0, userAgent: 'curl/8.9.1' }),
      expect.objectContaining({ ip: otherIp, path: '/catalog/', method: 'HEAD', blocked: 1, isBlocked: 0 }),
      expect.objectContaining({ ip: otherIp, path: '/catalog/', blocked: 0, userAgent: 'Mozilla/5.0 (compatible; OAI-SearchBot/1.0)' }),
    ]));
  });

  it('仅已鉴权的同步读取可通过爬虫规则和共享 IP 黑名单', async () => {
    const ip = '192.0.2.130';
    const secret = 'test-ingest-secret';
    const shopId = 'crawler-sync-fixture';
    const shopUrl = `https://catfk.com/shop/${shopId}`;
    const list = '/api/shops?fields=sync';
    const detail = `/api/shops/${shopId}/products`;
    const read = (path: string, token?: string, userAgent = 'curl/8.9.1', method = 'GET') => SELF.fetch(`${origin}${path}`, {
      method, headers: { 'CF-Connecting-IP': ip, 'User-Agent': userAgent, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const ingest = await SELF.fetch(`${origin}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, 'User-Agent': 'curl/8.9.1', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ shopId, shopUrl, snapshot: { shopName: '同步测试店铺', canonicalUrl: shopUrl, items: [] } }),
    });
    expect(ingest.status).toBe(200);

    expect((await read(list)).status).toBe(500);
    expect((await read(list, 'wrong-secret')).status).toBe(500);
    expect((await read(list, secret)).status).toBe(200);

    await env.DB.prepare('INSERT INTO crawler_blocked_ips(ip, blocked_at) VALUES (?, ?)').bind(ip, new Date().toISOString()).run();
    try {
      expect((await read(detail, undefined, 'node')).status).toBe(500);
      const response = await read(detail, secret, 'node');
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(await response.json()).toMatchObject({ shop: { id: shopId, productItems: [] } });
      expect((await read('/api/shops?page=1&pageSize=100', secret)).status).toBe(200);
      expect((await read('/api/products', secret)).status).toBe(500);
      expect((await read(list, secret, 'curl/8.9.1', 'HEAD')).status).toBe(500);

      const nextSecret = 'crawler-sync-rotated-secret';
      const rotated = await SELF.fetch(`${origin}/api/control/ingest-secret`, {
        method: 'POST', headers: { origin, cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: nextSecret }),
      });
      expect(rotated.status).toBe(200);
      expect((await read(list, secret)).status).toBe(500);
      expect((await read(list, nextSecret)).status).toBe(200);
    } finally {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM crawler_blocked_ips WHERE ip = ?').bind(ip),
        env.DB.prepare('UPDATE admin_settings SET ingest_hash = NULL WHERE id = 1'),
      ]);
    }
  });
});
