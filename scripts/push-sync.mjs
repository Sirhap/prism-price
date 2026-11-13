import { computeSnapshotHash } from "./lib/snapshotHash.mjs";
import {
  isIncompleteGoodsBatch,
  isNonSalePlaceholderItem,
  mergeCookieHeaders,
  resolveShopGoodsTypes,
  solveAcwScV2Cookie,
} from "./lib/shopApiHelpers.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RESERVED_TG_PATH_SEGMENTS = new Set([
  "share",
  "proxy",
  "socks",
  "addstickers",
  "addtheme",
  "addlist",
  "setlanguage",
  "joinchat",
  "contact",
  "confirm",
  "boost",
  "giftcode",
  "login",
  "iv",
  "blog",
  "faq",
  "tos",
  "privacy",
]);

const RESERVED_TG_SUBDOMAINS = new Set([
  "www",
  "telegram",
  "static",
  "core",
  "api",
  "web",
  "desktop",
  "macos",
]);

const URL_PATH_PREFIX_RE = /(?:https?:\/\/[^\s/]+(?:\/[^\s]*)?|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?::\d+)?(?:\/[^\s]*)?)\/$/;

/**
 * 读取本地 .dev.vars（若环境变量未显式传 INGEST_SECRET）
 */
function loadIngestSecret() {
  if (process.env.INGEST_SECRET) {
    return process.env.INGEST_SECRET.trim();
  }
  const devVarsPath = path.resolve(import.meta.dirname, "../.dev.vars");
  if (!fs.existsSync(devVarsPath)) {
    return "";
  }
  const content = fs.readFileSync(devVarsPath, "utf8");
  const match = content.match(/^INGEST_SECRET=(.+)$/m);
  return match ? match[1].trim() : "";
}

/**
 * 规范化源站店铺简介：统一换行符并裁剪首尾空白，保留安全纯文本多行换行
 */
export function normalizeDescription(raw) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.replace(/\r\n?/g, "\n").trim();
}

/**
 * 从公告、联系字段或外链文案中提取商家 Telegram 用户名或邀请链接
 */
