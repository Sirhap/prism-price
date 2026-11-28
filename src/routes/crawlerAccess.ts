import { isLocalizedHtmlPath } from '../i18n/locale';
import { canCacheQuery } from '../cache/queryCache';
import { responseStore } from '../cache/responseStore';

const INDEXING_AGENTS = new Set([
  'googlebot', 'google-extended', 'bingbot', 'baiduspider', 'bytespider', 'yisouspider', 'applebot',
  'oai-searchbot', 'chatgpt-user', 'gptbot', 'claudebot', 'claude-searchbot', 'perplexitybot',
]);
const SCRIPT_AGENT = /^(?:curl|wget|python-requests|python-urllib|go-http-client|scrapy|httpx|aiohttp)(?:[\s/]|$)/i;
const CRAWLER_PRODUCT = /(?:bot|spider|crawl(?:er)?|scraper|slurp)$/i;

export function normalizeCrawlerIp(value: string): string {
  const ip = value.trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return ip.split('.').every(part => String(Number(part)) === part && Number(part) <= 255) ? ip : '';
  }
  if (!ip.includes(':') || !/^[0-9a-f:.]{2,45}$/i.test(ip)) return '';
  try {
    return new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return '';
  }
}

export function isCrawlerAgent(userAgent: string): boolean {
  return SCRIPT_AGENT.test(userAgent) || /bot|spider|crawl|slurp|headless|lighthouse|chatgpt-user|google-extended/i.test(userAgent);
}

/** 只按明确的脚本签名或爬虫产品标识自动拦截；索引豁免只是 UA 规则，不代表身份已验证。 */
function shouldAutoBlockCrawler(agent: string, path: string): boolean {
  if (path === '/robots.txt') return false;
  if (SCRIPT_AGENT.test(agent)) return true;
  for (const [, product] of agent.matchAll(/(?:^|[;(\s])([a-z][a-z\d_.-]*)(?=\/\d|[;)\s]|$)/gi)) {
    if (INDEXING_AGENTS.has(product.toLowerCase())) {
      if (path.startsWith('/api/')) return true;
    } else if (CRAWLER_PRODUCT.test(product)) {
      return true;
    }
  }
  return false;
}

function isPublicContent(path: string): boolean {
  return isLocalizedHtmlPath(path) || path === '/go/open-store' || path === '/robots.txt' ||
    path === '/catalog' || path.startsWith('/catalog/') || /^\/sitemap(?:-shops|-products)?\.xml$/.test(path) ||
    /^\/llms(?:-full)?\.txt$/.test(path) || /^\/api\/(?:products|shops(?:\/.*)?|sponsors(?:\/.*)?|visit|locale|public-settings|shop-favorite)$/.test(path);
}

/** Keep the first blocked request per IP in each node's one-minute window. */
async function shouldLogBlockedRequest(url: URL, ip: string): Promise<boolean> {
  if (!ip || !canCacheQuery(url)) return true;
  const key = new URL('/__prism_crawler_log__/v1', url.origin);
  key.searchParams.set('ip', ip);
  const request = new Request(key);
  const store = responseStore();
  try {
    if (await store.match(request)) return false;
    await store.put(request, new Response(null, { headers: { 'Cache-Control': 'public, max-age=60' } }));
  } catch (error) {
    console.warn('crawler_log_cache_unavailable', error);
  }
  return true;
}

/** 只拦公开内容，命中规则时再验证可使用同步豁免的请求。客户端 IP 必须由可信入口提供。 */
export async function checkCrawlerAccess(
  request: Request,
  path: string,
  db: D1Database,
  ctx: ExecutionContext,
  verifySyncRead?: () => Promise<boolean>,
): Promise<Response | null> {
  if (!isPublicContent(path)) return null;
  const ip = normalizeCrawlerIp(request.headers.get('CF-Connecting-IP') || '');
  const userAgent = (request.headers.get('User-Agent') || '').trim();
  const agent = userAgent.slice(0, 300);
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  let blocked = isRead && shouldAutoBlockCrawler(userAgent, path);
  if (!blocked && ip) {
    try {
      blocked = !!await db.prepare('SELECT 1 FROM crawler_blocked_ips WHERE ip = ?').bind(ip).first();
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('no such table'))) {
        console.warn('crawler_blocklist_unavailable', error);
      }
    }
  }

  if (blocked && verifySyncRead && await verifySyncRead()) return null;

  if (blocked || (isRead && isCrawlerAgent(userAgent))) {
    const now = Date.now();
    const day = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
    const logAccess = async () => {
      if (blocked && !await shouldLogBlockedRequest(new URL(request.url), ip)) return;
      await db.prepare(`INSERT INTO crawler_access_logs(day, visited_at, ip, request_path, method, user_agent, blocked)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(day, new Date(now).toISOString(), ip, path.slice(0, 300), request.method, agent, Number(blocked)).run();
    };
    ctx.waitUntil(logAccess().catch((error: unknown) => {
      if (!(error instanceof Error && error.message.includes('no such table'))) console.warn('crawler_access_log_failed', error);
    }));
  }

  return blocked ? new Response(request.method === 'HEAD' ? null : 'Internal Server Error', {
    status: 500,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  }) : null;
}

type CrawlerAccessLog = { id: number; visitedAt: string; ip: string; path: string; method: string; userAgent: string; blocked: number; isBlocked: number };

export async function readCrawlerAccess(db: D1Database, from: string, to: string) {
  try {
    const [logs, blocklist] = await Promise.all([
      db.prepare(`SELECT logs.id, logs.visited_at AS visitedAt, logs.ip, logs.request_path AS path,
                  logs.method, logs.user_agent AS userAgent, logs.blocked, blocks.ip IS NOT NULL AS isBlocked
                  FROM crawler_access_logs AS logs LEFT JOIN crawler_blocked_ips AS blocks ON blocks.ip = logs.ip
                  WHERE logs.day BETWEEN ? AND ? ORDER BY logs.day DESC, logs.visited_at DESC, logs.id DESC LIMIT 50`)
        .bind(from, to).all<CrawlerAccessLog>(),
      db.prepare('SELECT ip, blocked_at AS blockedAt FROM crawler_blocked_ips ORDER BY blocked_at DESC, ip')
        .all<{ ip: string; blockedAt: string }>(),
    ]);
    return { available: true, logs: logs.results, blocklist: blocklist.results };
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such table')) return { available: false, logs: [], blocklist: [] };
    throw error;
  }
}

export async function setCrawlerBlock(db: D1Database, ip: string, blocked: boolean) {
  if (blocked) {
    await db.prepare('INSERT OR IGNORE INTO crawler_blocked_ips(ip, blocked_at) VALUES (?, ?)').bind(ip, new Date().toISOString()).run();
  } else {
    await db.prepare('DELETE FROM crawler_blocked_ips WHERE ip = ?').bind(ip).run();
  }
}
