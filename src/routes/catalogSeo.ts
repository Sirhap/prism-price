import { hideTelegramContacts } from '../collector/shopPresentation';

const origin = 'https://parity.sirhao.top';
const size = 30;
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const safeText = (value: unknown): string => hideTelegramContacts(String(value ?? ''));

function page(title: string, path: string, content: string, status = 200): Response {
  const canonical = origin + path;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | 棱镜比价</title><meta name="description" content="${esc(title)}：浏览公开店铺和 AI 数字商品参考信息，实际价格和库存以店铺为准。"><link rel="canonical" href="${esc(canonical)}"><meta property="og:title" content="${esc(title)} | 棱镜比价"><meta property="og:url" content="${esc(canonical)}"><style>body{font:16px/1.8 system-ui,sans-serif;background:#f5f7fd;color:#19233b;margin:0}main{max-width:820px;margin:3rem auto;padding:0 1.25rem}article{background:white;border:1px solid #e1e8f4;border-radius:20px;padding:clamp(1.2rem,5vw,2.5rem)}a{color:#5145dd}li{margin:.5rem 0}footer{margin-top:2rem;color:#66758e}</style></head><body><main><nav><a href="/">棱镜比价首页</a> · <a href="/guide/">使用指南</a> · <a href="/catalog/shops/">店铺目录</a> · <a href="/catalog/products/">商品目录</a></nav><article><h1>${esc(title)}</h1>${content}<footer>本站仅做公开信息收录，不参与交易；实际价格、库存和售后以店铺页面为准。</footer></article></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store', ...(status !== 200 ? { 'X-Robots-Tag': 'noindex' } : {}) } });
}

/** 只查询当前目录页及单条详情，避免为爬虫读取完整商品库。 */
export async function handleCatalogSeo(url: URL, env: Env): Promise<Response> {
  const match = url.pathname.match(/^\/catalog\/(shops|products)\/(?:([^/]+)\/)?$/);
  if (!match) return page('页面不存在', '/catalog/', '<p>没有找到这个页面。</p>', 404);
  const shop = match[1] === 'shops';
  const kind = match[1];
  if (match[2]) {
    let id: string;
    try { id = decodeURIComponent(match[2]); } catch { return page('页面不存在', '/catalog/', '<p>没有找到这个页面。</p>', 404); }
    if (!id || id.length > 2048) return page('页面不存在', '/catalog/', '<p>没有找到这个页面。</p>', 404);
    if (shop) {
      const row = await env.DB.prepare('SELECT shop_name, product_count, canonical_url FROM shops WHERE id = ? LIMIT 1').bind(id).first<{shop_name:string;product_count:number;canonical_url:string}>();
      if (!row) return page('店铺不存在', `/catalog/shops/${encodeURIComponent(id)}/`, '<p>该店铺未收录或已移除。</p>', 404);
      let link = '';
      try { const u = new URL(row.canonical_url); if (u.protocol === 'http:' || u.protocol === 'https:') link = `<p><a rel="nofollow noopener noreferrer" href="${esc(u.href)}">进入源站店铺核实</a></p>`; } catch { /* 不展示无效地址 */ }
      return page(safeText(row.shop_name), `/catalog/shops/${encodeURIComponent(id)}/`, `<p>已收录商品：${Number(row.product_count) || 0} 件。</p>${link}<p>信息可能存在时间差，请以源站页面为准。</p>`);
    }
    const row = await env.DB.prepare('SELECT display_name, min_price, shop_count FROM product_groups WHERE group_key = ? LIMIT 1').bind(id).first<{display_name:string;min_price:number;shop_count:number}>();
    if (!row) return page('商品不存在', `/catalog/products/${encodeURIComponent(id)}/`, '<p>该商品未收录或已移除。</p>', 404);
    const price = Number(row.min_price);
    return page(safeText(row.display_name), `/catalog/products/${encodeURIComponent(id)}/`, `<p>参考最低报价：${Number.isFinite(price) ? `¥${price.toFixed(2)}` : '暂不可用'}；收录店铺：${Number(row.shop_count) || 0} 家。</p><p>报价可能变化，<a href="/">返回首页搜索并比较店铺</a>。</p>`);
  }
  const after = url.searchParams.get('after') || '';
  if (after.length > 2048 || (url.searchParams.has('page') && url.searchParams.get('page') !== '1')) return page('页面不存在', `/catalog/${kind}/`, '<p>目录参数无效。</p>', 404);
  const sql = shop ? 'SELECT id AS key, shop_name AS name FROM shops WHERE id > ? ORDER BY id LIMIT ?' : 'SELECT group_key AS key, display_name AS name FROM product_groups WHERE group_key > ? ORDER BY group_key LIMIT ?';
  const { results } = await env.DB.prepare(sql).bind(after, size + 1).all<{key:string;name:string}>();
  const rows = results || [];
  if (after && rows.length === 0) return page('页面不存在', `/catalog/${kind}/`, '<p>没有更多内容。</p>', 404);
  const links = rows.slice(0,size).map(r => `<li><a href="/catalog/${kind}/${encodeURIComponent(r.key)}/">${esc(safeText(r.name))}</a></li>`).join('');
  const base = `/catalog/${kind}/`; const path = after ? `${base}?after=${encodeURIComponent(after)}` : base;
  const next = rows.length > size ? `<a rel="next" href="${base}?after=${encodeURIComponent(rows[size-1].key)}">下一页</a>` : '';
  return page(`${shop ? '公开店铺' : 'AI 与数字商品'}目录`, path, `<p>浏览已收录${shop ? '店铺' : '商品'}；报价和库存以源站为准。</p><ul>${links}</ul><nav aria-label="目录分页">${next}</nav>`);
}
