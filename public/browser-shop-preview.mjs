/** 在访问者浏览器中读取源站的公开商品，仅供本次预览。 */
export async function previewShopFromBrowser(rawUrl, { fetcher = fetch, wait = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const url = new URL(rawUrl);
  const originMap = { 'wzyp.cn': 'https://wzyp.cn', 'pay.ldxp.cn': 'https://wzyp.cn', 'catfk.com': 'https://catfk.com', 'www.catfk.com': 'https://catfk.com' };
  const origin = originMap[url.hostname.toLowerCase()];
  if (!origin) throw new Error('此平台暂不支持浏览器直接读取，请等待后续同步');
  const token = url.pathname.match(/^\/shop\/([a-zA-Z0-9_-]{1,100})\/?$/)?.[1];
  if (!token) throw new Error('请输入完整店铺地址');
  async function request(path, data) {
    let response;
    try { response = await fetcher(`${origin}/shopApi/Shop/${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data), credentials:'omit', signal:AbortSignal.timeout(10000) }); }
    catch (error) { throw new Error(error?.name === 'TimeoutError' ? '连接源站超时，请稍后重试' : '无法连接源站，可能受到网络或跨域限制'); }
    if (!response.ok) throw new Error(`源站暂不可用（HTTP ${response.status}）`);
    if (!(response.headers.get('content-type') || '').includes('json')) throw new Error('源站返回验证页面或非 JSON 内容');
    const body = await response.json();
    if (body.code !== 1 || !body.data) throw new Error('源站未返回可用商品信息');
    return body.data;
  }
  const info = await request('info', {token});
  const types = ['card','article','resource','equity'].filter(type => Number(info[`${type}_count`] ?? (type === 'card' ? info.goods_count : 0)) > 0);
  if (!types.length) types.push('card');
  const items = []; const seen = new Set();
  for (const goodsType of types) {
    let page = 1, total = null;
    do {
      await wait(1000);
      const data = await request('goodsList', {token, goods_type:goodsType, current:page, pageSize:100, page, limit:100});
      if (!Array.isArray(data.list) || data.total === null || data.total === undefined || data.total === '' || !Number.isSafeInteger(Number(data.total)) || Number(data.total) < 0) throw new Error('源站商品列表不完整');
      total = Number(data.total);
      const declared = Number(info[`${goodsType}_count`] ?? (goodsType === 'card' ? info.goods_count : 0));
      if (page === 1 && declared > 0 && total === 0) throw new Error('源站按分类提供商品，暂无法在浏览器完整读取');
      if (data.list.length > total) throw new Error('源站商品总数异常');
      let added = 0;
      for (const item of data.list) {
        const key = String(item.goods_key || item.link || '');
        if (!key) throw new Error('源站商品缺少标识，无法确认完整性');
        if (!seen.has(`${goodsType}:${key}`)) { seen.add(`${goodsType}:${key}`); items.push(item); added++; }
      }
      const collected = [...seen].filter(key => key.startsWith(`${goodsType}:`)).length;
      if (collected >= total) break;
      if (!added || page >= 30) throw new Error('源站分页不完整，已停止读取');
      page++;
    } while (true);
  }
  return { name: String(info.nickname || '店铺').slice(0, 120), count: items.length, origin, items };
}

/** 将源站原始商品映射为受限回传格式；不携带联系方式或管理员凭据。 */
export function buildBrowserShopPayload(shopId, snapshot) {
  if (typeof shopId !== 'string' || !shopId.trim() || !snapshot || !Array.isArray(snapshot.items)) throw new Error('店铺数据不完整');
  if (snapshot.items.length > 2000) throw new Error('商品数量超过接口上限');
  const items = [];
  const keys = new Set();
  for (const raw of snapshot.items) {
    const itemKey = String(raw.goods_key || '').trim();
    const rawName = String(raw.name || '').trim();
    const price = Number(raw.price);
    if (!itemKey || !rawName || !Number.isFinite(price) || price <= 0) continue;
    if (keys.has(itemKey)) continue;
    keys.add(itemKey);
    const rawStock = raw.extend?.stock_count;
    const stockCount = typeof rawStock === 'number' && Number.isFinite(rawStock) ? Math.max(0, Math.floor(rawStock)) : null;
    items.push({ itemKey, rawName, shopCategory: String(raw.category?.name || ''), price, stockCount,
      stockStatus: stockCount !== null && stockCount <= 5 ? 'low' : stockCount !== null && stockCount <= 20 ? 'normal' : 'sufficient',
      itemUrl: raw.link ? new URL(String(raw.link), snapshot.origin || 'https://invalid.example').href : '' });
  }
  return { shopId: shopId.trim(), shopName: String(snapshot.name || '').slice(0, 120), items };
}


/** 使用当前浏览器采集，向本站受限接口提交，不使用管理员密钥。 */
export async function syncShopFromBrowser(shopId, shopUrl, options = {}) {
  const snapshot = await previewShopFromBrowser(shopUrl, options);
  const payload = buildBrowserShopPayload(shopId, snapshot);
  if (!payload.items.length) throw new Error('没有可回传的商品，已保留原有数据');
  const send = options.send || fetch;
  const response = await send('/api/shops/browser-sync', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), signal:AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || '商品写入失败');
  return { snapshot, result:data };
}
