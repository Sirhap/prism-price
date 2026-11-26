import { confirmMissingOffers } from './missingOffers.mjs';

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
  return confirmMissingOffers(candidates, {
    url: `${marketOrigin}/shopApi/goods/detail`,
    keyField: 'goods_no',
    isMissing: message => typeof message === 'string' && message.trim() === '商品不存在',
    beforeRequest,
  });
}
