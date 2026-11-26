/** Canonical identity for the two public LDXP storefront domains. */
export function ldxpShopKey(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password ||
        !['pay.ldxp.cn', 'wzyp.cn'].includes(url.hostname)) return '';
    return url.pathname.match(/^\/shop\/([a-zA-Z0-9_-]{1,100})\/?$/)?.[1] || '';
  } catch {
    return '';
  }
}

/** Stop on ambiguous responses. Only an exact source response can confirm a missing offer. */
export async function confirmMissingOffers(candidates, { url, keyField, isMissing, beforeRequest }) {
  const confirmed = [];
  for (const candidate of candidates) {
    await beforeRequest?.();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ [keyField]: candidate.itemKey }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 200 || !(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
        await response.body?.cancel();
        return { confirmed, interrupted: true };
      }
      const result = await response.json();
      if (result?.code === 0 && result.data === null && isMissing(result.msg)) {
        confirmed.push(candidate);
      } else if (result?.code !== 1 || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
        return { confirmed, interrupted: true };
      }
    } catch (error) {
      if (error instanceof TypeError || error instanceof SyntaxError || error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return { confirmed, interrupted: true };
      }
      throw error;
    }
  }
  return { confirmed, interrupted: false };
}

export function confirmMissingLdxpOffers(previous, observedKeys, { beforeRequest } = {}) {
  const candidates = previous.filter(({ itemKey }) =>
    /^[a-zA-Z0-9_-]{1,180}$/.test(itemKey) && !observedKeys.has(itemKey),
  );
  return confirmMissingOffers(candidates, {
    url: 'https://wzyp.cn/shopApi/Shop/goodsInfo',
    keyField: 'goods_key',
    isMissing: message => typeof message === 'string' &&
      /^商品(?:未上架|已下架|不存在)(?:[，,]\s*如有疑问请联系商家)?[。.]?$/.test(message.trim()),
    beforeRequest,
  });
}
