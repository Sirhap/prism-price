import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * 读取推送/管理员密钥（优先环境变量 INGEST_SECRET，其次本地 .dev.vars）
 */
function loadAdminSecret() {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 将任意形态店铺链接标准化为 canonicalUrl 与建议适配器类型
 */
function resolveCanonicalShopTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);
  const shopIdx = parts.indexOf("shop");
  const token = shopIdx >= 0 && parts[shopIdx + 1] ? parts[shopIdx + 1] : parts.length === 1 ? parts[0] : "";

  if ((host === "pay.ldxp.cn" || host === "wzyp.cn") && token) {
    return {
      host,
      shopUrl: `https://pay.ldxp.cn/shop/${token}`,
      canonicalUrl: `https://wzyp.cn/shop/${token}`,
      adapterType: "push_ingest",
      forcedId: "",
    };
  }
  if (host === "catfk.com" && token) {
    return {
      host,
      shopUrl: `https://catfk.com/shop/${token}`,
      canonicalUrl: `https://catfk.com/shop/${token}`,
      adapterType: "push_ingest",
      forcedId: "",
    };
  }
  if (host === "ka123.plus") {
    return {
      host,
      shopUrl: "https://ka123.plus/",
      canonicalUrl: "https://ka123.plus/",
      adapterType: "ka123_api",
      forcedId: "real-ka123-plus",
    };
  }

  return {
    host,
    shopUrl: parsed.href,
    canonicalUrl: parsed.href,
    adapterType: "manual",
    forcedId: "",
  };
}

function normalizeShopEntry(raw) {
  const target = resolveCanonicalShopTarget(raw.shopUrl);
  if (!target) return null;

  const id = target.forcedId || String(raw.id || "").trim() || `shop-${target.host.replace(/[^a-z0-9]/gi, "-")}`;
  const previewItems = [];
  if (raw.productSummary && Array.isArray(raw.productSummary.groups)) {
    for (const grp of raw.productSummary.groups) {
      if (!Array.isArray(grp.previewItems)) continue;
      for (const p of grp.previewItems) {
        const name = String(p?.name || "").trim();
        const price = Number(p?.price);
        if (name && Number.isFinite(price) && price > 0) {
          previewItems.push({ name, price: Number(price.toFixed(2)) });
        }
        if (previewItems.length >= 6) break;
      }
      if (previewItems.length >= 6) break;
    }
  }

  return {
    origId: String(raw.id || "").trim(),
    origTotalCount: Number(raw.productSummary?.totalCount || 0),
    entry: {
      id,
      shopName: String(raw.shopName || target.host).trim(),
      shopUrl: target.shopUrl,
      canonicalUrl: target.canonicalUrl,
      adapterType: target.adapterType,
      ...(typeof (raw.systemType ?? raw.scraper_type) === "string" ? { systemType: raw.systemType ?? raw.scraper_type } : {}),
      telegram: String(raw.telegram || "").trim(),
      shopSellCount: typeof raw.shopSellCount === "number" && Number.isFinite(raw.shopSellCount) ? raw.shopSellCount : undefined,
      staleDays: typeof raw.staleDays === "number" && Number.isFinite(raw.staleDays) ? Math.max(0, Math.floor(raw.staleDays)) : 0,
      productSummary: previewItems.length > 0 ? previewItems : undefined,
    },
  };
}

function buildStableItemKey(offer, fallbackIdx, usedKeys) {
  const urlStr = String(offer.itemUrl || "").trim();
  const baseName = String(offer.name || "").trim();
  let candidate = "";

  if (urlStr) {
    try {
      const u = new URL(urlStr);
      const lastSeg = u.pathname.split("/").filter(Boolean).pop() || "";
      if (lastSeg && lastSeg !== "item") {
        candidate = `${lastSeg}-${crypto.createHash("sha1").update(urlStr + baseName).digest("hex").slice(0, 6)}`;
      }
    } catch {
      // 忽略无效 URL
    }
  }
  if (!candidate) {
    candidate = `itm-${crypto.createHash("sha1").update(`${baseName}:${fallbackIdx}`).digest("hex").slice(0, 10)}`;
  }

  let finalKey = candidate;
  let seq = 2;
  while (usedKeys.has(finalKey)) {
    finalKey = `${candidate}-${seq}`;
    seq += 1;
  }
  usedKeys.add(finalKey);
  return finalKey;
}

