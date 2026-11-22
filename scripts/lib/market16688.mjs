const marketOrigin = 'https://www.16688.com.cn';
export const MARKET16688_MISSING_LIMIT = 12;

export function market16688ShopKey(value) {
  try {
    const url = new URL(value);
    if (!['16688.com.cn', 'www.16688.com.cn'].includes(url.hostname)) return '';
    return url.pathname.match(/^\/shop\/([a-zA-Z0-9_-]{1,100})\/?$/)?.[1] || '';
  } catch {
    return '';
  }
}

export function isMarket16688OfferKey(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(value);
}

/** Verify only offers absent from this listing. Ambiguous responses stop the extra checks. */
export async function confirmMissingMarket16688Offers(previous, observedKeys, {
  beforeRequest,
} = {}) {
  const candidates = previous.filter(({ itemKey }) => isMarket16688OfferKey(itemKey) && !observedKeys.has(itemKey));
  const confirmed = [];

  for (const candidate of candidates) {
    await beforeRequest?.();
    try {
      const response = await fetch(`${marketOrigin}/shopApi/goods/detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ goods_no: candidate.itemKey }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 200 || !(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
        return { confirmed, interrupted: true };
      }
      const result = await response.json();
      if (result?.code === 0 && typeof result.msg === 'string' && result.msg.trim() === '商品不存在' && result.data === null) {
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
