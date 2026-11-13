#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSnapshotHash } from '../scripts/lib/snapshotHash.mjs';
import { fetchShopApiSnapshot, shouldSkipLocalPush } from '../scripts/push-sync.mjs';

const syncDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(syncDir, '..');
const defaultCheckpoint = path.join(root, 'output', 'local-sync-checkpoint.json');

export function parseArgs(args) {
  const result = { apply: false, resume: false, deleteUnavailable: false, concurrency: 1, intervalMs: null, shardIndex: 1, shardCount: 1, limit: 0, shops: [], checkpoint: defaultCheckpoint, checkpointExplicit: false };
  for (const arg of args) {
    if (arg === '--apply') result.apply = true;
    else if (arg === '--delete-unavailable') result.deleteUnavailable = true;
    else if (arg === '--resume') result.resume = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--explain') result.explain = true;
    else if (arg.startsWith('--shop=')) result.shops.push(arg.slice(7));
    else if (arg.startsWith('--checkpoint=')) { result.checkpoint = path.resolve(arg.slice(13)); result.checkpointExplicit = true; }
    else if (arg.startsWith('--interval-ms=')) result.intervalMs = Number(arg.slice(14));
    else if (arg.startsWith('--shard=')) {
      const match = arg.slice(8).match(/^(\d+)\/(\d+)$/);
      if (!match) throw new Error('分片格式应为 --shard=序号/总数');
      result.shardIndex = Number(match[1]); result.shardCount = Number(match[2]);
    }
    else if (arg.startsWith('--concurrency=')) result.concurrency = Number(arg.slice(14));
    else if (arg.startsWith('--limit=')) result.limit = Number(arg.slice(8));
    else throw new Error(`未知参数: ${arg}`);
  }
  if (!Number.isInteger(result.concurrency) || result.concurrency < 1 || result.concurrency > 8) throw new Error('并发数必须为 1–8');
  if (result.intervalMs !== null && (!Number.isInteger(result.intervalMs) || result.intervalMs < 100)) throw new Error('请求间隔至少为 100 毫秒');
  if (!Number.isInteger(result.shardCount) || result.shardCount < 1 || result.shardCount > 256 || !Number.isInteger(result.shardIndex) || result.shardIndex < 1 || result.shardIndex > result.shardCount) throw new Error('分片范围无效（1 ≤ 序号 ≤ 总数 ≤ 256）');
  if (!result.checkpointExplicit && result.shardCount > 1) result.checkpoint = path.join(root, 'output', `local-sync-checkpoint-${result.shardIndex}-of-${result.shardCount}.json`);
  if (!Number.isInteger(result.limit) || result.limit < 0) throw new Error('limit 必须是非负整数');
  if (result.shops.some((s) => !s.trim())) throw new Error('店铺标识不能为空');
  if (result.deleteUnavailable && !result.apply) throw new Error('--delete-unavailable 需要配合 --apply');
  if (result.resume && !result.apply) throw new Error('--resume 需要配合 --apply');
  return result;
}

function readConfigFile(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(API_BASE|INGEST_SECRET|SYNC_INTERVAL_MIN_MS|SYNC_INTERVAL_MAX_MS)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return result;
}

/** Environment overrides the dedicated configuration; legacy .dev.vars is a secret fallback. */
export function loadConfig(env = process.env, files = {}) {
  const config = readConfigFile(files.config || path.join(syncDir, 'config.env'));
  const legacy = readConfigFile(files.legacy || path.join(root, '.dev.vars'));
  return {
    apiBase: env.API_BASE?.trim() || config.API_BASE || 'https://parity.sirhao.top',
    secret: env.INGEST_SECRET?.trim() || config.INGEST_SECRET || legacy.INGEST_SECRET || '',
    intervalMinMs: Number(env.SYNC_INTERVAL_MIN_MS ?? (config.SYNC_INTERVAL_MIN_MS || 1000)),
    intervalMaxMs: Number(env.SYNC_INTERVAL_MAX_MS ?? (config.SYNC_INTERVAL_MAX_MS || 2000)),
  };
}

function apiUrl(input) {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('API_BASE 必须是 HTTPS 地址（本地测试可用 HTTP），且不能包含凭据或查询参数');
  return url.href.replace(/\/+$/, '');
}