export function extractTelegramHandle(text) {
  const input = String(text || "");
  if (!input) {
    return "";
  }

  // 提取显式 @handle：排除邮箱（如 support@gmail.com）、非 TG URL 路径（如 youtube.com/@user）、纯数字和超长截断
  for (const match of input.matchAll(
    /(?<![a-zA-Z0-9._%+-])@(?=[0-9_]*[a-zA-Z])([a-zA-Z0-9_]{4,32})(?![a-zA-Z0-9_])(?![a-zA-Z0-9_.-]*\.[a-zA-Z]{2,})/g,
  )) {
    const before = input.slice(0, match.index ?? 0);
    if (URL_PATH_PREFIX_RE.test(before)) {
      continue;
    }
    return `@${match[1]}`;
  }

  // 支持 tg://resolve?domain=... 与 tg://join?invite=... 客户端协议链接
  for (const tgUriMatch of input.matchAll(
    /tg:\/\/(?:resolve\?(?:[^#\s]*&)?domain=(?=[0-9_]*[a-zA-Z])([a-zA-Z0-9_]{4,32})(?![a-zA-Z0-9_])|join\?(?:[^#\s]*&)?invite=([a-zA-Z0-9_-]{4,40})(?![a-zA-Z0-9_-]))/gi,
  )) {
    if (tgUriMatch[1] && !RESERVED_TG_PATH_SEGMENTS.has(tgUriMatch[1].toLowerCase())) {
      return `@${tgUriMatch[1]}`;
    }
    if (tgUriMatch[2]) {
      return `https://t.me/+${tgUriMatch[2]}`;
    }
  }

  for (const pathMatch of input.matchAll(
    /(?<![a-zA-Z0-9_.-])(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/(?=[0-9_]*[a-zA-Z])([a-zA-Z0-9_]{4,32})(?![a-zA-Z0-9_])(?!\.[a-zA-Z]{2,})|(\+[a-zA-Z0-9_-]{4,40})(?![a-zA-Z0-9_-])|(joinchat\/[a-zA-Z0-9_-]{4,40})(?![a-zA-Z0-9_-])|(?=[0-9_]*[a-zA-Z])([a-zA-Z0-9_]{4,32})(?![a-zA-Z0-9_])(?!\.[a-zA-Z]{2,}))/gi,
  )) {
    if (pathMatch[1] && !RESERVED_TG_PATH_SEGMENTS.has(pathMatch[1].toLowerCase())) {
      return `@${pathMatch[1]}`;
    }
    if (pathMatch[2]) {
      return `https://t.me/${pathMatch[2]}`;
    }
    if (pathMatch[3]) {
      return `https://t.me/${pathMatch[3]}`;
    }
    if (pathMatch[4] && !RESERVED_TG_PATH_SEGMENTS.has(pathMatch[4].toLowerCase())) {
      return `@${pathMatch[4]}`;
    }
  }

  // 支持 https://<user>.t.me 子域名格式
  for (const subMatch of input.matchAll(
    /(?<![a-zA-Z0-9_.@-])(?=[0-9_]*[a-zA-Z])([a-zA-Z0-9_]{4,32})\.(?:t\.me|telegram\.me|telegram\.dog)(?=[:/?#\s,，;；)）\]】"'<>!！?？。]|$)/gi,
  )) {
    const user = subMatch[1];
    if (!RESERVED_TG_SUBDOMAINS.has(user.toLowerCase())) {
      return `@${user}`;
    }
  }

  return "";
}

/**
 * 按候选字段顺序提取 Telegram 联系方式，避免跨字段拼接造成粘连误判
 */
export function extractTelegramFromSources(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const handle = extractTelegramHandle(source);
    if (handle) {
      return handle;
    }
  }
  return "";
}

function parseShopApiTarget(shopUrl) {
  const parsed = new URL(shopUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("shop");
  const token = idx >= 0 && parts[idx + 1] ? parts[idx + 1] : parts[0] || "";
  if (!token) {
    throw new Error(`无法解析店铺 token: ${shopUrl}`);
  }
  const apiOrigin = parsed.hostname === "pay.ldxp.cn" ? "https://wzyp.cn" : parsed.origin;
  return { apiOrigin, token };
}

const originCookies = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractResponseCookies(res) {
  const rawList =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];
  return rawList.map((entry) => String(entry || "").split(";")[0]).filter(Boolean);
}

/** 只记录简短提示，避免把凭据、联系方式或验证脚本写入日志。 */
export function safeSourceMessage(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, '[链接已隐藏]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已隐藏]')
    .replace(/(?:bearer\s+|(?:token|secret|password|cookie|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '[凭据已隐藏]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[长标识已隐藏]')
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function responseHint(response) {
  const type = response.headers.get('content-type') || '';
  try {
    if (type.includes('application/json')) {
      const data = await response.json();
      return safeSourceMessage(data?.msg || data?.message || data?.error || '');
    }
    const text = await response.text();
    return safeSourceMessage(text.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] || '');
  } catch { return ''; }
}

/** Retry-After 可为秒数或 HTTP 日期；无效值不影响默认退避。 */
export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

async function postJson(url, body, retries = 1, options = {}) {
  const origin = new URL(url).origin;
  let lastError;
  let solvedWafOnce = false;
  let riskRetries = 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      if (options.requestGate) await options.requestGate.before(origin);
      const cookieHeader = originCookies.get(origin) || "";
      const res = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; LdxpLocalPusher/1.0)",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body: JSON.stringify(body),
      });

      const respCookies = extractResponseCookies(res);
      if (respCookies.length > 0) {
        originCookies.set(origin, mergeCookieHeaders(cookieHeader, ...respCookies));
      }

      if (res.status === 403 || res.status === 429 || res.status === 444 || res.status >= 500) {
        const hint = options.requestGate ? await responseHint(res) : "";
        const err = new Error(`源站请求受限或暂时不可用 HTTP ${res.status}${hint ? `，提示：${hint}` : ""}`);
        err.isRateLimited = true;
        err.origin = origin;
        err.retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        throw err;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} (${url})`);
      }

      const ctype = res.headers.get("content-type") || "";
      if (!ctype.toLowerCase().includes("application/json")) {
        const rawText = await res.text();
        if (options.allowChallengeSolve !== false && !solvedWafOnce && rawText.includes("var arg1=")) {
          const solved = solveAcwScV2Cookie(rawText);
          if (solved) {
            solvedWafOnce = true;
            originCookies.set(origin, mergeCookieHeaders(originCookies.get(origin) || "", solved));
            attempt -= 1;
            await sleep(250);
            continue;
          }
        }
        const preview = rawText.replace(/\s+/g, " ").slice(0, 120);
        const title = rawText.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] || "";
        const hint = safeSourceMessage(title);
        const err = new Error(options.requestGate ? `源站返回非JSON HTTP ${res.status}${hint ? `，页面标题：${hint}` : ""}` : `源站返回非JSON (${res.status}): ${preview}`);
        if (options.requestGate || preview.includes("var arg1=") || preview.includes("Just a moment")) {
          err.isRateLimited = true;
          err.origin = origin;
          err.retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        }
        throw err;
      }
      const data = await res.json();
      const message = String(data?.msg || data?.message || "");
      if (options.requestGate && /(?:频繁|限流|请求过多|访问过快|(?:IP|ip|账号|账户|访问).{0,8}封禁|验证码|too many requests|rate.?limit)/i.test(message)) {
        const err = new Error(`源站提示请求受限 HTTP ${res.status}，提示：${safeSourceMessage(message) || "（空）"}`);
        err.isRateLimited = true;
        err.origin = origin;
        err.retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        throw err;
      }
      return data;
    } catch (err) {
      if (err?.isRateLimited) {
        if (options.skipRiskRetry) throw err;
        if (options.requestGate && riskRetries < 2) {
          const delay = Math.max(60000 * (2 ** riskRetries), err.retryAfterMs || 0);
          if (delay <= 900000) {
            riskRetries += 1;
            console.warn(`[push-sync] ${err.message}；等待 ${Math.ceil(delay / 1000)} 秒后重试（${riskRetries}/2）`);
            options.requestGate.cooldown(delay);
            attempt -= 1;
            continue;
          }
        }
        options.requestGate?.block();
        throw err;
      }
      lastError = err;
      if (attempt < retries) {
        await sleep(600);
      }
    }
  }
  throw lastError;
}

function resolveStock(extend) {
  const rawCount = extend?.stock_count;
  const showType = extend?.show_stock_type;
  if (typeof rawCount === "number" && Number.isFinite(rawCount)) {
    if (rawCount <= 0) return { inStock: true, stockCount: 0, stockStatus: "low" };
    const stockCount = showType === 0 ? null : rawCount;
    const stockStatus = rawCount <= 5 ? "low" : rawCount <= 20 ? "normal" : "sufficient";
    return { inStock: true, stockCount, stockStatus };
  }
  return { inStock: true, stockCount: null, stockStatus: "sufficient" };
}

/**
 * 将源站 Shop/info 与 goodsList 响应组装为标准推送快照（即使当前 0 在售商品也完整保留 description 与联系方式）
 */
export function buildShopApiSnapshot(shop, info, allGoods, apiOrigin, token) {
  const seenItemKeys = new Set();
  const items = [];
  for (const g of allGoods) {
    const rawName = String(g.name || "").trim();
    const price = Number(g.price);
    const shopCategory = String(g.category?.name || g._fallbackCategoryName || "").trim();
    if (!rawName || isNonSalePlaceholderItem(rawName, shopCategory, price)) continue;
    const stock = resolveStock(g.extend);

    const itemKey = String(g.goods_key || g.link || items.length + 1);
    if (seenItemKeys.has(itemKey)) continue;
    seenItemKeys.add(itemKey);
    items.push({
      itemKey,
      rawName,
      shopCategory,
      price: Number(price.toFixed(2)),
      stockCount: stock.stockCount,
      stockStatus: stock.stockStatus,
      itemUrl: String(g.link || `${apiOrigin}/item/${itemKey}`),
    });
  }

  const description = normalizeDescription(info.description);
  const linkButtons = Array.isArray(info.link_buttons) ? info.link_buttons : [];
  const buttonSources = linkButtons.flatMap((b) =>
    typeof b === "string" ? [b] : [b?.link, b?.url, b?.name],
  );
  const telegram =
    extractTelegramFromSources(
      info.description,
      ...buttonSources,
      info.contact_qq,
      info.contact_wechat,
    ) ||
    shop.telegram ||
    "";
  const sellCount = typeof info.sell_count === "number" && Number.isFinite(info.sell_count) ? info.sell_count : null;
  const depositMoney = typeof info.deposit_money === "number" && Number.isFinite(info.deposit_money) ? info.deposit_money : null;

  return {
    shopName: String(info.nickname || "").trim() || String(shop.shopName || "").trim(),
    canonicalUrl: String(info.link || "").trim() || `${apiOrigin}/shop/${token}`,
    telegram,
    description,
    shopSellCount: sellCount,
    salesVisible: sellCount !== null,
    depositVisible: depositMoney !== null && depositMoney > 0,
    depositMoney,
    items,
  };
}

/**
 * 判断本地采集结果是否可以跳过推送。
 * 说明：description 不在商品哈希内，因此即便 0 在售商品且 Hash 一致，只要检测到简介需要回填或变更仍应触发推送。
 */
export function shouldSkipLocalPush({
  shop,
  snapshot,
  localHash,
  descriptionPersistence,
  backfillDescription = false,
}) {
  const hashMatches = Boolean(
    shop.contentHashFull &&
      shop.contentHashFull === localHash &&
      shop.syncState === "ready",
  );
  if (!hashMatches) {
    return false;
  }
  if (descriptionPersistence === false) {
    return true;
  }
  const localDescription = normalizeDescription(snapshot.description);
  if (shop.description !== undefined) {
    return localDescription === normalizeDescription(shop.description ?? "");
  }
  if (backfillDescription && localDescription !== "") {
    return false;
  }
  return true;
}

async function fetchPagedGoodsBatchLocal(apiOrigin, token, goodsType, categoryId = "", firstPageCache = null, options = {}) {
  const maxPages = 200;
  const pageSize = 100;
  const page1 =
    firstPageCache ||
    (await postJson(`${apiOrigin}/shopApi/Shop/goodsList`, {
      token,
      goods_type: goodsType,
      ...(categoryId ? { category_id: categoryId } : {}),
      page: 1, current: 1,
      limit: pageSize, pageSize,
    }, 1, options));

  if (page1.code !== 1 || !page1.data) {
    throw new Error(page1.msg || `goodsList 接口失败 (type=${goodsType}, code=${page1.code})`);
  }

  if (!Array.isArray(page1.data.list)) throw new Error(`goodsList 数据格式错误 (type=${goodsType})`);
  const list1 = page1.data.list;
  const rawTotal = page1.data.total;
  const expectedTotal = Number(rawTotal);
  if (rawTotal === null || rawTotal === undefined || (typeof rawTotal === "string" && rawTotal.trim() === "") || !["string", "number"].includes(typeof rawTotal) ||
      !Number.isSafeInteger(expectedTotal) || expectedTotal < 0 || expectedTotal < list1.length) {
    throw new Error(`商品总数缺失或无效，拒绝不完整快照 (type=${goodsType})`);
  }
  const collected = [];
  const seenKeys = new Set();

  const appendUnique = (batch) => {
    for (const g of batch) {
      const k = String(g.goods_key || g.link || `idx-${collected.length + 1}`).trim();
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      collected.push(g);
    }
  };

  appendUnique(list1);

  let page = 2;
  let lastPageLen = list1.length;
  while (collected.length < expectedTotal && lastPageLen > 0 && page <= maxPages) {
    await sleep(150);
    const nextRes = await postJson(`${apiOrigin}/shopApi/Shop/goodsList`, {
      token,
      goods_type: goodsType,
      ...(categoryId ? { category_id: categoryId } : {}),
      page, current: page,
      limit: pageSize, pageSize,
    }, 1, options);
    if (nextRes.code !== 1 || !nextRes.data) {
      throw new Error(nextRes.msg || `goodsList 分页接口失败 (type=${goodsType}, page=${page})`);
    }
    if (!Array.isArray(nextRes.data.list)) throw new Error(`goodsList 分页数据格式错误 (type=${goodsType}, page=${page})`);
    const nextList = nextRes.data.list;
    if (nextList.length === 0) break;
    const before = collected.length;
    appendUnique(nextList);
    if (collected.length === before) break;
    lastPageLen = nextList.length;
    page += 1;
  }

  if (collected.length < expectedTotal || isIncompleteGoodsBatch({ expectedTotal, collectedCount: collected.length, maxPages, pageSize })) {
    throw new Error(
      `快照不完整，跳过覆盖 (type=${goodsType}${categoryId ? `/cat=${categoryId}` : ""}, expected=${expectedTotal}, collected=${collected.length})`,
    );
  }

  return collected;
}

export async function fetchShopApiSnapshot(shop, options = {}) {
  const { apiOrigin, token } = parseShopApiTarget(shop.shopUrl);
  const infoRes = await postJson(`${apiOrigin}/shopApi/Shop/info`, { token }, 1, options);
  if (infoRes.code !== 1 || !infoRes.data) {
    const message = String(infoRes.msg || `info 接口失败 (code=${infoRes.code})`);
    const error = new Error(message);
    if (/^(?:店铺链接不存在|店铺不存在)(?:[，,。！？：:\s]|$)/.test(message)) error.shopUnavailable = "not_found";
    else if (/^商家已被关闭交易(?:[，,。！？：:\s]|$)/.test(message)) error.shopUnavailable = "closed";
    throw error;
  }
  const defaultCardPage1 = await postJson(`${apiOrigin}/shopApi/Shop/goodsList`, {
    token, goods_type: "card", page: 1, current: 1, limit: 100, pageSize: 100,
  }, 1, options);

  const info = infoRes.data;
  const typeEntries = resolveShopGoodsTypes(info);
  const allGoods = [];

  for (const { goodsType, expectedCount } of typeEntries) {
    const cachedPage1 = goodsType === "card" ? defaultCardPage1 : null;
    const goodsList = await fetchPagedGoodsBatchLocal(apiOrigin, token, goodsType, "", cachedPage1, options);
    if (goodsList.length > 0) {
      allGoods.push(...goodsList);
      continue;
    }

    if (expectedCount !== null && expectedCount > 0) {
      const catRes = await postJson(`${apiOrigin}/shopApi/Shop/categoryList`, {
        token,
        goods_type: goodsType,
        category_key: "",
      }, 1, options);
      const categories = catRes.code === 1 && Array.isArray(catRes.data) ? catRes.data : [];
      if (categories.length > 40) throw new Error(`商品分类过多，无法安全采集完整快照 (type=${goodsType})`);
      const beforeCategoryFallback = allGoods.length;
      for (const cat of categories.slice(0, 40)) {
        const cid = cat.id !== undefined && cat.id !== null ? String(cat.id).trim() : "";
        if (!cid) continue;
        await sleep(100);
        const catGoods = await fetchPagedGoodsBatchLocal(apiOrigin, token, goodsType, cid, null, options);
        for (const g of catGoods) {
          allGoods.push({
            ...g,
            _fallbackCategoryName: String(cat.name || "").trim(),
          });
        }
      }
      if (allGoods.length === beforeCategoryFallback) {
        throw new Error(`源站声明有商品但未能取得商品列表 (type=${goodsType})`);
      }
    }
  }

  return buildShopApiSnapshot(shop, info, allGoods, apiOrigin, token);
}

export function parseCliArgs(argv) {
  let importPath = "";
  let concurrency = 4;
  let limit = 0;
  let offset = 0;
  let backfillDescription = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--import" && argv[i + 1]) {
      importPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--import=")) {
      importPath = arg.slice("--import=".length);
    } else if (arg.startsWith("--concurrency=")) {
      concurrency = Math.min(8, Math.max(1, Number(arg.slice("--concurrency=".length)) || 4));
    } else if (arg.startsWith("--limit=")) {
      limit = Math.max(0, Number(arg.slice("--limit=".length)) || 0);
    } else if (arg.startsWith("--offset=")) {
      offset = Math.max(0, Number(arg.slice("--offset=".length)) || 0);
    } else if (arg === "--backfill-description") {
      backfillDescription = true;
    }
  }
  return { importPath: importPath.trim(), concurrency, limit, offset, backfillDescription };
}

/**
 * 读取本地店铺 JSON 文件并分批导入到 POST /api/admin/shops
 */
async function importShopsFromFile(apiBase, adminSecret, filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`找不到导入文件: ${resolved}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const shopsList = Array.isArray(parsed) ? parsed : parsed?.shops;
  if (!Array.isArray(shopsList) || shopsList.length === 0) {
    throw new Error("导入 JSON 必须为非空数组或包含 shops 数组");
  }

  console.log(`[push-sync] 准备导入 ${shopsList.length} 家店铺到 ${apiBase}/api/admin/shops`);
  let totalUpserted = 0;
  const batchSize = 40;

  for (let i = 0; i < shopsList.length; i += batchSize) {
    const chunk = shopsList.slice(i, i + batchSize);
    const res = await fetch(`${apiBase}/api/admin/shops`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSecret}`,
      },
      body: JSON.stringify({ shops: chunk }),
    });
    const result = await res.json();
    if (!res.ok) {
      throw new Error(`导入店铺批次失败 HTTP ${res.status}: ${JSON.stringify(result)}`);
    }
    totalUpserted += Number(result.upserted || 0);
  }
  console.log(`[push-sync] 店铺导入完成，共写入/更新 ${totalUpserted} 家`);
}

/**
 * 向 /api/ingest 发送单个小批（带 1 次重试，防止长任务中途闪断）
 */
async function pushBatchWithRetry(apiBase, ingestSecret, batch) {
  let lastError;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      const res = await fetch(`${apiBase}/api/ingest`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ingestSecret}`,
        },
        body: JSON.stringify({ shops: batch }),
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(result)}`);
      }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        await sleep(800);
      }
    }
  }
  throw lastError;
}

async function main() {
  const { importPath, concurrency, limit, offset, backfillDescription } = parseCliArgs(process.argv.slice(2));
  const apiBase = (process.env.API_BASE || "https://parity.sirhao.top").replace(/\/+$/, "");
  const ingestSecret = loadIngestSecret();
  if (!ingestSecret) {
    console.error("缺少 INGEST_SECRET（请通过环境变量传入或写入 .dev.vars）");
    process.exit(1);
  }

  if (importPath) {
    await importShopsFromFile(apiBase, ingestSecret, importPath);
  }

  console.log(`[push-sync] 拉取待推送店铺清单: ${apiBase}/api/shops?fields=sync`);
  const shopsRes = await fetch(`${apiBase}/api/shops?fields=sync`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!shopsRes.ok) {
    throw new Error(`获取店铺列表失败: HTTP ${shopsRes.status}`);
  }
  const { shops = [], descriptionPersistence } = await shopsRes.json();

  const allTargets = shops.filter(
    (s) =>
      s.syncSupported &&
      (s.adapterType === "push_ingest" || s.adapterType === "shop_api"),
  );
  const sliced = limit > 0 ? allTargets.slice(offset, offset + limit) : allTargets.slice(offset);

  console.log(
    `[push-sync] 共发现 ${allTargets.length} 家可推送店铺 (push_ingest/shop_api)，本轮处理 ${sliced.length} 家 (offset=${offset}, concurrency=${concurrency})`,
  );

  const pendingBuffer = [];
  const chunkSize = 2;
  let flushChain = Promise.resolve();

  let cursor = 0;
  let processed = 0;
  let localSkipped = 0;
  let networkSkipped = 0;
  let rateLimitedSkipped = 0;
  let totalUpdated = 0;
  let totalDescriptionOnly = 0;
  let totalFailed = 0;
  let totalD1Writes = 0;
  let ingestErrors = 0;
  const blockedOrigins = new Set();

  const scheduleFlush = (forceAll = false) => {
    while (pendingBuffer.length > 0) {
      const totalItemsBuffered = pendingBuffer.reduce((acc, item) => acc + (item.snapshot?.items?.length || 0), 0);
      if (!forceAll && pendingBuffer.length < chunkSize && totalItemsBuffered < 120) {
        break;
      }

      const batch = [];
      let batchItems = 0;
      while (pendingBuffer.length > 0 && batch.length < chunkSize) {
        const next = pendingBuffer[0];
        const nextCount = next.snapshot?.items?.length || 0;
        if (batch.length > 0 && batchItems + nextCount > 150) {
          break;
        }
        batch.push(pendingBuffer.shift());
        batchItems += nextCount;
      }

      if (batch.length === 0) break;
      flushChain = flushChain.then(async () => {
        try {
          const result = await pushBatchWithRetry(apiBase, ingestSecret, batch);
          totalUpdated += result.updatedCount || 0;
          if (Array.isArray(result.outcomes)) {
            totalDescriptionOnly += result.outcomes.filter(
              (o) => o.status === "unchanged" && o.descriptionUpdated,
            ).length;
          }
          totalFailed += result.failedCount || 0;
          totalD1Writes += result.estimatedD1Writes || 0;
        } catch (err) {
          ingestErrors += 1;
          console.warn(`[push-sync] 批次上传失败（跳过继续）: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    }
  };

  const runWorker = async () => {
    while (true) {
      const myIdx = cursor;
      cursor += 1;
      if (myIdx >= sliced.length) {
        return;
      }

      const shop = sliced[myIdx];
      let targetOrigin = "";
      try {
        targetOrigin = parseShopApiTarget(shop.shopUrl).apiOrigin;
      } catch {
        targetOrigin = "";
      }

      if (targetOrigin && blockedOrigins.has(targetOrigin)) {
        rateLimitedSkipped += 1;
        processed += 1;
        continue;
      }

      await sleep(concurrency === 1 ? 650 : 300);

      try {
        const snapshot = await fetchShopApiSnapshot(shop);
        const localHash = computeSnapshotHash(snapshot);
        if (
          shouldSkipLocalPush({
            shop,
            snapshot,
            localHash,
            descriptionPersistence,
            backfillDescription,
          })
        ) {
          localSkipped += 1;
        } else {
          pendingBuffer.push({ shopId: shop.id, shopUrl: shop.shopUrl, snapshot });
          scheduleFlush(false);
        }
      } catch (err) {
        if (err?.isRateLimited) {
          const origin = err.origin || targetOrigin;
          if (origin && !blockedOrigins.has(origin)) {
            blockedOrigins.add(origin);
            console.warn(`[push-sync] 检测到 ${origin} 触发限流/WAF挑战，已熔断该源站后续抓包并跳过上报`);
          }
          rateLimitedSkipped += 1;
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes("fetch failed") ||
            msg.includes("ECONNRESET") ||
            msg.includes("timeout") ||
            msg.includes("aborted")
          ) {
            networkSkipped += 1;
          } else {
            pendingBuffer.push({ shopId: shop.id, shopUrl: shop.shopUrl, error: msg });
            scheduleFlush(false);
          }
        }
      }

      processed += 1;
      if (processed % 25 === 0 || processed === sliced.length) {
        await flushChain;
        console.log(
          `[push-sync] 进度 ${processed}/${sliced.length} | Hash跳过=${localSkipped} | 限流熔断=${rateLimitedSkipped} | 云端更新=${totalUpdated} | 简介仅更新=${totalDescriptionOnly} | 源站异常=${totalFailed} | 估算D1写=~${totalD1Writes}`,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, sliced.length)) }, () => runWorker()));
  scheduleFlush(true);
  await flushChain;

  console.log(
    `[push-sync] 全部结束: 处理 ${processed} 家, Hash跳过 ${localSkipped} 家, 推送更新 ${totalUpdated} 家, 简介仅更新 ${totalDescriptionOnly} 家, 业务异常 ${totalFailed} 家, 限流熔断跳过 ${rateLimitedSkipped} 家, 网络跳过 ${networkSkipped} 家, 上传失败批次 ${ingestErrors}, 累计估算 D1 写 ~${totalD1Writes} 行。`,
  );
}

const isMainModule = (() => {
  if (!process.argv?.[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
  }
})();

if (isMainModule) {
  main().catch((err) => {
    console.error("[push-sync] 运行失败:", err);
    process.exit(1);
  });
}
