import { confirmMissingOffers } from './missingOffers.mjs';

export const MARKET16688_HOST = 'www.16688.store';
export const MARKET16688_ORIGIN = `https://${MARKET16688_HOST}`;
export const MARKET16688_HOSTS = [MARKET16688_HOST, '16688.store', 'www.16688.com.cn', '16688.com.cn'];
export const MARKET16688_MISSING_LIMIT = 12;

/** Keep old links usable while sending requests and generating links on the new domain. */
export function normalizeMarket16688Url(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.port || url.username || url.password ||
        !MARKET16688_HOSTS.includes(url.hostname)) return value;
    return MARKET16688_ORIGIN + url.pathname + url.search + url.hash;
  } catch {
    return value;
  }
}

export function market16688ShopKey(value) {
  try {
    const url = new URL(value);
    if (!MARKET16688_HOSTS.includes(url.hostname) || !['https:', 'http:'].includes(url.protocol) ||
        url.port || url.username || url.password) return '';
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
  return confirmMissingOffers(candidates, {
    url: `${MARKET16688_ORIGIN}/shopApi/goods/detail`,
    keyField: 'goods_no',
    isMissing: message => typeof message === 'string' && message.trim() === '商品不存在',
    beforeRequest,
  });
}
