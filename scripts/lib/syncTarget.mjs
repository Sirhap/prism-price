import fs from 'node:fs';

const DEFAULT_API_BASE = 'https://parity.sirhao.top';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Validates the destination before a sync client sends credentials. */
export function normalizeSyncApiBase(input) {
  const url = URL.parse(input);
  const loopbackHttp = url?.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!url || (url.protocol !== 'https:' && !loopbackHttp) || url.username || url.password || /[?#]/.test(url.href)) {
    throw new Error('API_BASE 必须是 HTTPS 地址（本地测试可用 HTTP），且不能包含凭据、查询参数或片段');
  }
  return url.href.replace(/\/+$/, '');
}

/** Reads supported settings from a local env file, defaulting to the legacy file. */
export function readSyncConfigFile(file = new URL('../../.dev.vars', import.meta.url)) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(API_BASE|INGEST_SECRET|SYNC_INTERVAL_MIN_MS|SYNC_INTERVAL_MAX_MS)\s*=\s*(.*?)\s*$/);
    if (match) result[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return result;
}

/** An inherited key stays with its configured origin. An explicit key is for the current target. */
export function resolveSyncTarget(env, config = {}, legacy = {}) {
  const configuredBase = config.API_BASE || DEFAULT_API_BASE;
  const apiBase = normalizeSyncApiBase(env.API_BASE?.trim() || configuredBase);
  const keyBase = config.INGEST_SECRET ? configuredBase : legacy.API_BASE || configuredBase;
  const inheritedSecret = new URL(apiBase).origin === URL.parse(keyBase)?.origin
    ? config.INGEST_SECRET || legacy.INGEST_SECRET
    : '';
  return { apiBase, secret: env.INGEST_SECRET?.trim() || inheritedSecret || '' };
}
