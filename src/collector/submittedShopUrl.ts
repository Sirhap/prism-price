/** Normalize public storefront URLs without fetching the submitted destination. */
export function normalizeSubmittedShopUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048) return null;
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const platforms: Record<string, string> = {
    'pay.ldxp.cn': 'wzyp.cn', 'wzyp.cn': 'wzyp.cn',
    'catfk.com': 'catfk.com', 'www.catfk.com': 'catfk.com',
    '16688.com.cn': 'www.16688.com.cn', 'www.16688.com.cn': 'www.16688.com.cn',
  };
  const canonicalHost = platforms[host];
  if (!canonicalHost) {
    if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost') || /^[0-9.]+$/.test(host) || host.includes(':')) return null;
    url.hash = '';
    url.search = '';
    return url.href.replace(/\/$/, '');
  }
  const match = url.pathname.match(/^\/shop\/([a-zA-Z0-9_-]{1,100})\/?$/);
  if (!match) return null;
  return `https://${canonicalHost}/shop/${match[1]}`;
}
