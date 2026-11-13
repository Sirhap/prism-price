const SUPPORTED_GOODS_TYPES = ["card", "article", "resource", "equity"];

/** 阿里云盾前端 JS Challenge arg1 置换索引表（1-based 映射）与固定异或掩码 */
const ACW_PERMUTATION_BOX = [
  0x0f, 0x23, 0x1d, 0x18, 0x21, 0x10, 0x01, 0x26, 0x0a, 0x09,
  0x13, 0x1f, 0x28, 0x1b, 0x16, 0x17, 0x19, 0x0d, 0x06, 0x0b,
  0x27, 0x12, 0x14, 0x08, 0x0e, 0x15, 0x20, 0x1a, 0x02, 0x1e,
  0x07, 0x04, 0x11, 0x05, 0x03, 0x1c, 0x22, 0x25, 0x0c, 0x24,
];
const ACW_XOR_KEY = "3000176000856006061501533003690027800375";

const ZERO_WIDTH_STRIP_RE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF\u00AD\u034F\u180E]/g;

const STRONG_PLACEHOLDER_PATTERNS = [
  /(?:测试专用链接|纯属测试|仅供测试|测试商品请勿拍|测试商品|此链接勿拍|勿拍链接|请勿下单|严禁下单|防失联公告|店铺公告请勿拍|通知勿拍)/i,
  /(?:^|[\s【\[（(])(?:补差价|差价专用|差价链接|客服改价|专拍链接|定制改价|邮费补拍|运费补差|拍前改价|定金链接)(?:$|[\s】\]）)!！。.,，])/i,
  /(?:^|[\s【\[（(])(?:请勿拍|不要拍|别拍|勿下单|请勿购买|公告勿拍|仅公告)(?:$|[\s】\]）)!！。.,，])/i,
];

const PLACEHOLDER_CATEGORY_RE = /^(?:测试|测测试|测试分类|公告|店铺公告|防失联|改价|差价|补差价|专拍)$/i;
const REAL_PRODUCT_HINT_RE = /(?:chatgpt|gpt|codex|claude|gemini|grok|cursor|kiro|muse|antigravity|deepseek|api|中转|卡密|月卡|季卡|年卡|周卡|日卡|账号|成品|独享|共享|代充|直充|兑换|邮箱|gmail|outlook|visa|master|接码|接马|plus|pro|ultra|team|max)/i;

/**
 * 求解源站阿里云 WAF 返回的 `var arg1='...'` 页面挑战，生成 `acw_sc__v2=...` Cookie 值。
 * 未匹配到挑战参数时返回空字符串。
 */
export function solveAcwScV2Cookie(htmlText) {
  const match = String(htmlText || "").match(/var\s+arg1\s*=\s*['"]([0-9A-Fa-f]+)['"]/);
  if (!match) {
    return "";
  }
  const arg1 = match[1];
  if (arg1.length < ACW_PERMUTATION_BOX.length) {
    return "";
  }

  const reordered = new Array(ACW_PERMUTATION_BOX.length).fill("");
  for (let i = 0; i < ACW_PERMUTATION_BOX.length; i += 1) {
    const pos = ACW_PERMUTATION_BOX[i] - 1;
    reordered[i] = arg1[pos] || "0";
  }
  const unboxed = reordered.join("");

  let token = "";
  const pairLimit = Math.min(unboxed.length, ACW_XOR_KEY.length);
  for (let i = 0; i + 1 < pairLimit; i += 2) {
    const a = Number.parseInt(unboxed.slice(i, i + 2), 16);
    const b = Number.parseInt(ACW_XOR_KEY.slice(i, i + 2), 16);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return "";
    }
    token += (a ^ b).toString(16).padStart(2, "0");
  }

  return token ? `acw_sc__v2=${token}` : "";
}

/**
 * 合并多个 Cookie 片段（按 key 覆盖更新）为合法请求头 Cookie 字符串
 */
export function mergeCookieHeaders(...cookieStrings) {
  const map = new Map();
  for (const raw of cookieStrings) {
    for (const part of String(raw || "").split(";")) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) map.set(key, value);
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * 从 Shop/info 提取实际在售或启用的商品大类列表与已知数目（兼容仅含默认卡密字段的精简接口）
 */
export function resolveShopGoodsTypes(infoData) {
  const data = infoData || {};
  const ordered = [];
  for (const rawType of data.goods_type_sort || []) {
    if (SUPPORTED_GOODS_TYPES.includes(rawType) && !ordered.includes(rawType)) {
      ordered.push(rawType);
    }
  }
  for (const t of SUPPORTED_GOODS_TYPES) {
    if (!ordered.includes(t)) ordered.push(t);
  }

  const resolved = [];
  for (const goodsType of ordered) {
    const rawCount = data[`${goodsType}_count`];
    if (rawCount !== undefined && rawCount !== null && rawCount !== "") {
      const parsed = Number(rawCount);
      if (Number.isFinite(parsed) && parsed > 0) {
        resolved.push({ goodsType, expectedCount: parsed });
      }
      continue;
    }
    if (goodsType === "card" && data.goods_count !== undefined && data.goods_count !== null && data.goods_count !== "") {
      const compatCount = Number(data.goods_count);
      if (Number.isFinite(compatCount) && compatCount > 0) {
        resolved.push({ goodsType, expectedCount: compatCount });
      }
    }
  }

  return resolved.length > 0 ? resolved : [{ goodsType: "card", expectedCount: null }];
}

/**
 * 校验某批分页抓包结果是否出现跨页丢失/断档不完整
 */
export function isIncompleteGoodsBatch({ expectedTotal, collectedCount, maxPages = 20, pageSize = 100 }) {
  const maxFetchableCap = maxPages * pageSize;
  return expectedTotal > 0 && expectedTotal <= maxFetchableCap && collectedCount < expectedTotal;
}

/**
 * 与 src/collector/etl/cleaner.ts 保持一致：识别测试、补差价、防拍天价或公告占位条目
 */
export function isNonSalePlaceholderItem(rawName, shopCategory = "", price = undefined) {
  if (price !== undefined && (!Number.isFinite(price) || price <= 0 || price >= 99999)) {
    return true;
  }

  const normalizedName = String(rawName || "").replace(ZERO_WIDTH_STRIP_RE, "").trim();
  if (!normalizedName) {
    return true;
  }

  if (STRONG_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalizedName))) {
    return true;
  }

  const normalizedCategory = String(shopCategory || "").replace(ZERO_WIDTH_STRIP_RE, "").trim();
  if (normalizedCategory && PLACEHOLDER_CATEGORY_RE.test(normalizedCategory) && !REAL_PRODUCT_HINT_RE.test(normalizedName)) {
    return true;
  }

  return false;
}