async function fetchJsonWithBackoff(url) {
  for (let attempt = 0; attempt <= 4; attempt += 1) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LdxpSyncBot/1.0)" },
    });
    if (res.status === 429 || res.status === 503) {
      const retryHeader = Number(res.headers.get("retry-after") || 0);
      const waitMs = retryHeader > 0 ? retryHeader * 1000 : 5000 * (attempt + 1);
      console.log(`[sync-from-qizhang] 触发原站速率限制 HTTP ${res.status}，等待 ${Math.round(waitMs / 1000)}s 后重试...`);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${url})`);
    }
    return await res.json();
  }
  throw new Error(`Retry exhausted (${url})`);
}

async function pushIngestBatch(apiBase, adminSecret, batch) {
  let lastError;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      const res = await fetch(`${apiBase}/api/ingest`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminSecret}`,
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
        await sleep(600);
      }
    }
  }
  throw lastError;
}

/**
 * 通过原站分页目录接口（仅 ~94 页）聚合全部在售报价，再回填本地尚无在售商品的店铺
 */
async function syncProductsViaCatalog({
  apiBase,
  adminSecret,
  upstreamOrigin,
  wrappedList,
  existingByCanonical,
  refreshExisting = false,
}) {
  const wrappedByCanonical = new Map(wrappedList.map((w) => [w.entry.canonicalUrl, w]));
  const entryByCanonical = new Map(wrappedList.map((w) => [w.entry.canonicalUrl, w.entry]));
  const page1 = await fetchJsonWithBackoff(`${upstreamOrigin}/api/products?page=1&pageSize=60`);
  const totalPages = Math.max(1, Number(page1.totalPages || 1));
  console.log(`[sync-from-qizhang] 扫描原站商品目录共 ${totalPages} 页 (总商品组 ${page1.total}, 总报价 ${page1.offerTotal})...`);

  const offersByCanonical = new Map();
  const truncatedKeys = new Set();

  const collectGroupOffers = (groupItem) => {
    if (groupItem.offersTruncated || Number(groupItem.offerCount || 0) > (groupItem.offers?.length || 0)) {
      if (groupItem.id) truncatedKeys.add(groupItem.id);
    }
    for (const offer of groupItem.offers || []) {
      const target = resolveCanonicalShopTarget(offer.shopUrl);
      if (!target) continue;
      if (!entryByCanonical.has(target.canonicalUrl)) continue;
      let list = offersByCanonical.get(target.canonicalUrl);
      if (!list) {
        list = [];
        offersByCanonical.set(target.canonicalUrl, list);
      }
      list.push(offer);
    }
  };

  for (const it of page1.items || []) {
    collectGroupOffers(it);
  }

  for (let p = 2; p <= totalPages; p += 1) {
    await sleep(800);
    const data = await fetchJsonWithBackoff(`${upstreamOrigin}/api/products?page=${p}&pageSize=60`);
    for (const it of data.items || []) {
      collectGroupOffers(it);
    }
    if (p % 15 === 0 || p === totalPages) {
      console.log(`[sync-from-qizhang] 目录扫描 ${p}/${totalPages} 页，已聚合 ${offersByCanonical.size} 家店铺报价`);
    }
  }

  if (truncatedKeys.size > 0) {
    console.log(`[sync-from-qizhang] 展开 ${truncatedKeys.size} 个多店同款爆款完整报价...`);
    let expCount = 0;
    for (const key of truncatedKeys) {
      await sleep(750);
      try {
        const det = await fetchJsonWithBackoff(`${upstreamOrigin}/api/products?offerKey=${encodeURIComponent(key)}`);
        for (const it of det.items || []) {
          for (const offer of it.offers || []) {
            const target = resolveCanonicalShopTarget(offer.shopUrl);
            if (!target || !entryByCanonical.has(target.canonicalUrl)) continue;
            let list = offersByCanonical.get(target.canonicalUrl);
            if (!list) {
              list = [];
              offersByCanonical.set(target.canonicalUrl, list);
            }
            list.push(offer);
          }
        }
      } catch {
        // 单个爆款展开失败不影响主流程
      }
      expCount += 1;
      if (expCount % 25 === 0 || expCount === truncatedKeys.size) {
        console.log(`[sync-from-qizhang] 爆款展开 ${expCount}/${truncatedKeys.size}`);
      }
    }
  }

  const pendingSnapshots = [];
  for (const [canonicalUrl, rawOffers] of offersByCanonical.entries()) {
    const entry = entryByCanonical.get(canonicalUrl);
    if (!entry || entry.adapterType === "ka123_api") continue;
    const existing = existingByCanonical.get(canonicalUrl);

    const dedupUrlName = new Set();
    const usedKeys = new Set();
    const items = [];
    for (let i = 0; i < rawOffers.length; i += 1) {
      const of = rawOffers[i];
      const rawName = String(of.name || "").trim();
      const price = Number(of.price);
      const itemUrl = String(of.itemUrl || canonicalUrl).trim();
      if (!rawName || !Number.isFinite(price) || price <= 0) continue;

      const sig = `${itemUrl}::${rawName}`;
      if (dedupUrlName.has(sig)) continue;
      dedupUrlName.add(sig);

      const stockCount = typeof of.stockCount === "number" && Number.isFinite(of.stockCount) ? of.stockCount : null;
      const stockStatus = of.stockStatus === "low" || of.stockStatus === "normal" || of.stockStatus === "sufficient"
        ? of.stockStatus
        : stockCount !== null
          ? stockCount <= 5 ? "low" : stockCount <= 20 ? "normal" : "sufficient"
          : "sufficient";

      items.push({
        itemKey: buildStableItemKey(of, i, usedKeys),
        rawName,
        shopCategory: String(of.category || of.group || "").trim(),
        price: Number(price.toFixed(2)),
        stockCount,
        stockStatus,
        itemUrl,
      });
    }

    if (items.length === 0) continue;

    // 跳过已有且非旧 200 上限截断的店铺（除非显式传入 --refresh-existing）
    const wasTruncatedAt200 = existing && Number(existing.productCount || 0) === 200 && items.length > 200;
    const isAlreadySynced = existing && existing.lastSyncedAt && Number(existing.productCount || 0) > 0;
    if (isAlreadySynced && !refreshExisting && !wasTruncatedAt200) {
      continue;
    }

    pendingSnapshots.push({
      shopId: entry.id,
      shopUrl: entry.shopUrl,
      snapshot: {
        shopName: entry.shopName,
        canonicalUrl: entry.canonicalUrl,
        telegram: String(rawOffers.find((o) => o.telegram)?.telegram || entry.telegram || "").trim(),
        shopSellCount: entry.shopSellCount ?? null,
        salesVisible: entry.shopSellCount !== undefined && entry.shopSellCount !== null,
        depositVisible: false,
        depositMoney: null,
        items: items.slice(0, 2000),
      },
    });
  }

  // 检查线上仍有商品记录、但原站已清零下架的店铺，推送空快照触发级联清理
  for (const [canonicalUrl, existing] of existingByCanonical.entries()) {
    if (Number(existing.productCount || 0) <= 0 || existing.adapterType === "ka123_api") continue;
    const wrapped = wrappedByCanonical.get(canonicalUrl);
    if (!wrapped) continue;
    if (!offersByCanonical.has(canonicalUrl) && wrapped.origTotalCount === 0) {
      pendingSnapshots.push({
        shopId: wrapped.entry.id,
        shopUrl: wrapped.entry.shopUrl,
        snapshot: {
          shopName: wrapped.entry.shopName,
          canonicalUrl: wrapped.entry.canonicalUrl,
          telegram: wrapped.entry.telegram || "",
          shopSellCount: wrapped.entry.shopSellCount ?? null,
          salesVisible: wrapped.entry.shopSellCount !== undefined && wrapped.entry.shopSellCount !== null,
          depositVisible: false,
          depositMoney: null,
          items: [],
        },
      });
    }
  }

  console.log(`[sync-from-qizhang] 准备自适应分批回填/清理 ${pendingSnapshots.length} 家店铺...`);
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalD1Writes = 0;
  let failedBatches = 0;

  let idx = 0;
  while (idx < pendingSnapshots.length) {
    const batch = [];
    let batchItemCount = 0;
    while (idx < pendingSnapshots.length && batch.length < 4) {
      const candidate = pendingSnapshots[idx];
      const count = candidate.snapshot.items.length;
      if (batch.length > 0 && batchItemCount + count > 100) {
        break;
      }
      batch.push(candidate);
      batchItemCount += count;
      idx += 1;
    }

    try {
      const res = await pushIngestBatch(apiBase, adminSecret, batch);
      totalUpdated += res.updatedCount || 0;
      totalSkipped += res.skippedUnchanged || 0;
      totalD1Writes += res.estimatedD1Writes || 0;
    } catch (err) {
      failedBatches += 1;
      console.warn(`[sync-from-qizhang] 回填批次失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (idx % 40 < batch.length || idx === pendingSnapshots.length) {
      console.log(
        `[sync-from-qizhang] 回填进度 ${idx}/${pendingSnapshots.length} | 更新=${totalUpdated} | 跳过=${totalSkipped} | 估算D1写=~${totalD1Writes}`,
      );
    }
  }

  console.log(
    `[sync-from-qizhang] 全量商品同步结束: 成功更新 ${totalUpdated} 家, Hash跳过 ${totalSkipped} 家, 失败批次 ${failedBatches}, 累计 D1 写 ~${totalD1Writes} 行。`,
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const syncProducts = args.has("--sync-products");
  const refreshExisting = args.has("--refresh-existing");
  const apiBase = (process.env.API_BASE || "https://parity.sirhao.top").replace(/\/+$/, "");
  const sourceUrl = process.env.UPSTREAM_SHOPS_URL || "https://ldxp.qizhang.org/api/shops";
  const upstreamOrigin = new URL(sourceUrl).origin;
  const adminSecret = loadAdminSecret();
  if (!adminSecret) {
    console.error("缺少 INGEST_SECRET（请通过环境变量传入或写入 .dev.vars）");
    process.exit(1);
  }

  console.log(`[sync-from-qizhang] 正在拉取原站店铺清单: ${sourceUrl}`);
  const { shops = [] } = await fetchJsonWithBackoff(sourceUrl);
  console.log(`[sync-from-qizhang] 原站返回 ${shops.length} 条店铺记录`);

  const usedIds = new Set();
  const existingByCanonical = new Map();
  let page = 1;
  while (true) {
    const existingRes = await fetch(`${apiBase}/api/shops?page=${page}&pageSize=100`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!existingRes.ok) break;
    const existingJson = await existingRes.json();
    for (const s of existingJson.shops || []) {
      usedIds.add(s.id);
      if (s.canonicalUrl) {
        existingByCanonical.set(s.canonicalUrl, s);
      }
    }
    if (page >= (existingJson.totalPages || 1)) break;
    page += 1;
  }

  const byCanonical = new Map();
  const countsByAdapter = {};

  for (const raw of shops) {
    const wrapped = normalizeShopEntry(raw);
    if (!wrapped) continue;
    const { entry } = wrapped;
    if (byCanonical.has(entry.canonicalUrl)) continue;

    const existing = existingByCanonical.get(entry.canonicalUrl);
    if (existing) {
      entry.id = existing.id;
    } else {
      let finalId = entry.id;
      let suffix = 2;
      while (usedIds.has(finalId)) {
        finalId = `${entry.id}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(finalId);
      entry.id = finalId;
    }

    byCanonical.set(entry.canonicalUrl, wrapped);
    countsByAdapter[entry.adapterType] = (countsByAdapter[entry.adapterType] || 0) + 1;
  }

  const wrappedList = [...byCanonical.values()];
  const normalizedEntries = wrappedList.map((w) => w.entry);
  console.log(`[sync-from-qizhang] 去重规范化完成，共 ${normalizedEntries.length} 家:`, countsByAdapter);

  const productsOnly = args.has("--products-only");
  if (!productsOnly) {
    const batchSize = 40;
    let totalUpserted = 0;

    for (let i = 0; i < normalizedEntries.length; i += batchSize) {
      const chunk = normalizedEntries.slice(i, i + batchSize);
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
        throw new Error(`导入第 ${Math.floor(i / batchSize) + 1} 批失败 HTTP ${res.status}: ${JSON.stringify(result)}`);
      }
      totalUpserted += Number(result.upserted || 0);
      if ((i / batchSize) % 5 === 0 || i + batchSize >= normalizedEntries.length) {
        console.log(`[sync-from-qizhang] 名录进度 ${Math.min(i + chunk.length, normalizedEntries.length)}/${normalizedEntries.length} (累计写入 ${totalUpserted})`);
      }
    }

    console.log(`[sync-from-qizhang] 全部店铺名录导入完成，共 ${totalUpserted} 家！`);
  }

  if (syncProducts || productsOnly) {
    await syncProductsViaCatalog({
      apiBase,
      adminSecret,
      upstreamOrigin,
      wrappedList,
      existingByCanonical,
      refreshExisting,
    });
  }
}

main().catch((err) => {
  console.error("[sync-from-qizhang] 运行失败:", err);
  process.exit(1);
});