function saveCheckpoint(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`); error.status = response.status;
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      const data = await response.json().catch(() => null);
      error.shopNotFound = response.status === 404 && data?.error === '店铺不存在';
    }
    throw error;
  }
  return response.json();
}

/** 稳定按店铺 ID 分片，不依赖清单顺序；同一总片数下每家店只落入一个分片。 */
export function shardForShop(shopId, total) {
  return crypto.createHash('sha256').update(String(shopId)).digest().readUInt32BE(0) % total + 1;
}

/** 为整个进程的源站请求串行调度，发现风控后阻止后续请求。 */
export function createRequestGate(intervalMs = 1000, { maxIntervalMs = 2000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random, now = Date.now } = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 100 || !Number.isInteger(maxIntervalMs) || maxIntervalMs < intervalMs) throw new Error("请求间隔范围无效：最小值至少 100 毫秒，最大值不能小于最小值");
  let queue = Promise.resolve();
  let nextAt = 0;
  let blocked = false;
  return {
    block() { blocked = true; },
    cooldown(ms) { nextAt = Math.max(nextAt, now() + ms); },
    isBlocked() { return blocked; },
    before() {
      const job = queue.then(async () => {
        if (blocked) { const error = new Error('已触发源站风控，停止本轮'); error.isRateLimited = true; throw error; }
        while (nextAt > now()) await sleep(nextAt - now());
        if (blocked) { const error = new Error('已触发源站风控，停止本轮'); error.isRateLimited = true; throw error; }
        nextAt = now() + intervalMs + Math.floor(random() * (maxIntervalMs - intervalMs + 1));
      });
      queue = job.catch(() => {});
      return job;
    },
  };
}

/** Returns a nonzero failure count for partial runs; injected dependencies permit offline tests. */
export async function runSync(options, deps = {}) {
  const base = apiUrl(options.apiBase);
  const load = deps.load || ((url) => jsonFetch(url));
  const minInterval = options.intervalMs ?? options.intervalMinMs ?? 1000;
  const maxInterval = options.intervalMs != null ? options.intervalMs + 1000 : options.intervalMaxMs ?? 2000;
  const gate = deps.gate || createRequestGate(minInterval, { maxIntervalMs: maxInterval });
  const collect = deps.collect || ((shop) => fetchShopApiSnapshot(shop, { requestGate: gate, allowChallengeSolve: false, skipRiskRetry: true }));
  const remove = deps.remove || ((shop) => jsonFetch(`${base}/api/admin/shops/${encodeURIComponent(shop.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${options.secret}` } }));
  const push = deps.push || ((entry) => jsonFetch(`${base}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.secret}` }, body: JSON.stringify({ shops: [entry] }) }));
  if (options.apply && !options.secret && !deps.push) throw new Error('缺少 INGEST_SECRET：请配置 local-sync/config.env、环境变量或项目 .dev.vars');
  const data = await load(`${base}/api/shops?fields=sync`);
  if (!Array.isArray(data.shops)) throw new Error('同步清单格式不正确');
  let targets = data.shops.filter((s) => s.syncSupported && ['push_ingest', 'shop_api'].includes(s.adapterType));
  if (options.shops.length) {
    const wanted = new Set(options.shops);
    targets = targets.filter((s) => wanted.has(s.id) || wanted.has(s.shopUrl) || wanted.has(new URL(s.shopUrl).pathname.split('/').filter(Boolean).at(-1)));
    for (const term of wanted) if (!targets.some((s) => s.id === term || s.shopUrl === term || new URL(s.shopUrl).pathname.split('/').filter(Boolean).at(-1) === term)) throw new Error(`没有找到支持同步的店铺: ${term}`);
  }
  const shardCount = options.shardCount ?? 1;
  const shardIndex = options.shardIndex ?? 1;
  targets = targets.filter((shop) => shardForShop(shop.id, shardCount) === shardIndex);
  if (options.limit) targets = targets.slice(0, options.limit);
  const scope = { shardIndex, shardCount, shops: [...options.shops].sort(), limit: options.limit };
  let state = { version: 2, apiBase: base, scope, completed: {} };
  if (options.resume) {
    state = JSON.parse(fs.readFileSync(options.checkpoint, 'utf8'));
    if (state.version !== 2 || state.apiBase !== base || JSON.stringify(state.scope) !== JSON.stringify(scope) || !state.completed || Array.isArray(state.completed) || typeof state.completed !== 'object') throw new Error('续跑记录无效或目标地址不匹配');
  } else if (options.apply) saveCheckpoint(options.checkpoint, state);
  const stats = { total: targets.length, resumed: 0, unchanged: 0, changed: 0, pushed: 0, deleted: 0, emptyCandidates: 0, alreadyAbsent: 0, failed: 0, riskSkipped: 0, unprocessed: 0 };
  let cursor = 0;
  console.log(`[local-sync] ${options.apply ? '执行推送' : '预览（不会写入）'}：${targets.length} 家，分片 ${shardIndex}/${shardCount}，并发 ${options.concurrency}，请求间隔 ${minInterval}～${maxInterval}ms，目标 ${base}`);
  async function worker() {
    while (cursor < targets.length && !gate.isBlocked()) {
      const shop = targets[cursor++];
      if (options.resume && state.completed[shop.id] === shop.shopUrl) { stats.resumed++; continue; }
      try {
        const snapshot = await collect(shop);
        if (snapshot.items.length === 0) {
          if (!options.apply) { stats.emptyCandidates++; console.log(`[local-sync] ${shop.id}: 无可收录商品，正式同步将删除`); continue; }
          const error = new Error('源站完整采集后无可收录商品'); error.shopUnavailable = 'empty'; throw error;
        }
        if (snapshot.items.length > 2000) throw new Error("快照超过接收接口 2000 件上限，已停止该店推送以避免截断");
        const unchanged = shouldSkipLocalPush({ shop, snapshot, localHash: computeSnapshotHash(snapshot), descriptionPersistence: data.descriptionPersistence });
        if (unchanged) stats.unchanged++;
        else {
          stats.changed++;
          if (options.apply) {
            const result = await push({ shopId: shop.id, shopUrl: shop.shopUrl, snapshot });
            if (result.failedCount || !Array.isArray(result.outcomes) || result.outcomes.length !== 1 || result.outcomes[0].shopId !== shop.id || !['updated', 'unchanged'].includes(result.outcomes[0].status)) throw new Error('推送结果未确认成功');
            stats.pushed++;
          }
        }
        if (options.apply) { state.completed[shop.id] = shop.shopUrl; saveCheckpoint(options.checkpoint, state); }
        console.log(`[local-sync] ${shop.id}: ${unchanged ? '未变化' : options.apply ? '已推送' : '有变化'}`);
      } catch (error) {
        if (options.apply && (error?.shopUnavailable === 'not_found' || error?.shopUnavailable === 'empty' || (error?.shopUnavailable === 'closed' && options.deleteUnavailable))) {
          try {
            const result = await remove(shop);
            if (result?.deleted !== true || result.shopId !== shop.id) throw new Error('删除结果未确认');
            stats.deleted++; state.completed[shop.id] = shop.shopUrl; saveCheckpoint(options.checkpoint, state);
            console.log(`[local-sync] ${shop.id}: 源站店铺不可用，已删除`);
            continue;
          } catch (deleteError) {
            if (deleteError?.shopNotFound) {
              stats.alreadyAbsent++; state.completed[shop.id] = shop.shopUrl; saveCheckpoint(options.checkpoint, state);
              console.log(`[local-sync] ${shop.id}: 目标店铺已不存在，无需重复删除`); continue;
            }
            if ([401, 403, 429].includes(deleteError?.status)) gate.block();
            stats.failed++; console.warn(`[local-sync] ${shop.id}: 删除失败：${deleteError instanceof Error ? deleteError.message : String(deleteError)}`); continue;
          }
        }
        if (error?.isRateLimited) {
          stats.riskSkipped++; stats.failed++;
          console.warn(`[local-sync] ${shop.id}: 源站风控，跳过该店：${error.message}`);
          continue;
        }
        if ([401, 403, 429].includes(error?.status)) gate.block();
        stats.failed++;
        console.warn(`[local-sync] ${shop.id}: 失败，未覆盖原数据：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, targets.length) }, worker));
  if (gate.isBlocked()) { stats.unprocessed = targets.length - cursor; console.warn(`[local-sync] 目标站鉴权或限流导致停止；未处理 ${targets.length - cursor} 家，请勿自动重试`); }
  console.log(`[local-sync] 结果 ${JSON.stringify(stats)}`);
  return stats;
}

/** 只输出代码实际行为；不读取密钥、不执行网络请求。 */
export function describeWorkflow() {
  return {
    mode: '仅说明，不访问网络、不读取密钥、不修改数据',
    credentials: 'INGEST_SECRET 只用于配置的目标 API 地址的 Bearer 鉴权；不向店铺源站发送。',
    destinations: {
      catalog: '从目标 API 的 /api/shops?fields=sync 获取店铺地址及摘要。',
      source: '从各店铺 URL 指向的源站请求店铺信息和商品列表；pay.ldxp.cn 对应 wzyp.cn。',
      push: '使用 --apply 时向目标 API 的 /api/ingest 推送变化快照。',
      delete: '使用 --apply 时，源站明确报告店铺不存在或完整采集后无可收录商品，会调用目标 API 的店铺删除接口；加 --delete-unavailable 时关闭交易的店铺也会删除。',
    },
    deletion: '删除会同时删除目标站的店铺、商品报价和历史快照；判断来自源站单次响应，可能误判。封禁和普通网络失败不删除。',
    rate: '默认单并发、随机间隔 1～2 秒；单店触发风控立即跳过并继续下一家，目标站鉴权失败或限流则停止。多进程不共享限速。',
    defaults: '默认只预览，不写入；仅显式 --apply 才会写入或删除。脚本不会自行设置定时任务。',
    audit: '开源代码和凭据均需使用者自行确认；不要将密钥写入仓库、日志或提示词。',
  };
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.explain) { console.log(JSON.stringify(describeWorkflow(), null, 2)); return; }
  if (options.help) {
    console.log('本地采集并推送店铺快照（默认只预览）\n用法：node local-sync/sync.mjs [--explain] [--apply] [--delete-unavailable] [--resume] [--shop=店铺ID或地址末段] [--limit=数量] [--concurrency=1..8] [--interval-ms=100以上] [--shard=序号/总数] [--checkpoint=文件]\n配置：local-sync/config.env 或 API_BASE、INGEST_SECRET 环境变量；密钥也可使用项目 .dev.vars');
    return;
  }
  const config = loadConfig();
  const result = await runSync({ ...options, apiBase: config.apiBase, intervalMinMs: config.intervalMinMs, intervalMaxMs: config.intervalMaxMs, secret: options.apply ? config.secret : '' });
  if (result.failed) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`[local-sync] ${error.message}`); process.exitCode = 1; });
